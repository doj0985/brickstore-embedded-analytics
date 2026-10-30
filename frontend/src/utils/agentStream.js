// Genie Agent Mode (Responses) SSE client.
//
// We use fetch() + a ReadableStream reader rather than the browser's native
// EventSource for one hard reason: EventSource can only issue a plain GET with
// cookies and cannot set custom headers, but our auth rides the custom
// X-JWT-Authorization header (the Databricks Apps front door strips the
// standard Authorization header). fetch() lets us set it; we then parse the SSE
// framing ourselves. The backend proxies the upstream event-stream verbatim.

const JWT_HEADER = 'X-JWT-Authorization';

// Events that end a run — after any of these, no further output arrives, so the
// reader can stop without waiting for the transport to signal EOF.
const TERMINAL_EVENTS = new Set([
  'response.completed',
  'response.failed',
  'response.incomplete',
]);

const authToken = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}').access_token || '';
  } catch {
    return '';
  }
};

// Parse one raw SSE record ("event: x\ndata: {...}") into {event, data}. Per the
// SSE spec, `data:` may span multiple lines — join them with newlines.
const parseRecord = (raw) => {
  let event = 'message';
  const dataLines = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  if (dataLines.length === 0) return null;
  const dataStr = dataLines.join('\n');
  try {
    return { event, data: JSON.parse(dataStr) };
  } catch {
    return { event, data: dataStr };
  }
};

// Open the stream and invoke onEvent({event, data}) for each SSE record until
// the stream ends or `signal` aborts. Throws on a pre-stream HTTP error (the
// backend forwards Databricks' JSON error body + status, e.g. FEATURE_DISABLED).
export async function streamAgentResponse({ question, conversationId, onEvent, signal }) {
  const res = await fetch('/api/genie/agent/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [JWT_HEADER]: `Bearer ${authToken()}`,
    },
    body: JSON.stringify({
      question,
      ...(conversationId ? { conversation_id: conversationId } : {}),
    }),
    signal,
  });

  if (!res.ok) {
    let message = `Agent request failed (${res.status})`;
    try {
      const body = await res.json();
      message = body.error?.message || body.error || message;
    } catch { /* keep default */ }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    // Records are separated by a blank line. Tolerate \n\n and \r\n\r\n.
    while ((sep = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + buffer.slice(sep).match(/^\r?\n\r?\n/)[0].length);
      const rec = parseRecord(raw);
      if (rec) onEvent(rec);
      // Stop once the run reaches a terminal event rather than waiting for the
      // HTTP stream itself to close — an intermediary (the CRA dev proxy) may
      // hold the connection open after the last event, which would otherwise
      // leave the caller's await hanging (and the "Researching…" bar stuck).
      if (rec && TERMINAL_EVENTS.has(rec.event)) {
        await reader.cancel().catch(() => {});
        return;
      }
    }
  }
}

// --- Event folding ---------------------------------------------------------
// Fold the SSE event lifecycle into a flat, ordered list of output items plus
// overall status. Items are keyed by output_index (added -> updated -> done all
// carry the same index), so we upsert in place and preserve order.

export const initialTrace = () => ({
  conversationId: null,
  status: 'in_progress',
  items: [],       // ordered output items
  error: null,
});

export function applyAgentEvent(trace, { event, data }) {
  const next = { ...trace, items: [...trace.items] };

  if (event === 'response.created') {
    next.conversationId = data.response?.conversation_id || next.conversationId;
    next.status = 'in_progress';
    return next;
  }

  if (event === 'response.output_item.added'
      || event === 'response.output_item.updated'
      || event === 'response.output_item.done') {
    const idx = data.output_index;
    const item = data.item;
    if (typeof idx === 'number' && item) {
      next.items[idx] = item;
    }
    return next;
  }

  if (event === 'response.completed') {
    next.status = 'completed';
    // The terminal event carries the authoritative full output — trust it.
    if (Array.isArray(data.response?.output)) next.items = data.response.output;
    if (data.response?.conversation_id) next.conversationId = data.response.conversation_id;
    return next;
  }

  if (event === 'response.failed') {
    next.status = 'failed';
    next.error = data.response?.error?.message || 'The research run failed.';
    if (Array.isArray(data.response?.output)) next.items = data.response.output;
    return next;
  }

  return next;
}
