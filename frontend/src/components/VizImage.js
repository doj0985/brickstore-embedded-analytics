import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Box, Skeleton } from '@mui/material';

// Renders a Genie-generated chart image (beta "viz" attachment).
//
// The image lives behind an authenticated backend route, and a plain <img src>
// can't carry our custom X-JWT-Authorization header — so we fetch the bytes via
// axios (which does attach the header) as a blob and hand the <img> an object
// URL. Same reason the agent SSE stream uses fetch() rather than EventSource.
//
// Chat mode knows the space message id up front (messageId). Agent mode only
// has the conversation + attachment id — the backend resolves the space message
// id itself — so pass `agent` and omit messageId to hit the agent route.
const VizImage = ({ conversationId, messageId, attachmentId, title, agent = false }) => {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!conversationId || !attachmentId) return undefined;
    if (!agent && !messageId) return undefined;
    const src = agent
      ? `/api/genie/agent/viz/${conversationId}/${attachmentId}`
      : `/api/genie/viz/${conversationId}/${messageId}/${attachmentId}`;
    let objectUrl = null;
    let cancelled = false;
    axios
      .get(src, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setUrl(objectUrl);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [conversationId, messageId, attachmentId, agent]);

  // If the chart can't be fetched (e.g. beta not enabled) just render nothing —
  // the text/table answer already stands on its own.
  if (failed) return null;
  if (!url) return <Skeleton variant="rounded" height={220} sx={{ mt: 1, borderRadius: 2 }} />;

  return (
    <Box sx={{ mt: 1 }}>
      <img
        src={url}
        alt={title || 'Genie visualization'}
        style={{ maxWidth: '100%', height: 'auto', borderRadius: 8, display: 'block' }}
      />
    </Box>
  );
};

export default VizImage;
