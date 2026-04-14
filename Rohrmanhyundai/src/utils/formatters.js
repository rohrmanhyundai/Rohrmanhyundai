export function safe(v, f = 0) {
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : f;
}

export function parsePercentInput(v, fallback = 0) {
  const raw = String(v ?? '').trim();
  if (!raw) return fallback;
  const hasPct = raw.includes('%');
  const num = parseFloat(raw.replace('%', '').trim());
  if (!Number.isFinite(num)) return fallback;
  if (hasPct) return num / 100;
  if (num > 1) return num / 100;
  return num;
}

export function percentEditValue(v) {
  const out = (safe(v, 0) * 100).toFixed(1);
  return (out.endsWith('.0') ? out.slice(0, -2) : out) + '%';
}

export function n(v, d = 1) {
  return safe(v, 0).toFixed(d);
}

export function pct(v, d = 1) {
  return (safe(v, 0) * 100).toFixed(d) + '%';
}

export function money(v) {
  return '$' + safe(v, 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function badgeCls(text) {
  const t = String(text || '').toLowerCase();
  if (t.includes('not') || t === 'no') return 'bad';
  if (t.includes('yes') || (t.includes('certified') && !t.includes('not'))) return 'good';
  return 'neutral';
}
