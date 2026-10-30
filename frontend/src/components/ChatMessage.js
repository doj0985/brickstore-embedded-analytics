import React from 'react';
import { Box, Typography } from '@mui/material';
import { formatMessageTime } from '../utils/format';
import ResultTable from './ResultTable';
import VizImage from './VizImage';
import Markdown from './Markdown';

const ChatMessage = ({ message }) => {
  const hasTable = message.table && message.table.length > 0;
  const isUser = message.type === 'user';
  // A beta viz attachment rides alongside the table when enable_visualization is
  // on (chat mode). It needs the genie conversation/message ids to fetch.
  const viz = message.viz;

  return (
    <Box sx={{ mb: 1.5, display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <Box
        sx={(theme) => ({
          // Tables/charts need room; widen the bubble when one is present.
          maxWidth: hasTable || viz ? '92%' : '75%',
          px: 1.75,
          py: 1,
          borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
          // User messages keep the colored bubble; assistant messages sit on a
          // clean white surface with a subtle border, like the Genie UI. Pure
          // white in light mode (the theme's `paper` token is a cool off-white)
          // for crisp contrast against the grey message area.
          bgcolor: isUser
            ? 'primary.main'
            : (theme.palette.mode === 'dark' ? theme.palette.background.paper : theme.palette.common.white),
          color: isUser ? '#fff' : 'text.primary',
          border: isUser ? 'none' : `1px solid ${theme.palette.divider}`,
          boxShadow: 'none',
        })}
      >
        {message.content && (
          isUser ? (
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {message.content}
            </Typography>
          ) : (
            // Bot answers can contain markdown (bold, lists, headings) — render it.
            <Box sx={{ '& > :first-of-type': { mt: 0 }, '& > :last-child': { mb: 0 } }}>
              <Markdown>{message.content}</Markdown>
            </Box>
          )
        )}
        {hasTable && (
          <ResultTable rows={message.table} columns={message.columns} schema={message.schema || {}} />
        )}
        {viz && (
          <VizImage
            conversationId={viz.conversation_id}
            messageId={viz.message_id}
            attachmentId={viz.viz_attachment_id}
            title={viz.title}
          />
        )}
        {message.created_at && (
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              mt: 0.5,
              textAlign: 'right',
              fontSize: 10.5,
              color: isUser ? 'rgba(255,255,255,0.7)' : 'text.secondary',
            }}
          >
            {formatMessageTime(message.created_at)}
          </Typography>
        )}
      </Box>
    </Box>
  );
};

export default ChatMessage;
