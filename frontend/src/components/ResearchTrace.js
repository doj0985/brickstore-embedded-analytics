import React, { useState } from 'react';
import { Box, Typography, Chip, Button } from '@mui/material';
import { alpha } from '@mui/material/styles';
import PsychologyIcon from '@mui/icons-material/Psychology';
import StorageIcon from '@mui/icons-material/Storage';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ResultTable from './ResultTable';
import Markdown from './Markdown';
import VizImage from './VizImage';

// --- small parsers ----------------------------------------------------------

// Parse a markdown table (as emitted in function_call_output.output) into
// {title, columns, rows}. The output is "Title\n\n| a | b |\n|---|---|\n|1|2|".
const parseMarkdownTable = (md) => {
  if (typeof md !== 'string') return null;
  const lines = md.split('\n').map((l) => l.trim()).filter(Boolean);
  const headerIdx = lines.findIndex((l) => l.startsWith('|'));
  if (headerIdx === -1) return null;
  const pipeRows = lines.slice(headerIdx).filter((l) => l.startsWith('|'));
  if (pipeRows.length < 2) return null;
  const cells = (l) => l.split('|').slice(1, -1).map((c) => c.trim());
  const columns = cells(pipeRows[0]);
  const rows = pipeRows.slice(2).map((r) => {
    const vals = cells(r);
    return Object.fromEntries(columns.map((c, i) => [c, vals[i]]));
  });
  const title = headerIdx > 0 ? lines.slice(0, headerIdx).join(' ') : null;
  return { title, columns, rows };
};

// The report's inline citations link into the Databricks Genie workspace UI
// (…/genie/rooms/…?gra_focus=…). Embedded end users aren't workspace users, so
// those links are dead to them (and leak the internal workspace URL), and there
// is no footnote list to jump to — so strip the citation markers entirely for a
// clean read. Non-citation links (non-numeric text) are left intact.
const stripCitations = (text) => {
  if (typeof text !== 'string') return text;
  return text
    .replace(/\\?\[?\[(\d+)\]\(https?:\/\/[^)]*\)\\?\]?/g, '')
    .replace(/\s+([.,;:!?])/g, '$1')   // tidy space left before punctuation
    .replace(/[ \t]{2,}/g, ' ')
    .trimEnd();
};

// Convert a report table chunk's structured metadata into ResultTable props.
const tableFromMetadata = (meta) => {
  const columns = (meta.columns || []).map((c) => c.name);
  const schema = Object.fromEntries((meta.columns || []).map((c) => [c.name, c.type]));
  const rows = (meta.preview_rows || []).map((r) =>
    Object.fromEntries(columns.map((c, i) => [c, r[i]])));
  return { columns, schema, rows };
};

// --- step blocks ------------------------------------------------------------

const StepCard = ({ icon, label, color, children }) => (
  <Box sx={(theme) => ({
    mt: 1,
    p: 1.25,
    borderRadius: 2,
    border: `1px solid ${theme.palette.divider}`,
    bgcolor: alpha(theme.palette[color]?.main || theme.palette.primary.main, 0.04),
  })}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
      {icon}
      <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', letterSpacing: 0.3 }}>
        {label}
      </Typography>
    </Box>
    {children}
  </Box>
);

const Reasoning = ({ item }) => {
  const text = (item.content || []).map((c) => c.text).join('\n').trim();
  if (!text) return null;
  return (
    <StepCard icon={<PsychologyIcon fontSize="small" color="secondary" />} label="Reasoning" color="secondary">
      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: 'text.secondary', fontStyle: 'italic' }}>
        {text}
      </Typography>
    </StepCard>
  );
};

// A function_call (SQL) rendered together with its paired function_call_output.
const QueryStep = ({ call, output }) => {
  let title = 'Query';
  let sql = '';
  try {
    const args = JSON.parse(call.arguments || '{}');
    title = args.title || title;
    sql = args.sql || '';
  } catch { /* arguments schema may evolve; fall back to raw */ }

  const parsed = output && output.output ? parseMarkdownTable(output.output) : null;
  const running = !output || output.status !== 'completed';

  return (
    <StepCard icon={<StorageIcon fontSize="small" color="primary" />} label="SQL Query" color="primary">
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>{title}</Typography>
      {sql && (
        <Box component="pre" sx={(theme) => ({
          m: 0, p: 1, borderRadius: 1, overflowX: 'auto',
          bgcolor: theme.palette.mode === 'dark' ? theme.palette.grey[900] : theme.palette.grey[100],
          fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        })}>
          {sql}
        </Box>
      )}
      {running && <Typography variant="caption" color="text.secondary">Running query…</Typography>}
      {parsed && parsed.rows.length > 0 && (
        <ResultTable rows={parsed.rows} columns={parsed.columns} />
      )}
    </StepCard>
  );
};

// The final assistant report: text chunks (with citations) + table chunks, plus
// any Genie-generated chart. In agent mode a viz rides on a content chunk's
// metadata (chunk.metadata.viz.attachment_id); the backend resolves the space
// message id from conversationId, so that's all VizImage needs here.
const Report = ({ item, conversationId }) => (
  <Box sx={{ mt: 1 }}>
    {(item.content || []).map((chunk, i) => {
      const viz = chunk.metadata && chunk.metadata.viz;
      const vizImage = viz && viz.attachment_id && conversationId ? (
        <VizImage
          key={`${i}-viz`}
          agent
          conversationId={conversationId}
          attachmentId={viz.attachment_id}
          title={viz.title}
        />
      ) : null;

      let body;
      if (chunk.metadata && chunk.metadata.columns) {
        const { rows, columns, schema } = tableFromMetadata(chunk.metadata);
        body = <ResultTable rows={rows} columns={columns} schema={schema} />;
      } else if (chunk.text) {
        body = <Markdown>{stripCitations(chunk.text)}</Markdown>;
      }

      if (!body && !vizImage) return null;
      return (
        <React.Fragment key={i}>
          {body}
          {vizImage}
        </React.Fragment>
      );
    })}
  </Box>
);

const SystemError = ({ item }) => {
  const text = (item.content || []).map((c) => c.text).join('\n')
    || item.metadata?.error || 'The research run failed.';
  return <Typography variant="body2" color="error" sx={{ mt: 1 }}>{text}</Typography>;
};

// --- trace ------------------------------------------------------------------

const ResearchTrace = ({ trace }) => {
  const { items = [] } = trace || {};
  // Index function_call_output items by call_id so each query renders with its
  // result and we don't render outputs twice.
  const outputByCall = {};
  for (const it of items) {
    if (it && it.type === 'function_call_output') outputByCall[it.call_id] = it;
  }

  const reasoning = [];
  const queries = [];
  let report = null;
  let systemErr = null;
  for (const it of items) {
    if (!it) continue;
    if (it.type === 'reasoning') reasoning.push(it);
    else if (it.type === 'function_call') queries.push(it);
    else if (it.type === 'message' && it.role === 'assistant') report = it;
    else if (it.type === 'message' && it.role === 'system') systemErr = it;
  }

  const done = Boolean(report || systemErr);
  const hasSteps = reasoning.length > 0 || queries.length > 0;

  // Keep the trail visible live so the user watches progress; once the report
  // lands, collapse it so the answer is the focus. The user can override either
  // way (userExpanded: null = follow the default, true/false = explicit choice).
  const [userExpanded, setUserExpanded] = useState(null);
  const showSteps = userExpanded !== null ? userExpanded : !done;

  return (
    <Box>
      {/* Disclosure toggle — only once there's a report to put first. */}
      {done && hasSteps && (
        <Button
          size="small"
          onClick={() => setUserExpanded(!showSteps)}
          startIcon={showSteps ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          sx={{ textTransform: 'none', color: 'text.secondary', mb: 0.5, px: 0.5 }}
        >
          {showSteps
            ? 'Hide research'
            : `Show research · ${reasoning.length} step${reasoning.length === 1 ? '' : 's'}, ${queries.length} quer${queries.length === 1 ? 'y' : 'ies'}`}
        </Button>
      )}

      {/* The step-by-step research trail (reasoning + SQL steps). */}
      {showSteps && (
        <Box>
          {items.map((it, i) => {
            if (!it) return null;
            if (it.type === 'reasoning') return <Reasoning key={i} item={it} />;
            if (it.type === 'function_call') {
              return <QueryStep key={i} call={it} output={outputByCall[it.call_id]} />;
            }
            return null;
          })}
        </Box>
      )}

      {report && <Report item={report} conversationId={trace.conversationId} />}
      {systemErr && <SystemError item={systemErr} />}

      {/* Summary chip at the very start, before any steps have streamed in. */}
      {!done && !hasSteps && (
        <Chip size="small" label="Researching…" sx={{ mt: 1 }} />
      )}
    </Box>
  );
};

export default ResearchTrace;
