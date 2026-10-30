import logging
import os
from datetime import timedelta

from dotenv import load_dotenv

load_dotenv()  # must run before backend.config imports

import requests
from flask import Flask, Response, jsonify, request, send_from_directory, stream_with_context
from flask_cors import CORS
from flask_jwt_extended import (
    JWTManager,
    create_access_token,
    get_jwt_identity,
    jwt_required,
)
try:
    from flask_limiter import Limiter
    from flask_limiter.util import get_remote_address
    _HAS_LIMITER = True
except ImportError:  # pragma: no cover - allows boot without rate-limit dep
    _HAS_LIMITER = False
from sqlalchemy.exc import IntegrityError, OperationalError
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

from backend import config
from backend.dashboard_embedding import get_dashboard_embedding_oauth_token
from backend.genie_api_agent_mode import (
    list_items,
    open_response_stream,
    resolve_viz_message_id,
)
from backend.genie_api_chat_mode import (
    FeatureDisabledError,
    continue_conversation,
    download_visualization,
    get_genie_oauth_token,
    get_genie_space_id,
    is_token_valid,
    poll_message,
    poll_query_result,
    start_conversation,
)
from backend.models import User, db
from backend import lakebase

# ---------------------------------------------------------------------------
# App + logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logging.getLogger("werkzeug").setLevel(logging.WARNING)

app = Flask(__name__, static_folder="frontend/build", static_url_path="/")
app.logger.setLevel(logging.INFO)

CORS(app, resources={r"/api/*": {"origins": config.CORS_ORIGINS}})

app.config["SECRET_KEY"] = config.FLASK_SECRET_KEY
app.config["JWT_SECRET_KEY"] = config.JWT_SECRET_KEY
app.config["JWT_TOKEN_LOCATION"] = ["headers"]
app.config["JWT_HEADER_NAME"] = config.JWT_HEADER_NAME
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(hours=8)
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get("DATABASE_URL", "sqlite:///db.sqlite")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

jwt = JWTManager(app)


@jwt.unauthorized_loader
def _jwt_unauthorized(reason):
    # Logs why an authenticated call was rejected. auth_hdr/jwt_hdr reveal which
    # header (if any) actually reached the app through the Apps proxy.
    app.logger.warning(
        "JWT 401 on %s: %s | Authorization hdr=%s | %s hdr=%s",
        request.path, reason,
        "authorization" in request.headers,
        config.JWT_HEADER_NAME, config.JWT_HEADER_NAME.lower() in request.headers,
    )
    return jsonify({"error": "Missing or invalid authorization token"}), 401


@jwt.expired_token_loader
def _jwt_expired(_header, _payload):
    app.logger.warning("JWT expired on %s", request.path)
    return jsonify({"error": "Token expired"}), 401


@jwt.invalid_token_loader
def _jwt_invalid(reason):
    # A malformed / bad-signature token (e.g. signed with a rotated key, or a
    # stale token left in the browser). flask-jwt-extended defaults this to 422,
    # but treating it as 401 lets the frontend's interceptor bounce the user to
    # login and re-authenticate instead of surfacing a confusing error.
    app.logger.warning("JWT invalid on %s: %s", request.path, reason)
    return jsonify({"error": "Invalid authorization token"}), 401

if _HAS_LIMITER:
    limiter = Limiter(
        get_remote_address,
        app=app,
        default_limits=["200 per minute"],
        storage_uri="memory://",  # single-worker dev only; use redis:// in prod multi-worker.
    )
    rate_limit = limiter.limit
else:
    app.logger.warning("flask-limiter not installed; rate limiting disabled")
    def rate_limit(_):  # no-op decorator factory
        return lambda f: f

# ---------------------------------------------------------------------------
# DB + demo seed
# ---------------------------------------------------------------------------

DEMO_USERS = [
    {"email": "carl@apex.com",     "company": "Apex",    "first_name": "Carl",  "last_name": "Hall"},
    {"email": "robyn@synergy.com", "company": "Synergy", "first_name": "Robyn", "last_name": "Sheehan"},
    # To add more demo tenants, create a per-tenant Genie service principal,
    # set GENIE_SP_CLIENT_ID/SECRET_<COMPANY> in your env, and add a branch to
    # _GENIE_SP_ENV in backend/genie_api_chat_mode.py (all tenants share one space).
]
DEMO_PASSWORD = "Demo1234!"

db.init_app(app)
with app.app_context():
    # Under gunicorn all workers boot concurrently against the same SQLite file
    # and race on create_all(): checkfirst is per-process, so two workers can both
    # decide the table is missing and each issue CREATE TABLE. The loser raises
    # OperationalError("table user already exists"). Left unguarded this exits the
    # worker (code 3) and gunicorn shuts the whole app down -> every route 502s.
    # The table exists either way, so swallow the race and carry on.
    try:
        db.create_all()
    except OperationalError:
        db.session.rollback()
        app.logger.info("DB tables already created by another worker")
    if User.query.count() == 0:
        for u in DEMO_USERS:
            db.session.add(User(**u, password=generate_password_hash(DEMO_PASSWORD, method="pbkdf2:sha256")))
        # Under gunicorn all workers boot concurrently against the same SQLite
        # file and race to seed. The first wins; the rest hit a UNIQUE
        # constraint — roll back and carry on rather than crashing the worker.
        try:
            db.session.commit()
            app.logger.info("Seeded %d demo users", len(DEMO_USERS))
        except IntegrityError:
            db.session.rollback()
            app.logger.info("Demo users already seeded by another worker")

# Chat-history tables live in Lakebase (separate engine, per-user scoped). Create
# them idempotently at boot; don't let a transient Lakebase hiccup (e.g. waking
# from scale-to-zero) crash the app — the routes will surface errors if needed.
try:
    lakebase.init_db()
    app.logger.info("Lakebase chat-history tables ready")
except Exception:  # pragma: no cover - best-effort boot
    app.logger.exception("Lakebase init_db failed at boot; will retry on demand")

# Per-tenant Genie OAuth tokens, cached by company. Each is minted AS that
# tenant's service principal so Unity Catalog row-level security scopes Genie to
# the caller's own store. Minted on demand server-side; never sent to the browser.
_genie_tokens = {}


def get_genie_token(company):
    key = company.lower()
    cached = _genie_tokens.get(key)
    if not is_token_valid(cached):
        cached = get_genie_oauth_token(company)
        _genie_tokens[key] = cached
    return cached


def current_user():
    return db.session.get(User, int(get_jwt_identity()))


def require_json(*fields):
    """Return validated request body or abort with a JSON 400."""
    body = request.get_json(silent=True) or {}
    missing = [f for f in fields if not body.get(f)]
    if missing:
        return None, (jsonify({"error": f"Missing required field(s): {', '.join(missing)}"}), 400)
    return body, None


# ---------------------------------------------------------------------------
# Cross-cutting middleware
# ---------------------------------------------------------------------------

@app.after_request
def add_security_headers(response):
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


@app.errorhandler(Exception)
def handle_unexpected(err):
    if isinstance(err, HTTPException):
        return err
    app.logger.exception("Unhandled error processing %s %s", request.method, request.path)
    return jsonify({"error": "Internal server error"}), 500


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
@app.route("/login")
@app.route("/home")
@app.route("/genie")
# Deep links under /genie (e.g. /genie/c/123 for a specific conversation) must
# also serve the SPA so a refresh on a conversation URL doesn't 404 — React
# Router takes over client-side from there.
@app.route("/genie/<path:_subpath>")
@app.route("/dashboards")
def serve(_subpath=None):
    return send_from_directory(app.static_folder, "index.html")


@app.route("/healthz")
def healthz():
    return jsonify({"status": "ok"}), 200


@app.route("/api/login", methods=["POST"])
@rate_limit("5 per minute")
def login():
    body, err = require_json("email", "password")
    if err:
        return err

    user = User.query.filter_by(email=body["email"]).first()
    if not user or not check_password_hash(user.password, body["password"]):
        app.logger.info("Failed login for %s", body["email"])
        return jsonify({"message": "Login Failed"}), 401

    access_token = create_access_token(identity=str(user.id))
    return jsonify({
        "message": "Login Success",
        "first_name": user.first_name,
        "last_name": user.last_name,
        "email": user.email,
        "company": user.company,
        "access_token": access_token,
    })


@app.route("/api/dashboard/config", methods=["POST"])
@jwt_required()
def dashboard_config():
    return jsonify({
        "instance_url": f"https://{config.DATABRICKS_HOST}",
        "workspace_id": config.DATABRICKS_WORKSPACE_ID,
        "dashboard_id": config.DATABRICKS_DASHBOARD_ID,
    })


@app.route("/api/dashboard/get_token", methods=["POST"])
@jwt_required()
def dashboard_get_token():
    user = current_user()
    # Viewer identity comes from the verified JWT — never the request body.
    return get_dashboard_embedding_oauth_token(
        external_data=user.company,
        external_viewer_id=user.email,
    )


@app.route("/api/genie/start", methods=["POST"])
@jwt_required()
def genie_start():
    user = current_user()
    body, err = require_json("question")
    if err:
        return err

    try:
        token = get_genie_token(user.company)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    ids = start_conversation(
        space_id=get_genie_space_id(),
        content=body["question"],
        token=token,
        databricks_host=config.DATABRICKS_HOST,
    )
    return jsonify({"state": "GENERATING", **ids}), 202


@app.route("/api/genie/continue", methods=["POST"])
@jwt_required()
def genie_continue():
    user = current_user()
    body, err = require_json("question", "conversation_id")
    if err:
        return err

    try:
        token = get_genie_token(user.company)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    ids = continue_conversation(
        space_id=get_genie_space_id(),
        content=body["question"],
        conversation_id=body["conversation_id"],
        token=token,
        databricks_host=config.DATABRICKS_HOST,
    )
    return jsonify({"state": "GENERATING", **ids}), 202


@app.route("/api/genie/poll", methods=["POST"])
@jwt_required()
def genie_poll():
    user = current_user()
    body, err = require_json("conversation_id", "message_id")
    if err:
        return err

    try:
        token = get_genie_token(user.company)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    common = {
        "space_id": get_genie_space_id(),
        "conversation_id": body["conversation_id"],
        "message_id": body["message_id"],
        "token": token,
        "databricks_host": config.DATABRICKS_HOST,
    }

    # Two flavours of poll: message generation (no attachment_id) and the
    # follow-up SQL query result (attachment_id present). Both are
    # non-blocking — the client drives the cadence.
    attachment_id = body.get("attachment_id")
    if attachment_id:
        return jsonify(poll_query_result(attachment_id=attachment_id, **common))
    return jsonify(poll_message(**common))


@app.route("/api/genie/viz/<conversation_id>/<message_id>/<attachment_id>", methods=["GET"])
@jwt_required()
def genie_viz(conversation_id, message_id, attachment_id):
    """Proxy the rendered image for a Genie `viz` attachment (beta).

    The image download needs the tenant's OAuth token, which must never reach
    the browser — so the browser points an <img> at this route and we fetch the
    bytes server-side as the tenant SP, exactly like every other Genie call."""
    user = current_user()
    try:
        token = get_genie_token(user.company)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    try:
        content, content_type = download_visualization(
            space_id=get_genie_space_id(),
            conversation_id=conversation_id,
            message_id=message_id,
            attachment_id=attachment_id,
            token=token,
            databricks_host=config.DATABRICKS_HOST,
        )
    except FeatureDisabledError as e:
        return jsonify({"error": str(e)}), 404
    except requests.HTTPError as e:
        # The visualization may not exist yet, may not be a chartable result, or
        # the attachment ids may be stale. Surface the upstream status as a clean
        # 4xx instead of a 500 — the client hides the image on any non-2xx.
        status = e.response.status_code if e.response is not None else 502
        app.logger.info("viz download failed (%s) for %s/%s/%s", status,
                        conversation_id, message_id, attachment_id)
        return jsonify({"error": "Visualization unavailable"}), status

    # Cache within the browser session — the rendered image is immutable for a
    # given attachment id, so there's no reason to refetch on re-render.
    return Response(content, content_type=content_type,
                    headers={"Cache-Control": "private, max-age=3600"})


# --- Genie Agent Mode (SSE) -------------------------------------------------

@app.route("/api/genie/agent/stream", methods=["POST"])
@jwt_required()
def genie_agent_stream():
    """Proxy the agent-mode SSE research stream to the browser.

    We forward the upstream event-stream byte-for-byte so the client parses the
    native OpenResponses events itself; the worker/thread only shuttles bytes,
    never buffering the (up to 90-minute) run. A pre-stream error from Databricks
    (FEATURE_DISABLED, 409 conflict, bad input) arrives as JSON before any event,
    so we surface that as a normal JSON response with its status code."""
    user = current_user()
    body, err = require_json("question")
    if err:
        return err

    try:
        token = get_genie_token(user.company)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    upstream = open_response_stream(
        agent_id=get_genie_space_id(),
        content=body["question"],
        token=token,
        databricks_host=config.DATABRICKS_HOST,
        conversation_id=body.get("conversation_id"),
    )

    if upstream.status_code != 200:
        # Error before the stream started — pass the JSON body + status through.
        try:
            payload = upstream.json()
        except ValueError:
            payload = {"error": upstream.text[:500]}
        upstream.close()
        return jsonify(payload), upstream.status_code

    def relay():
        try:
            for chunk in upstream.iter_content(chunk_size=None):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    # Disable proxy buffering (X-Accel-Buffering) so events reach the browser as
    # they arrive rather than being held back by an intermediary.
    return Response(
        stream_with_context(relay()),
        content_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.route("/api/genie/agent/viz/<conversation_id>/<attachment_id>", methods=["GET"])
@jwt_required()
def genie_agent_viz(conversation_id, attachment_id):
    """Proxy a rendered chart for an AGENT-mode `viz` attachment (beta).

    The agent SSE trace carries a viz attachment_id, but the download endpoint
    is keyed by the space-side message id (a different id space than the agent
    output items). We resolve that message id from the backing space
    conversation, then reuse the chat-mode download — all as the tenant SP so no
    token ever reaches the browser."""
    user = current_user()
    try:
        token = get_genie_token(user.company)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    space_id = get_genie_space_id()
    try:
        message_id = resolve_viz_message_id(
            space_id=space_id,
            conversation_id=conversation_id,
            attachment_id=attachment_id,
            token=token,
            databricks_host=config.DATABRICKS_HOST,
        )
        if not message_id:
            return jsonify({"error": "Visualization unavailable"}), 404

        content, content_type = download_visualization(
            space_id=space_id,
            conversation_id=conversation_id,
            message_id=message_id,
            attachment_id=attachment_id,
            token=token,
            databricks_host=config.DATABRICKS_HOST,
        )
    except FeatureDisabledError as e:
        return jsonify({"error": str(e)}), 404
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else 502
        app.logger.info("agent viz download failed (%s) for %s/%s", status,
                        conversation_id, attachment_id)
        return jsonify({"error": "Visualization unavailable"}), status

    return Response(content, content_type=content_type,
                    headers={"Cache-Control": "private, max-age=3600"})


@app.route("/api/genie/agent/items", methods=["GET"])
@jwt_required()
def genie_agent_items():
    """Fetch a conversation's agent-mode items — history display and the
    recovery path if a proxied SSE stream drops mid-run (poll `status`)."""
    conversation_id = request.args.get("conversation_id")
    if not conversation_id:
        return jsonify({"error": "Missing required field(s): conversation_id"}), 400

    user = current_user()
    try:
        token = get_genie_token(user.company)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    try:
        result = list_items(
            agent_id=get_genie_space_id(),
            conversation_id=conversation_id,
            token=token,
            databricks_host=config.DATABRICKS_HOST,
            limit=int(request.args.get("limit", 100)),
            after=request.args.get("after"),
            order=request.args.get("order", "asc"),
        )
    except FeatureDisabledError as e:
        return jsonify({"error": str(e)}), 404
    return jsonify(result)


# --- Chat history (Lakebase, scoped to the verified-JWT user) ---------------

@app.route("/api/genie/conversations", methods=["GET"])
@jwt_required()
def genie_conversations():
    """List the caller's own conversations, most recent first."""
    user = current_user()
    return jsonify(lakebase.list_conversations(user.email))


@app.route("/api/genie/conversations/<int:conversation_id>", methods=["GET"])
@jwt_required()
def genie_conversation(conversation_id):
    """Load one conversation's transcript — only if the caller owns it."""
    user = current_user()
    convo = lakebase.get_conversation(conversation_id, user.email)
    if convo is None:
        # 404 (not 403) so we don't reveal that someone else's id exists.
        return jsonify({"error": "Conversation not found"}), 404
    return jsonify(convo)


@app.route("/api/genie/conversations/<int:conversation_id>", methods=["DELETE"])
@jwt_required()
def genie_delete_conversation(conversation_id):
    """Delete one of the caller's own conversations."""
    user = current_user()
    if not lakebase.delete_conversation(conversation_id, user.email):
        return jsonify({"error": "Conversation not found"}), 404
    return jsonify({"deleted": conversation_id})


@app.route("/api/genie/persist", methods=["POST"])
@jwt_required()
def genie_persist():
    """Append a completed (question, answer) turn to the user's history.
    Best-effort from the client's perspective — the chat works without it."""
    user = current_user()
    body, err = require_json("genie_conversation_id", "question")
    if err:
        return err
    answer = body.get("answer") or {}
    result = lakebase.persist_turn(
        user_email=user.email,
        company=user.company,
        genie_conversation_id=body["genie_conversation_id"],
        question=body["question"],
        answer={
            "content": answer.get("content"),
            "table": answer.get("table"),
            "schema": answer.get("schema"),
            "columns": answer.get("columns"),
            "trace": answer.get("trace"),
            "viz": answer.get("viz"),
        },
        mode=body.get("mode", "chat"),
    )
    return jsonify(result)


if __name__ == "__main__":
    app.run(debug=config.DEBUG)
