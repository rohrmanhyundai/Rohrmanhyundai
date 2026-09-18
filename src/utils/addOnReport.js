// $50 add-on report — screenshot import.
//
// The Rohrman Fixed Ops "advisor rank board" shows, per advisor: TICKETS,
// ADD-ON RATE, OIL-ONLY TKTS, ADD'L HRS/RO (plus GP columns we don't use).
// There's no export, so the manager screenshots it and the app has OpenAI's
// vision model read the table back as JSON. Rows are matched to the roster
// by first name (JORDAN TROXEL → JORDAN), with the usual report aliases.
//
// Relationship worth knowing: add-on rate = (tickets − oil-only) / tickets.
// So tickets are the $50 oil-change ROs and oil-only are the ones that left
// with nothing added — that's what makes the coaching pace math exact.

import { getOpenAIKey } from './openai';
import { canonicalAdvisorFirst } from './advisorAliases';

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ''));
  r.onerror = () => reject(new Error('Could not read the image.'));
  r.readAsDataURL(file);
});

const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null; };
// "51%" or "51" → 0.51 ; 0.51 stays 0.51
const rate = (v) => { const n = num(v); if (n == null) return null; return n > 1 ? n / 100 : n; };

const PROMPT = `This is a screenshot of a service-advisor "add-on" rank board. Read EVERY row that is an individual advisor (a person's name — skip store/dealership rows like "FW Lexus" or "LAF Hyundai", skip headers and totals).

For each advisor row return these columns exactly as printed (numbers only, no units):
- name: the advisor's name as printed
- tickets: the TICKETS column (whole number)
- add_on_rate: the ADD-ON RATE percentage (e.g. 51 for "51%")
- oil_only_tickets: the OIL-ONLY TKTS count (whole number, the large number — ignore the small percentage under it)
- addl_hrs_ro: the ADD'L HRS / RO value (decimal, e.g. 0.57)
- addl_gp_ticket: ADD'L GP / TICKET in dollars if present, else null
- total_addl_gp: TOTAL ADD'L GP in dollars if present, else null

Ignore the small "pts" and "sales" sub-labels under the numbers. Return ONLY a JSON array, no markdown fences, no commentary:
[{"name":"...","tickets":47,"add_on_rate":51,"oil_only_tickets":23,"addl_hrs_ro":0.57,"addl_gp_ticket":84,"total_addl_gp":3945}]
If you cannot find any advisor rows return [].`;

// → { rows: [{ name, first, tickets, add_on_rate(0-1), oil_only_tickets, addl_hrs_ro, addl_gp_ticket, total_addl_gp }], raw }
export async function parseAddOnScreenshot(file) {
  const key = getOpenAIKey();
  if (!key) throw new Error('No OpenAI API key set. Go to Admin Settings → OpenAI Settings.');
  if (!/^image\//.test(file.type || '')) throw new Error('That is not an image — take a screenshot (PNG/JPG) of the add-on board.');
  const dataUrl = await readAsDataUrl(file);

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 900,
      messages: [{ role: 'user', content: [
        { type: 'text', text: PROMPT },
        { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
      ] }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `OpenAI error ${res.status}`);
  }
  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content || '').trim();
  const json = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  let parsed;
  try { parsed = JSON.parse(json); } catch { throw new Error('Could not read a table from that image. Try a tighter, sharper screenshot of the advisor rows.'); }
  if (!Array.isArray(parsed)) throw new Error('Unexpected reply from the reader — try again.');

  const rows = parsed
    .filter(r => r && r.name)
    .map(r => ({
      name: String(r.name).trim(),
      first: canonicalAdvisorFirst(r.name),
      tickets: num(r.tickets),
      add_on_rate: rate(r.add_on_rate),
      oil_only_tickets: num(r.oil_only_tickets),
      addl_hrs_ro: num(r.addl_hrs_ro),
      addl_gp_ticket: num(r.addl_gp_ticket),
      total_addl_gp: num(r.total_addl_gp),
    }))
    .filter(r => r.first && (r.add_on_rate != null || r.addl_hrs_ro != null));
  return { rows, raw: text };
}

// Apply parsed rows onto a cloned advisor list. Returns { updated, skipped }.
export function applyAddOnRows(advisors, rows) {
  const updated = [], skipped = [];
  const stamp = Date.now();
  for (const r of rows) {
    const a = (advisors || []).find(x => canonicalAdvisorFirst(x.name) === r.first);
    if (!a) { skipped.push(r.name); continue; }
    if (r.addl_hrs_ro != null) a.roh50_hrs_ro = Math.round(r.addl_hrs_ro * 100) / 100;
    if (r.add_on_rate != null) a.roh50_add_rate = Math.round(r.add_on_rate * 1000) / 1000;
    if (r.tickets != null) a.lof_tickets = Math.round(r.tickets);
    if (r.oil_only_tickets != null) a.lof_oil_only = Math.round(r.oil_only_tickets);
    a._lastImport = stamp;
    updated.push(a.name);
  }
  return { updated, skipped };
}
