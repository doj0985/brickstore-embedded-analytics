// Shared value/column formatting for Genie result tables.
//
// Genie (and the agent-mode report) returns every cell as a string with no type
// info, so we lean on the SQL type plus the column name for the things SQL can't
// express (currency, percentages). Extracted from ChatMessage so the chat
// bubble and the agent-mode research trace format identically.

const INT_TYPES = new Set(['LONG', 'INT', 'INTEGER', 'BIGINT', 'SHORT', 'SMALLINT', 'BYTE', 'TINYINT']);
const FLOAT_TYPES = new Set(['DOUBLE', 'FLOAT', 'REAL', 'DECIMAL', 'NUMERIC']);

// Names that should never be reformatted (grouping a year/id/zip is wrong).
const RAW_RE = /(^|_)(id|year|yr|code|zip|postal|phone|fips|key|account|sku|num|number)(_|$)/i;
const PERCENT_RE = /(percent|pct|_rate|rate$|conversion|margin|share)/i;
const CURRENCY_RE = /(revenue|sales|price|amount|cost|spend|profit|gmv|aov|payment|balance)/i;
const TEMPORAL_TYPES = new Set(['DATE', 'TIMESTAMP', 'TIMESTAMP_NTZ']);
const ISO_DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
// Initialisms that should stay uppercase in humanized headers. Extend as needed.
const ACRONYMS = new Set([
  'GMV', 'AOV', 'ID', 'SKU', 'URL', 'SLA', 'ARR', 'MRR', 'LTV', 'CAC',
  'ROI', 'KPI', 'USD', 'API', 'UPC', 'ASN', 'PO', 'EAN', 'YTD', 'MTD', 'QTD',
]);

export const isNumericType = (type) => {
  const t = (type || '').toUpperCase();
  return INT_TYPES.has(t) || FLOAT_TYPES.has(t);
};

const nf = (opts) => new Intl.NumberFormat('en-US', opts);

// Shorten ISO timestamps without timezone-shifting the date: parse the string
// directly (going through new Date() would roll a midnight-UTC value back a day
// in US timezones). Midnight collapses to date-only; otherwise drop seconds/ms.
const formatTemporal = (value) => {
  if (typeof value !== 'string') return value;
  const m = value.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
  if (!m) return value;
  const [, date, time] = m;
  return !time || time === '00:00' ? date : `${date} ${time}`;
};

// Turn raw SQL column names (lifetime_gmv, camelCase) into readable headers,
// keeping known initialisms uppercase: "lifetime_gmv" -> "Lifetime GMV".
export const humanizeHeader = (key) => {
  if (typeof key !== 'string' || !key) return key;
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\s]+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => {
      const u = w.toUpperCase();
      return ACRONYMS.has(u) ? u : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
};

export const formatCell = (value, type, name = '') => {
  if (value === null || value === undefined || value === '') return value ?? '';

  const t = (type || '').toUpperCase();
  // Timestamps/dates: shorten the ISO string (also catch unschema'd ISO values).
  if (TEMPORAL_TYPES.has(t) || (!t && typeof value === 'string' && ISO_DT_RE.test(value))) {
    return formatTemporal(value);
  }
  // Typed-but-non-numeric (strings, booleans) pass through untouched.
  if (t && !isNumericType(t)) return value;
  // Identifier-like columns stay raw even when stored as numbers.
  if (RAW_RE.test(name)) return value;

  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || (typeof value === 'string' && value.trim() === '')) return value;

  // Percentages: infer scale — fractions (<=1) are scaled to 0-100, values
  // already on a 0-100 scale are left as-is.
  if (PERCENT_RE.test(name)) {
    const pct = Math.abs(num) <= 1 ? num * 100 : num;
    return `${nf({ maximumFractionDigits: 2 }).format(pct)}%`;
  }
  if (CURRENCY_RE.test(name)) {
    return nf({ style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
  }
  // Whole numbers (typed int or float that landed on an integer): group, no decimals.
  if (INT_TYPES.has(t) || Number.isInteger(num)) {
    return nf({ maximumFractionDigits: 0 }).format(num);
  }
  // Generic decimals: cap the noise, but keep more precision for small ratios.
  const maxFrac = Math.abs(num) > 0 && Math.abs(num) < 1 ? 4 : 2;
  return nf({ maximumFractionDigits: maxFrac }).format(num);
};

// Short "Jun 13, 2:30 PM" timestamp for a message bubble.
export const formatMessageTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
