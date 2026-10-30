"""Databricks Genie Conversational API helpers.

Two layers of polling exist in Genie's API:
  1. Message generation status (SUBMITTED -> ASKING_AI -> ... -> COMPLETED).
  2. SQL execution status (PENDING/RUNNING -> SUCCEEDED) for completed messages
     that return a query.

Older versions of this module did both polls in-process via time.sleep, which
blocked a gunicorn worker for the full query duration. The functions below now
expose a *single non-blocking poll step* that the HTTP layer can call repeatedly
from the client, freeing workers between polls.
"""

import json
import logging
import os
import time

from .http import session

logger = logging.getLogger(__name__)

GENIE_REQUEST_TIMEOUT_SECONDS = 15
TOKEN_REQUEST_TIMEOUT_SECONDS = 10

# Generation states where Genie is still working on the response.
_GENERATING_STATES = {"SUBMITTED", "FILTERING_CONTEXT", "FETCHING_METADATA", "ASKING_AI", "PENDING_WAREHOUSE", "EXECUTING_QUERY"}
# SQL execution states where the warehouse is still running the query.
_QUERY_PENDING_STATES = {"PENDING", "RUNNING"}


def _mint_oauth_token(client_id, client_secret):
    """Mint an M2M OAuth token for the given service-principal credentials."""
    databricks_host = os.environ['DATABRICKS_HOST']
    token_url = f"https://{databricks_host}/oidc/v1/token"
    payload = {
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": "all-apis",
    }

    response = session.post(token_url, data=payload, timeout=TOKEN_REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    data = response.json()
    return {
        "access_token": data["access_token"],
        "expiration_time": time.time() + data["expires_in"],
    }


def get_databricks_oauth_token():
    """Token for the app's own service principal (DATABRICKS_CLIENT_ID).

    This SP has UC row-filter *bypass* (it sees every tenant), so it must NOT be
    used for Genie queries that need to be tenant-isolated — use
    get_genie_oauth_token(company) for those.
    """
    return _mint_oauth_token(
        os.environ['DATABRICKS_CLIENT_ID'],
        os.environ['DATABRICKS_CLIENT_SECRET'],
    )


# Hard-coded tenant -> service-principal credential mapping for the demo. The app
# calls Genie *as* the tenant's SP, so the Unity Catalog rls_company row filter
# scopes every generated query to that one store. Production code would store
# this mapping in a database keyed by tenant and resolve it from the session.
_GENIE_SP_ENV = {
    "apex":    ("GENIE_SP_CLIENT_ID_APEX",    "GENIE_SP_CLIENT_SECRET_APEX"),
    "synergy": ("GENIE_SP_CLIENT_ID_SYNERGY", "GENIE_SP_CLIENT_SECRET_SYNERGY"),
}


def get_genie_oauth_token(company):
    """Mint an OAuth token AS the company's tenant service principal.

    Genie runs its generated SQL as this SP, so UC row-level security returns
    only that tenant's rows. This is what isolates the single shared Genie space.
    """
    try:
        id_env, secret_env = _GENIE_SP_ENV[company.lower()]
    except KeyError:
        raise ValueError(f"No Genie service principal configured for company: {company}")
    return _mint_oauth_token(os.environ[id_env], os.environ[secret_env])


def is_token_valid(token):
    """True if a cached token exists and has not yet expired (pure predicate)."""
    return bool(token and time.time() < token["expiration_time"])


# One shared Genie space for all tenants; UC row-level security (keyed on the
# tenant SP the token was minted for) isolates each caller to their own store.
def get_genie_space_id():
    return os.environ["DATABRICKS_GENIE_SPACE_ID"]


def _auth_headers(token):
    return {"Authorization": f"Bearer {token['access_token']}"}


def _message_body(content, enable_visualization):
    """Request body for start/continue. The `enable_visualization` flag asks
    Genie to also generate a chart for query results; when set, a completed
    message may carry an extra `viz` attachment (see poll_message). Callers can
    pass False to opt out on a workspace that lacks the beta."""
    body = {"content": content}
    if enable_visualization:
        body["enable_visualization"] = True
    return body


def start_conversation(space_id, content, token, databricks_host, enable_visualization=True):
    """Kick off a new Genie conversation; return identifiers for polling."""
    url = f"https://{databricks_host}/api/2.0/genie/spaces/{space_id}/start-conversation"

    response = session.post(
        url,
        headers={**_auth_headers(token), "Content-Type": "application/json"},
        data=json.dumps(_message_body(content, enable_visualization)),
        timeout=GENIE_REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    body = response.json()
    return {"conversation_id": body["conversation_id"], "message_id": body["message_id"]}


def continue_conversation(space_id, content, conversation_id, token, databricks_host, enable_visualization=True):
    """Send a follow-up message; return identifiers for polling."""
    url = f"https://{databricks_host}/api/2.0/genie/spaces/{space_id}/conversations/{conversation_id}/messages"

    response = session.post(
        url,
        headers={**_auth_headers(token), "Content-Type": "application/json"},
        data=json.dumps(_message_body(content, enable_visualization)),
        timeout=GENIE_REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return {"conversation_id": conversation_id, "message_id": response.json()["message_id"]}


def poll_message(space_id, conversation_id, message_id, token, databricks_host):
    """Single non-blocking poll of the message's *generation* state.

    Returns one of:
      {"state": "GENERATING",    "detail": <raw state>}
      {"state": "QUERY_RUNNING", "attachment_id": ..., "description": ...}
          -> client must poll again with attachment_id to fetch SQL result
      {"state": "COMPLETED",     "result": {...}}     # text-only response
      {"state": "FAILED",        "detail": <error>}
    """
    url = f"https://{databricks_host}/api/2.0/genie/spaces/{space_id}/conversations/{conversation_id}/messages/{message_id}"

    response = session.get(url, headers=_auth_headers(token), timeout=GENIE_REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    body = response.json()
    state = body["status"]

    if state in _GENERATING_STATES:
        return {"state": "GENERATING", "detail": state}
    if state == "FAILED":
        return {"state": "FAILED", "detail": body.get("error")}
    if state != "COMPLETED":
        logger.warning("Unexpected Genie message state: %s", state)
        return {"state": "FAILED", "detail": f"unexpected state: {state}"}

    attachments = body.get("attachments") or []
    if not attachments:
        logger.warning("Genie message completed with no attachments")
        return {"state": "COMPLETED", "result": {"content": ""}}

    # A single message can carry several attachments — typically a `query`
    # (the SQL) plus, when enable_visualization was set, a separate `viz`
    # attachment that references the query's id. Scan by kind rather than
    # assuming attachments[0]. (The older code only ever read the first one.)
    text_att = next((a for a in attachments if "text" in a), None)
    query_att = next((a for a in attachments if "query" in a), None)
    viz_att = next((a for a in attachments if "viz" in a), None)

    # The beta viz attachment: {"attachment_id", "viz": {"query_attachment_id",
    # "title"}}. Surface its own attachment_id (that's what download-visualization
    # takes) plus the conversation/message ids so the client can build the
    # /api/genie/viz/{cid}/{mid}/{attachment_id} URL and fetch the rendered image
    # once the query lands. (These ids also survive Lakebase persistence, so a
    # reloaded conversation can re-fetch the chart.)
    viz = None
    if viz_att:
        viz = {
            "viz_attachment_id": viz_att.get("attachment_id"),
            "conversation_id": conversation_id,
            "message_id": message_id,
            "title": (viz_att.get("viz") or {}).get("title", ""),
        }

    if query_att:
        # Don't block here — hand the attachment_id back so the client can poll
        # the query-result endpoint separately, keeping this handler fast.
        result = {
            "state": "QUERY_RUNNING",
            "attachment_id": query_att.get("attachment_id"),
            "description": query_att["query"].get("description", ""),
        }
        if viz:
            result["viz"] = viz
        return result

    if text_att:
        return {
            "state": "COMPLETED",
            "result": {
                "message_id": message_id,
                "conversation_id": conversation_id,
                "attachment_id": text_att.get("attachment_id"),
                "content": text_att["text"].get("content", ""),
            },
        }

    logger.warning("Genie message completed with neither text nor query attachment")
    return {"state": "COMPLETED", "result": {"content": ""}}


class FeatureDisabledError(Exception):
    """Raised when a beta/preview endpoint is gated off on the workspace.

    The download-visualization endpoint answers 404 with
    error_code=FEATURE_DISABLED until the beta is enabled. We surface this as a
    distinct type so the route layer can return a clean, actionable message
    instead of a generic 500."""


def download_visualization(space_id, conversation_id, message_id, attachment_id, token, databricks_host):
    """Fetch the rendered image bytes for a `viz` attachment (beta).

    Path/shape verified from the Go SDK: GET on the attachment's
    `download-visualization` sub-resource with Accept: application/octet-stream,
    returning raw image bytes. Returns (content_bytes, content_type).

    Raises FeatureDisabledError when the workspace hasn't been enrolled in the
    beta (HTTP 404 / error_code FEATURE_DISABLED)."""
    url = (
        f"https://{databricks_host}/api/2.0/genie/spaces/{space_id}"
        f"/conversations/{conversation_id}/messages/{message_id}"
        f"/attachments/{attachment_id}/download-visualization"
    )
    response = session.get(
        url,
        headers={**_auth_headers(token), "Accept": "application/octet-stream"},
        timeout=GENIE_REQUEST_TIMEOUT_SECONDS,
    )
    if response.status_code == 404 and "FEATURE_DISABLED" in response.text:
        raise FeatureDisabledError("The download visualization API is not enabled on this workspace.")
    response.raise_for_status()
    return response.content, response.headers.get("Content-Type", "application/octet-stream")


def poll_query_result(space_id, conversation_id, message_id, attachment_id, token, databricks_host):
    """Single non-blocking poll of the SQL query result for a completed message.

    Returns one of:
      {"state": "QUERY_RUNNING"}
      {"state": "COMPLETED", "result": [row_dict, ...]}
      {"state": "FAILED",    "detail": <message>}
    """
    url = (
        f"https://{databricks_host}/api/2.0/genie/spaces/{space_id}"
        f"/conversations/{conversation_id}/messages/{message_id}/query-result/{attachment_id}"
    )

    response = session.get(url, headers=_auth_headers(token), timeout=GENIE_REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    payload = response.json()
    statement = payload.get("statement_response", payload)
    state = statement["status"]["state"]

    if state in _QUERY_PENDING_STATES:
        return {"state": "QUERY_RUNNING"}

    if state == "SUCCEEDED":
        rows = statement.get("result", {}).get("data_array", []) or []
        cols = statement["manifest"]["schema"]["columns"]
        if not rows:
            return {"state": "COMPLETED", "result": [{"Message": "No data available"}]}
        seen, deduped = {}, []
        for c in cols:
            name = c["name"]
            seen[name] = seen.get(name, 0) + 1
            deduped.append(f"{name}_{seen[name]}" if seen[name] > 1 else name)
        # Carry the SQL type per column so the UI can format values correctly
        # (data_array values arrive as strings, stripped of any type info).
        schema = {deduped[i]: cols[i].get("type_name", "") for i in range(len(cols))}
        return {
            "state": "COMPLETED",
            "result": [dict(zip(deduped, row)) for row in rows],
            "schema": schema,
            # Explicit ordered column list — survives JSONB persistence, which
            # reorders object keys and would otherwise scramble column order.
            "columns": deduped,
        }

    if state == "FAILED":
        err_msg = statement.get("status", {}).get("error", {}).get("message", "Query failed")
        return {"state": "FAILED", "detail": err_msg}

    if state == "CANCELED":
        return {"state": "FAILED", "detail": "Query was canceled"}

    logger.warning("Unexpected SQL state: %s", state)
    return {"state": "FAILED", "detail": f"Unexpected SQL state: {state}"}
