import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { alpha } from "@mui/material/styles";
import {
  Alert,
  CssBaseline,
  Box,
  TextField,
  IconButton,
  LinearProgress,
  Button,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import AppNavbar from "../components/AppNavbar";
import Header from "../components/Header";
import SideMenu from "../components/SideMenu";
import AppTheme from "../theme/AppTheme";
import ChatMessage from "../components/ChatMessage";
import ResearchTrace from "../components/ResearchTrace";
import ConversationHistory from "../components/ConversationHistory";
import { useAuth } from "../context/AuthContext";
import { streamAgentResponse, applyAgentEvent, initialTrace } from "../utils/agentStream";

export default function Genie() {
  const { user } = useAuth();

  const initialMessage = useMemo(() => ({
    type: "bot",
    content: `Hi ${user.first_name}! 👋 Welcome to your personal data assistant. I’m here to help you explore and understand your data. Feel free to ask me anything related to ${user.company}'s sales on Brickstore — what can I assist you with today?`,
  }), [user.first_name, user.company]);

  const [messages, setMessages] = useState([initialMessage]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [conversationId, setConversationId] = useState("");
  const [error, setError] = useState(null);
  // Genie API mode: "chat" (fast Q&A) or "agent" (multi-step research).
  // Default to agent mode — it's the primary experience on page open.
  const [mode, setMode] = useState("agent");
  // Agent-mode conversations live in a separate id space from chat; track it so
  // follow-ups continue the same research thread (server-side multi-turn).
  const [agentConversationId, setAgentConversationId] = useState("");

  // Persisted chat history (Lakebase), scoped to this user server-side. The
  // open conversation is driven by the URL (/genie/c/:cid) so a refresh or a
  // shared link lands on the same thread. activeConversationId is derived from
  // the route — the URL is the single source of truth.
  const { cid } = useParams();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const activeConversationId = cid ? Number(cid) : null;
  const loadedCidRef = useRef(null);  // guards against re-fetching what's on screen
  // Live route mirror so an in-flight answer can detect if the user has since
  // switched to a different conversation tab. ('' == the "new chat" tab.)
  const currentCidRef = useRef(cid);
  useEffect(() => { currentCidRef.current = cid; }, [cid]);
  // Which tab the in-flight request belongs to, so its "answering…" progress
  // only shows on that tab and not on whatever conversation you navigate to.
  const [loadingForCid, setLoadingForCid] = useState(null);

  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadConversations = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/genie/conversations');
      setConversations(data);
    } catch (err) {
      // History is non-critical; never block the chat on it.
      if (err.response?.status !== 401) console.error('Failed to load history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Load the history list once on mount.
  useEffect(() => { loadConversations(); }, [loadConversations]);

  // URL-driven: when :cid changes, load that transcript and resume its Genie
  // thread; with no :cid, reset to a fresh chat.
  useEffect(() => {
    if (!cid) {
      loadedCidRef.current = null;
      setMessages([initialMessage]);
      setConversationId("");
      setAgentConversationId("");
      setError(null);
      return;
    }
    if (loadedCidRef.current === cid) return;  // already on screen (e.g. just persisted)
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(`/api/genie/conversations/${cid}`);
        if (cancelled) return;
        loadedCidRef.current = cid;
        const isAgent = data.mode === 'agent';
        const restored = data.messages.map((m) => {
          if (m.role === 'user') {
            return { type: 'user', content: m.content, created_at: m.created_at };
          }
          // A stored agent trace rebuilds into a completed research bubble; a
          // plain chat answer keeps its text/table.
          if (m.trace) {
            return {
              type: 'bot',
              trace: { items: m.trace, status: 'completed', conversationId: data.genie_conversation_id || null },
              created_at: m.created_at,
            };
          }
          return { type: 'bot', content: m.content, table: m.table, schema: m.schema, columns: m.columns, viz: m.viz, created_at: m.created_at };
        });
        setMessages([initialMessage, ...restored]);
        // Align the composer + follow-up routing with the conversation's mode.
        setMode(isAgent ? 'agent' : 'chat');
        setAgentConversationId(isAgent ? (data.genie_conversation_id || "") : "");
        setConversationId(isAgent ? "" : (data.genie_conversation_id || ""));
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to open conversation:', err);
        navigate('/genie');  // unknown/forbidden id -> fresh chat
      }
    })();
    return () => { cancelled = true; };
  }, [cid, initialMessage, navigate]);

  // Start a fresh conversation / open a past one — both just change the URL;
  // the effect above does the actual loading.
  const handleNew = () => navigate('/genie');
  const handleSelectConversation = (id) => navigate(`/genie/c/${id}`);

  // Delete flow: the sidebar opens a MUI confirmation dialog (deleteTarget
  // holds the pending {id, title}); confirmDelete performs the deletion.
  const requestDelete = (id, title) => setDeleteTarget({ id, title });

  const confirmDelete = async () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    try {
      await axios.delete(`/api/genie/conversations/${target.id}`);
      setConversations((prev) => prev.filter((c) => c.id !== target.id));
      if (target.id === activeConversationId) navigate('/genie');
    } catch (err) {
      console.error('Failed to delete conversation:', err);
      setError('Could not delete that conversation.');
    }
  };

  // Map Genie's raw generation states to short user-friendly labels.
  const stateLabel = (s) => ({
    SUBMITTED: 'Sending to Genie…',
    FILTERING_CONTEXT: 'Thinking…',
    FETCHING_METADATA: 'Looking up schema…',
    ASKING_AI: 'Reasoning…',
    PENDING_WAREHOUSE: 'Connecting to warehouse…',
    EXECUTING_QUERY: 'Running query…',
  }[s] || 'Working…');

  // Poll until COMPLETED or FAILED. Two phases:
  //   1. Poll message generation (no attachment_id in the body)
  //   2. If the message produces a SQL query, switch to polling the query
  //      result by including attachment_id in subsequent polls.
  const pollUntilDone = useCallback(async (ids) => {
    let pollBody = { ...ids };
    let queryDescription = null;
    // A beta `viz` attachment arrives on the QUERY_RUNNING poll (phase 1) but the
    // rows land on the COMPLETED query-result poll (phase 2), so hold onto it
    // across the phase switch and attach it to the final result.
    let queryViz = null;
    while (true) {
      const { data } = await axios.post('/api/genie/poll', pollBody);

      if (data.state === 'FAILED') throw new Error(data.detail || 'Genie request failed');

      if (data.state === 'COMPLETED') {
        return queryDescription !== null
          ? { description: queryDescription, query_result: data.result, query_schema: data.schema, query_columns: data.columns, query_viz: queryViz }
          : data.result;
      }

      if (data.state === 'QUERY_RUNNING') {
        if (data.attachment_id) {
          queryDescription = data.description || '';
          if (data.viz) queryViz = data.viz;
          pollBody = { ...ids, attachment_id: data.attachment_id };
        }
        setProgress('Running query…');
      } else {
        setProgress(stateLabel(data.detail));
      }

      await new Promise((r) => setTimeout(r, 1500));
    }
  }, []);

  // Agent mode: stream a multi-step research run and render its trace live.
  // Distinct from the chat poll loop — the backend proxies an SSE stream and we
  // fold events into a growing "trace" carried on a single bot message.
  const handleAgentSend = async (question) => {
    const sendCid = cid ?? '';
    const stillHere = () => (currentCidRef.current ?? '') === sendCid;

    setMessages((prev) => ([
      ...prev,
      { type: "user", content: question, created_at: new Date().toISOString() },
      { type: "bot", trace: initialTrace(), created_at: new Date().toISOString() },
    ]));
    setIsLoading(true);
    setLoadingForCid(sendCid);
    setProgress('Researching…');
    setError(null);

    // Update the most recent trace-bearing bot message in place as events land.
    const writeTrace = (trace) => setMessages((prev) => {
      const copy = [...prev];
      for (let i = copy.length - 1; i >= 0; i -= 1) {
        if (copy[i].type === 'bot' && copy[i].trace) { copy[i] = { ...copy[i], trace }; break; }
      }
      return copy;
    });

    let trace = initialTrace();
    try {
      await streamAgentResponse({
        question,
        conversationId: agentConversationId || undefined,
        onEvent: (evt) => {
          trace = applyAgentEvent(trace, evt);
          if (trace.conversationId && !agentConversationId) setAgentConversationId(trace.conversationId);
          writeTrace(trace);
        },
      });
      if (trace.status === 'failed' && trace.error) setError(trace.error);

      // Persist the completed research run to Lakebase, keyed by the agent
      // conversation id, so it survives reloads and appears in the sidebar.
      if (trace.conversationId && trace.items.length) {
        try {
          const { data: saved } = await axios.post('/api/genie/persist', {
            genie_conversation_id: trace.conversationId,
            question,
            mode: 'agent',
            answer: { trace: trace.items },
          });
          loadConversations();
          if (stillHere() && String(saved.conversation_id) !== sendCid) {
            loadedCidRef.current = String(saved.conversation_id);
            navigate(`/genie/c/${saved.conversation_id}`, { replace: sendCid === '' });
          }
        } catch (persistErr) {
          console.error('Failed to persist agent conversation:', persistErr);
        }
      }
    } catch (err) {
      if (err.response?.status !== 401) setError(err.message || 'Agent research failed');
    } finally {
      setIsLoading(false);
      setLoadingForCid(null);
      setProgress(null);
    }
  };

  const handleSend = async () => {
    if (input.trim() === "") return;

    // Agent mode has its own streaming path.
    if (mode === 'agent') {
      const q = input;
      setInput("");
      await handleAgentSend(q);
      return;
    }

    const sendCid = cid ?? '';  // the tab this send belongs to ('' = new chat)
    // True while the user is still viewing the tab this request came from.
    const stillHere = () => (currentCidRef.current ?? '') === sendCid;

    const question = input;  // input gets cleared below; keep it for persistence
    const userMessage = { type: "user", content: question, created_at: new Date().toISOString() };
    setMessages([...messages, userMessage]);
    setInput("");
    setIsLoading(true);
    setLoadingForCid(sendCid);
    setProgress('Sending to Genie…');
    setError(null);

    try {
      const startUrl = conversationId.length === 0 ? '/api/genie/start' : '/api/genie/continue';
      const startBody = conversationId.length === 0
        ? { question }
        : { question, conversation_id: conversationId };

      const { data: started } = await axios.post(startUrl, startBody);
      if (!conversationId) setConversationId(started.conversation_id);

      const result = await pollUntilDone({
        conversation_id: started.conversation_id,
        message_id: started.message_id,
      });

      const hasResult = "query_result" in result;
      const botMessage = {
        type: "bot",
        content: hasResult ? result.description : result.content,
        table: hasResult ? result.query_result : null,
        schema: hasResult ? result.query_schema : null,
        columns: hasResult ? result.query_columns : null,
        viz: hasResult ? (result.query_viz || null) : null,
        created_at: new Date().toISOString(),
      };
      // Only render the answer if the user is still on the originating tab —
      // otherwise it would land on whatever conversation they switched to.
      if (stillHere()) setMessages((prev) => [...prev, botMessage]);

      // Persist the completed turn to Lakebase regardless of the current tab —
      // the answer belongs to its conversation thread and must not be lost if
      // the user navigated away (they'll see it when they return). Then refresh
      // the history list so the new/updated conversation appears in the sidebar.
      try {
        const { data: saved } = await axios.post('/api/genie/persist', {
          genie_conversation_id: started.conversation_id,
          question,
          answer: { content: botMessage.content, table: botMessage.table, schema: botMessage.schema, columns: botMessage.columns, viz: botMessage.viz },
        });
        loadConversations();
        // Put the conversation in the URL so a refresh stays on this thread —
        // but only if we're still on the originating tab, so we don't yank the
        // user away from a conversation they deliberately switched to.
        if (stillHere() && String(saved.conversation_id) !== sendCid) {
          loadedCidRef.current = String(saved.conversation_id);
          navigate(`/genie/c/${saved.conversation_id}`, { replace: sendCid === '' });
        }
      } catch (persistErr) {
        console.error('Failed to persist conversation:', persistErr);
      }
    } catch (err) {
      if (err.response?.status !== 401) {
        console.error("Error fetching Genie response:", err);
        setError(err.response?.data?.error || err.message || 'Failed to reach Genie');
      }
    } finally {
      setIsLoading(false);
      setLoadingForCid(null);
      setProgress(null);
    }
  };

  // The "answering…" indicator belongs only to the tab the request came from.
  const showLoading = isLoading && loadingForCid === (cid ?? '');

  return (
    <AppTheme>
      <CssBaseline enableColorScheme />
      {/* Fixed-height app shell: the page is exactly the viewport tall and the
          columns scroll internally, so the history rail always reaches the
          bottom instead of stopping short when the chat grows past one screen. */}
      <Box sx={{ display: "flex", height: "100vh", overflow: "hidden" }}>
        <SideMenu />
        <AppNavbar />

        <ConversationHistory
          conversations={conversations}
          activeId={activeConversationId}
          loading={historyLoading}
          onSelect={handleSelectConversation}
          onNew={handleNew}
          onDelete={requestDelete}
        />

        <Box
          component="main"
          sx={(theme) => ({
            flexGrow: 1,
            display: 'flex',
            flexDirection: 'column',
            height: '100vh',
            minHeight: 0,
            overflow: 'hidden',
            backgroundColor: theme.vars
              ? `rgba(${theme.vars.palette.background.defaultChannel} / 1)`
              : alpha(theme.palette.background.default, 1),
          })}
        >
          {/* Header + title, fixed at the top. */}
          <Box sx={{ flexShrink: 0, px: 3, pt: { xs: 8, md: 2 }, pb: 1 }}>
            <Header />
            {user ? <Box sx={{ mt: 1 }}>Ask Genie 💡</Box> : null}
          </Box>

          {/* Full-height, internally-scrolling message area (Genie-style) so
              long agent reports aren't boxed into a small fixed-height panel. */}
          <Box sx={{ flexGrow: 1, overflowY: 'auto', minHeight: 0, px: 3 }}>
            <Box sx={{ width: '100%', maxWidth: 1000, mx: 'auto', py: 2 }}>
                {messages.map((message, index) => (
                  message.trace ? (
                    <Box key={index} sx={{ mb: 1.5, display: 'flex', justifyContent: 'flex-start' }}>
                      <Box
                        sx={(theme) => ({
                          maxWidth: '92%',
                          width: '100%',
                          px: 1.75,
                          py: 1.25,
                          borderRadius: '18px 18px 18px 4px',
                          bgcolor: theme.palette.mode === 'dark'
                            ? theme.palette.background.paper
                            : theme.palette.common.white,
                          color: 'text.primary',
                          border: `1px solid ${theme.palette.divider}`,
                          boxShadow: 'none',
                        })}
                      >
                        <ResearchTrace trace={message.trace} />
                      </Box>
                    </Box>
                  ) : (
                    <ChatMessage key={index} message={message} />
                  )
                ))}
                {showLoading && (
                  <>
                    <LinearProgress sx={{ height: 3 }} />
                    {progress && (
                      <Box sx={{ textAlign: 'center', fontSize: 12, color: 'text.secondary', mt: 0.5 }}>
                        {progress}
                      </Box>
                    )}
                  </>
                )}
                <div ref={messagesEndRef} />
              </Box>
            </Box>

            {/* Composer pinned at the bottom, full width with content centered.
                The Chat/Agent mode selector lives inside the input, bottom-left,
                matching the Databricks Genie UI. */}
            <Box
              sx={(theme) => ({
                flexShrink: 0,
                borderTop: `1px solid ${theme.palette.divider}`,
                px: 3,
                py: 2,
              })}
            >
              <Box sx={{ width: '100%', maxWidth: 1000, mx: 'auto' }}>
                {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
                <Box
                  sx={(theme) => ({
                    border: `1px solid ${theme.palette.divider}`,
                    borderRadius: '22px',
                    bgcolor: theme.palette.background.paper,
                    px: 1.5,
                    py: 1,
                    transition: 'border-color 120ms ease',
                    '&:focus-within': { borderColor: theme.palette.primary.main },
                  })}
                >
                <TextField
                  fullWidth
                  multiline
                  maxRows={6}
                  variant="standard"
                  placeholder="Ask a question about your data…  (Enter to send, Shift+Enter for a new line)"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  disabled={isLoading}
                  InputProps={{ disableUnderline: true }}
                  sx={{ px: 0.5, py: 0.5 }}
                />

                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 0.5 }}>
                  {/* mode selector — a unified segmented switcher; the active
                      segment is a raised white chip, no grey fill */}
                  <Box
                    sx={(theme) => ({
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '2px',
                      p: '3px',
                      borderRadius: '999px',
                      border: `1px solid ${theme.palette.divider}`,
                    })}
                  >
                    {[
                      { key: 'agent', label: 'Agent', icon: <AutoAwesomeIcon fontSize="small" sx={{ color: '#8A63D2' }} />, tip: 'Agent Mode: multi-step research — reasons, runs multiple queries, and writes a cited report' },
                      { key: 'chat', label: 'Chat', icon: <ChatBubbleOutlineIcon fontSize="small" sx={{ color: '#D6409F' }} />, tip: "Chat: faster answers, best for 'what' questions" },
                    ].map((m) => {
                      const active = mode === m.key;
                      return (
                        <Tooltip key={m.key} title={m.tip}>
                          <span>
                            <Button
                              size="small"
                              disableRipple
                              disabled={isLoading}
                              onClick={() => setMode(m.key)}
                              startIcon={m.icon}
                              aria-pressed={active}
                              sx={(theme) => ({
                                textTransform: 'none',
                                borderRadius: '999px',
                                px: 1.5,
                                minWidth: 0,
                                color: 'text.primary',
                                fontWeight: active ? 600 : 500,
                                bgcolor: active ? theme.palette.background.paper : 'transparent',
                                border: `1px solid ${active ? theme.palette.divider : 'transparent'}`,
                                boxShadow: active ? `0 1px 2px ${alpha(theme.palette.common.black, 0.15)}` : 'none',
                                '&:hover': { bgcolor: active ? theme.palette.background.paper : theme.palette.action.hover },
                              })}
                            >
                              {m.label}
                            </Button>
                          </span>
                        </Tooltip>
                      );
                    })}
                  </Box>

                  {/* send */}
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <IconButton
                      onClick={handleSend}
                      disabled={isLoading || input.trim() === ""}
                      aria-label="Send message"
                      sx={(theme) => ({
                        border: 'none',
                        color: theme.palette.primary.main,
                        '&:hover': { border: 'none', bgcolor: theme.palette.action.hover },
                        '&.Mui-disabled': { border: 'none', color: theme.palette.text.disabled },
                        ...theme.applyStyles('dark', {
                          border: 'none',
                          color: theme.palette.primary.main,
                          '&:hover': { border: 'none', backgroundColor: theme.palette.action.hover },
                        }),
                      })}
                    >
                      <SendIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>

      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete conversation?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            “{deleteTarget?.title}” will be permanently deleted. This can’t be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button onClick={confirmDelete} color="error" variant="contained" sx={{ textTransform: 'none' }}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </AppTheme>
  );
}
