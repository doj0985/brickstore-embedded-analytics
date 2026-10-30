import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Typography, Link, Box } from '@mui/material';

// Renders LLM-generated markdown (agent reports, reasoning, and Genie chat text)
// with MUI-styled elements. The agent report is full markdown — headings, bold,
// bullet/numbered lists, links, and escaped-bracket citations like \[8\] — so a
// real markdown parser is required; hand-rolling it left raw "###" on screen.
//
// Everything inherits `color` so this works both in a light bot bubble and on a
// colored user bubble.
const components = {
  h1: (p) => <Typography variant="subtitle1" sx={{ fontWeight: 700, mt: 1.5, mb: 0.5, color: 'inherit' }} {...p} />,
  h2: (p) => <Typography variant="subtitle1" sx={{ fontWeight: 700, mt: 1.5, mb: 0.5, color: 'inherit' }} {...p} />,
  h3: (p) => <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1.25, mb: 0.5, color: 'inherit' }} {...p} />,
  h4: (p) => <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1, mb: 0.5, color: 'inherit' }} {...p} />,
  p: (p) => <Typography variant="body1" sx={{ mb: 1, lineHeight: 1.6, color: 'inherit', wordBreak: 'break-word' }} {...p} />,
  ul: (p) => <Box component="ul" sx={{ pl: 2.5, my: 0.5 }} {...p} />,
  ol: (p) => <Box component="ol" sx={{ pl: 2.5, my: 0.5 }} {...p} />,
  li: ({ children }) => (
    <Box component="li" sx={{ mb: 0.25 }}>
      <Typography variant="body1" component="span" sx={{ color: 'inherit', lineHeight: 1.6 }}>{children}</Typography>
    </Box>
  ),
  a: (p) => <Link target="_blank" rel="noreferrer" sx={{ fontWeight: 600 }} {...p} />,
  strong: (p) => <Box component="strong" sx={{ fontWeight: 700 }} {...p} />,
  hr: () => <Box component="hr" sx={{ border: 0, borderTop: (t) => `1px solid ${t.palette.divider}`, my: 1.5 }} />,
  blockquote: (p) => (
    <Box component="blockquote" sx={{ m: 0, my: 1, pl: 1.5, borderLeft: (t) => `3px solid ${t.palette.divider}`, color: 'text.secondary' }} {...p} />
  ),
  code: (p) => (
    <Box component="code" sx={{ px: 0.5, borderRadius: 0.5, bgcolor: 'action.hover',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.85em' }} {...p} />
  ),
  pre: (p) => (
    <Box component="pre" sx={{ m: 0, my: 1, p: 1, borderRadius: 1, overflowX: 'auto', bgcolor: 'action.hover',
      fontSize: 12, '& code': { bgcolor: 'transparent', p: 0 } }} {...p} />
  ),
  table: (p) => (
    <Box component="table" sx={{ borderCollapse: 'collapse', my: 1, width: '100%',
      '& td, & th': { border: (t) => `1px solid ${t.palette.divider}`, px: 1, py: 0.5, fontSize: 13, textAlign: 'left' } }} {...p} />
  ),
};

const Markdown = ({ children }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
    {children || ''}
  </ReactMarkdown>
);

export default Markdown;
