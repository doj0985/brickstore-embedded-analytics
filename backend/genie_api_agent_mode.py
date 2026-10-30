"""Databricks Genie Agent Mode (Responses) API helpers.

Agent mode is the agentic, multi-step research counterpart to the plain Genie
Conversation API in genie_api_chat_mode.py. A single question drives a stream of
work — reasoning, one or more SQL queries, then a final cited report — delivered
over Server-Sent Events (SSE) per the OpenResponses spec with Databricks
extensions.

Endpoints (agent_id == Genie space id):
  POST /api/2.0/genie/agents/{agent_id}/responses                       (SSE)
  GET  /api/2.0/genie/agents/{agent_id}/conversations/{cid}/items       (JSON)

This module intentionally does NOT parse the SSE stream. The app proxies the
raw byte stream straight through to the browser, which parses events itself —
that keeps a gunicorn worker/thread from having to buffer or interpret a
multi-minute research run. The GET-items call is the recovery/history path
(and the fallback if a proxied stream ever drops).

Agent mode is always on. If the workspace isn't enrolled in the preview, the API
answers with error_code FEATURE_DISABLED: list_items and resolve_viz_message_id
raise FeatureDisabledError for a clean route-level message, and
open_response_stream returns the raw error response for the caller to pass on.
"""

import json
import logging

from .genie_api_chat_mode import FeatureDisabledError, _auth_headers
from .http import session

logger = logging.getLogger(__name__)

# The research run can pause for long stretches between SSE events (LLM
# reasoning + SQL execution); the server-side cap is 90 min. Use a generous
# read timeout with a short connect timeout so a genuine connect failure still
# fails fast. (connect, read) seconds.
AGENT_STREAM_TIMEOUT = (10, 600)
AGENT_REQUEST_TIMEOUT = 30


def _agent_base(databricks_host, agent_id):
    return f"https://{databricks_host}/api/2.0/genie/agents/{agent_id}"


def _user_message(content):
    """The single required user input item for a create-response request."""
    return {"type": "message", "role": "user",
            "content": [{"type": "input_text", "text": content}]}


def open_response_stream(agent_id, content, token, databricks_host,
                         conversation_id=None, enable_viz=True):
    """POST a new agent-mode response and return the live streaming Response.

    Returns the raw `requests.Response` (stream=True) so the caller can proxy
    the SSE bytes directly. The caller MUST check `.status_code`: a pre-stream
    error (FEATURE_DISABLED, RESOURCE_CONFLICT, permission, bad input) arrives
    as a non-200 JSON body *before* any event is streamed.

    `conversation_id` continues an existing conversation (multi-turn context is
    held server-side — don't resend prior messages). `enable_viz` opts into
    visualization generation where supported.
    """
    url = f"{_agent_base(databricks_host, agent_id)}/responses"
    body = {"input": [_user_message(content)]}
    if conversation_id:
        body["conversation_id"] = conversation_id
    if enable_viz:
        body["enable_viz"] = True

    return session.post(
        url,
        headers={**_auth_headers(token), "Content-Type": "application/json",
                 "Accept": "text/event-stream"},
        data=json.dumps(body),
        timeout=AGENT_STREAM_TIMEOUT,
        stream=True,
    )


def resolve_viz_message_id(space_id, conversation_id, attachment_id, token,
                           databricks_host):
    """Find the SPACE-side message_id that owns a given viz attachment.

    Agent-mode viz attachments surface in the SSE trace (on a
    function_call_output and on the final assistant message) keyed only by
    attachment_id — but the download-visualization endpoint is keyed by the
    Genie *space* message id, which lives in a different id space than the
    agent output-item ids. An agent conversation is backed by a space
    conversation of the same id, so we list that space conversation's messages
    and return the id of the one whose attachments include this viz.

    Returns the message_id string, or None if no such message is found.
    """
    url = (f"https://{databricks_host}/api/2.0/genie/spaces/{space_id}"
           f"/conversations/{conversation_id}/messages")
    response = session.get(url, headers=_auth_headers(token),
                           timeout=AGENT_REQUEST_TIMEOUT)
    if response.status_code == 404 and "FEATURE_DISABLED" in response.text:
        raise FeatureDisabledError("The Genie visualization API is not enabled on this workspace.")
    response.raise_for_status()
    body = response.json()
    for message in body.get("messages") or []:
        for att in message.get("attachments") or []:
            if att.get("attachment_id") == attachment_id and att.get("viz"):
                return message.get("message_id") or message.get("id")
    return None


def list_items(agent_id, conversation_id, token, databricks_host,
               limit=100, after=None, order="asc"):
    """List a conversation's output items (chronological), for history display,
    incremental fetch, or recovery after a dropped stream.

    Returns the raw list envelope: {data[], first_id, last_id, has_more,
    status, object}. Poll `status` ("in_progress"/"completed"/"failed") to
    detect completion when recovering from a broken stream.
    """
    url = f"{_agent_base(databricks_host, agent_id)}/conversations/{conversation_id}/items"
    params = {"limit": limit, "order": order}
    if after:
        params["after"] = after

    response = session.get(url, headers=_auth_headers(token), params=params,
                           timeout=AGENT_REQUEST_TIMEOUT)
    if response.status_code == 404 and "FEATURE_DISABLED" in response.text:
        raise FeatureDisabledError("The Genie Agent Mode API is not enabled on this workspace.")
    response.raise_for_status()
    return response.json()
