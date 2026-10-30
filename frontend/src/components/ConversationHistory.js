import React from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Button,
  Typography,
  Divider,
  IconButton,
  Tooltip,
  Skeleton,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import HistoryIcon from '@mui/icons-material/History';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

// Relative "2h ago" style timestamp; falls back to a date for older items.
const formatRelative = (iso) => {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
};

// Perplexity-style left rail: "New chat" + the user's own past conversations.
const ConversationHistory = ({ conversations, activeId, onSelect, onNew, onDelete, loading }) => (
  <Box
    sx={(theme) => ({
      width: 270,
      flexShrink: 0,
      height: '100vh',
      // Hide on mobile, like the primary SideMenu; the chat takes the full width.
      display: { xs: 'none', md: 'flex' },
      flexDirection: 'column',
      borderRight: `1px solid ${theme.palette.divider}`,
      backgroundColor: theme.palette.background.paper,
    })}
  >
    <Box sx={{ p: 1.5 }}>
      <Button
        fullWidth
        variant="outlined"
        startIcon={<AddIcon />}
        onClick={onNew}
        sx={{ justifyContent: 'flex-start', textTransform: 'none', borderRadius: 2 }}
      >
        New chat
      </Button>
    </Box>
    <Divider />

    <Box sx={{ px: 2, pt: 1.5, pb: 0.5, display: 'flex', alignItems: 'center', gap: 0.75, color: 'text.secondary' }}>
      <HistoryIcon sx={{ fontSize: 16 }} />
      <Typography variant="caption" sx={{ fontWeight: 600, letterSpacing: 0.4 }}>
        HISTORY
      </Typography>
    </Box>

    <List dense sx={{ overflowY: 'auto', flexGrow: 1, px: 0.5 }}>
      {/* Skeletons while the first load is in flight (Lakebase may be waking
          from scale-to-zero) — avoids flashing the empty state on refresh. */}
      {loading && conversations.length === 0 &&
        [0, 1, 2, 3].map((i) => (
          <Box key={i} sx={{ px: 1.5, py: 0.75 }}>
            <Skeleton variant="text" width={`${85 - i * 8}%`} height={18} />
            <Skeleton variant="text" width="40%" height={12} />
          </Box>
        ))}
      {!loading && conversations.length === 0 && (
        <Typography variant="body2" sx={{ px: 2, py: 1, color: 'text.disabled' }}>
          No conversations yet
        </Typography>
      )}
      {conversations.map((c) => (
        <ListItem
          key={c.id}
          disablePadding
          sx={{
            // Reveal the delete button on hover (or when the row is active).
            '& .convo-delete': { opacity: 0, transition: 'opacity 120ms ease' },
            '&:hover .convo-delete': { opacity: 1 },
          }}
          secondaryAction={
            <Tooltip title="Delete conversation">
              <IconButton
                edge="end"
                size="small"
                className="convo-delete"
                aria-label={`Delete conversation ${c.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(c.id, c.title);
                }}
                sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}
              >
                <DeleteOutlineIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          }
        >
          <ListItemButton
            selected={c.id === activeId}
            onClick={() => onSelect(c.id)}
            sx={{ borderRadius: 1.5, mb: 0.25, pr: 5 }}
          >
            <ListItemText
              primary={c.title}
              primaryTypographyProps={{ noWrap: true, fontSize: 13 }}
              secondary={formatRelative(c.updated_at)}
              secondaryTypographyProps={{ fontSize: 11 }}
            />
          </ListItemButton>
        </ListItem>
      ))}
    </List>
  </Box>
);

export default ConversationHistory;
