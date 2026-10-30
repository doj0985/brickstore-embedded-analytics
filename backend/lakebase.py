"""Lakebase (autoscale Postgres) persistence for Genie chat history.

Connection model
----------------
Lakebase autoscale has no native Databricks Apps resource binding yet, so the
app connects manually: it authenticates AS its own service principal
(``DATABRICKS_CLIENT_ID``) and mints a short-lived (~1h) Postgres OAuth token at
connect time. The token is injected into every new physical connection via
SQLAlchemy's ``do_connect`` event — never baked into the engine URL — and cached
for 50 minutes (under the 1h expiry). ``pool_pre_ping`` + a sub-token
``pool_recycle`` keep things healthy across the instance's scale-to-zero suspend.

Isolation
---------
Every conversation row carries ``user_email``; all reads filter on the caller's
verified-JWT identity, so a user only ever sees conversations they initiated.
"""

import socket
import threading
import time

from databricks.sdk import WorkspaceClient
from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    event,
    func,
    select,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import URL
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

import backend.config as config

# --- token management -------------------------------------------------------
_TOKEN_TTL_SECONDS = 50 * 60  # refresh well before the 1h OAuth expiry
_lock = threading.Lock()
_ws = None
_token = None
_token_minted_at = 0.0


def _client():
    global _ws
    if _ws is None:
        _ws = WorkspaceClient(
            host=f"https://{config.DATABRICKS_HOST}",
            client_id=config.DATABRICKS_CLIENT_ID,
            client_secret=config.DATABRICKS_CLIENT_SECRET,
        )
    return _ws


def _db_token():
    """Return a cached Postgres OAuth token, minting a fresh one when stale."""
    global _token, _token_minted_at
    with _lock:
        if _token is None or (time.time() - _token_minted_at) > _TOKEN_TTL_SECONDS:
            cred = _client().postgres.generate_database_credential(
                endpoint=config.LAKEBASE_ENDPOINT
            )
            _token = cred.token
            _token_minted_at = time.time()
        return _token


# --- engine -----------------------------------------------------------------
# Username is the SP the app runs as (its application id == its Postgres role).
_engine = create_engine(
    URL.create(
        "postgresql+psycopg",
        username=config.DATABRICKS_CLIENT_ID,
        password="",  # injected per-connection below
        host=config.LAKEBASE_HOST,
        port=5432,
        database=config.LAKEBASE_DATABASE,
    ),
    pool_pre_ping=True,        # connection may be dead after scale-to-zero suspend
    pool_recycle=_TOKEN_TTL_SECONDS,
    pool_size=5,
    max_overflow=10,
    pool_timeout=30,
)


@event.listens_for(_engine, "do_connect")
def _provide_token(dialect, conn_rec, cargs, cparams):
    cparams["password"] = _db_token()
    cparams["sslmode"] = "require"
    # macOS occasionally fails DNS for the Databricks PG host; resolving here and
    # passing hostaddr is a no-op on Linux (prod) and a fix locally. host stays
    # set for TLS SNI.
    try:
        cparams["hostaddr"] = socket.gethostbyname(config.LAKEBASE_HOST)
    except OSError:
        pass


SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)

# --- models -----------------------------------------------------------------
Base = declarative_base()
_SCHEMA = config.LAKEBASE_SCHEMA


class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = {"schema": _SCHEMA}

    id = Column(Integer, primary_key=True)
    user_email = Column(String(255), nullable=False, index=True)
    company = Column(String(50), nullable=False)
    title = Column(String(200), nullable=False)
    # Genie's own conversation thread id, for resuming the conversation. Holds
    # the chat conversation id in chat mode, or the agent conversation id in
    # agent mode (distinct id spaces, but the same string column resumes either).
    genie_conversation_id = Column(String(64), nullable=False, index=True)
    # 'chat' (fast Q&A) or 'agent' (multi-step research). Drives how the thread is
    # restored and which endpoint follow-ups target.
    mode = Column(String(10), nullable=False, server_default="chat")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())

    messages = relationship(
        "Message",
        back_populates="conversation",
        # `id` (monotonic serial) breaks ties: a user message and its bot reply
        # share the same created_at (now() is transaction-scoped), so ordering by
        # created_at alone can flip them. id reflects true insertion order.
        order_by="Message.created_at, Message.id",
        cascade="all, delete-orphan",
    )


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = {"schema": _SCHEMA}

    id = Column(Integer, primary_key=True)
    conversation_id = Column(
        Integer, ForeignKey(f"{_SCHEMA}.conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role = Column(String(10), nullable=False)  # 'user' | 'bot'
    content = Column(Text)
    table_json = Column(JSONB)    # rendered result rows, if any
    schema_json = Column(JSONB)   # column -> SQL type, if any
    # Explicit column order. JSONB reorders object keys (by length), so we can't
    # rely on table_json/schema_json key order — this array preserves the
    # original SQL/result column order for rendering.
    columns_json = Column(JSONB)
    # Agent-mode research trace: the ordered output items (reasoning,
    # function_call, function_call_output, final report). Null for chat bots.
    trace_json = Column(JSONB)
    # Beta Genie chart: {viz_attachment_id, conversation_id, message_id, title}.
    # Holds the ids the client needs to re-fetch the rendered image on reload.
    viz_json = Column(JSONB)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    conversation = relationship("Conversation", back_populates="messages")


def init_db():
    """Create the chat tables if they don't exist, and add any newer columns.

    create_all only creates missing *tables* — it won't add columns to a table
    that already exists. The ADD COLUMN IF NOT EXISTS statements below migrate
    pre-existing deployments to the agent-mode columns; both are idempotent and
    safe to run on every boot."""
    Base.metadata.create_all(_engine)
    with _engine.begin() as conn:
        conn.execute(text(
            f"ALTER TABLE {_SCHEMA}.messages ADD COLUMN IF NOT EXISTS trace_json JSONB"
        ))
        conn.execute(text(
            f"ALTER TABLE {_SCHEMA}.messages ADD COLUMN IF NOT EXISTS viz_json JSONB"
        ))
        conn.execute(text(
            f"ALTER TABLE {_SCHEMA}.conversations "
            f"ADD COLUMN IF NOT EXISTS mode VARCHAR(10) NOT NULL DEFAULT 'chat'"
        ))


# --- repository (all reads scoped by user_email) ----------------------------
def _title_from(question: str) -> str:
    q = (question or "").strip().replace("\n", " ")
    return (q[:80] + "…") if len(q) > 80 else (q or "New conversation")


def list_conversations(user_email: str):
    """Return the caller's conversations, most-recently-updated first."""
    with SessionLocal() as s:
        rows = s.scalars(
            select(Conversation)
            .where(Conversation.user_email == user_email)
            .order_by(Conversation.updated_at.desc())
        ).all()
        return [
            {
                "id": c.id,
                "title": c.title,
                "genie_conversation_id": c.genie_conversation_id,
                "mode": c.mode,
                "updated_at": c.updated_at.isoformat() if c.updated_at else None,
            }
            for c in rows
        ]


def get_conversation(conversation_id: int, user_email: str):
    """Return one conversation's messages, or None if not owned by the caller."""
    with SessionLocal() as s:
        c = s.scalars(
            select(Conversation).where(
                Conversation.id == conversation_id,
                Conversation.user_email == user_email,
            )
        ).first()
        if c is None:
            return None
        return {
            "id": c.id,
            "title": c.title,
            "genie_conversation_id": c.genie_conversation_id,
            "mode": c.mode,
            "messages": [
                {
                    "role": m.role,
                    "content": m.content,
                    "table": m.table_json,
                    "schema": m.schema_json,
                    "columns": m.columns_json,
                    "trace": m.trace_json,
                    "viz": m.viz_json,
                    "created_at": m.created_at.isoformat() if m.created_at else None,
                }
                for m in c.messages
            ],
        }


def delete_conversation(conversation_id: int, user_email: str) -> bool:
    """Delete a conversation and its messages, only if owned by the caller.
    Returns True if a row was deleted, False if not found / not owned."""
    with SessionLocal() as s:
        c = s.scalars(
            select(Conversation).where(
                Conversation.id == conversation_id,
                Conversation.user_email == user_email,
            )
        ).first()
        if c is None:
            return False
        s.delete(c)  # cascade removes child messages
        s.commit()
        return True


def persist_turn(user_email, company, genie_conversation_id, question, answer, mode="chat"):
    """Append a (user question, bot answer) turn, creating the conversation on
    first turn. `answer` is a dict with optional content / table / schema /
    trace. `mode` ('chat' | 'agent') is set when the conversation is created.
    Returns the conversation id and the bot message timestamp."""
    with SessionLocal() as s:
        c = s.scalars(
            select(Conversation).where(
                Conversation.genie_conversation_id == genie_conversation_id,
                Conversation.user_email == user_email,
            )
        ).first()
        if c is None:
            c = Conversation(
                user_email=user_email,
                company=company,
                title=_title_from(question),
                genie_conversation_id=genie_conversation_id,
                mode=mode,
            )
            s.add(c)
            s.flush()  # assign c.id

        c.updated_at = func.now()
        s.add(Message(conversation_id=c.id, role="user", content=question))
        bot = Message(
            conversation_id=c.id,
            role="bot",
            content=answer.get("content"),
            table_json=answer.get("table"),
            schema_json=answer.get("schema"),
            columns_json=answer.get("columns"),
            trace_json=answer.get("trace"),
            viz_json=answer.get("viz"),
        )
        s.add(bot)
        s.commit()
        return {
            "conversation_id": c.id,
            "created_at": bot.created_at.isoformat() if bot.created_at else None,
        }
