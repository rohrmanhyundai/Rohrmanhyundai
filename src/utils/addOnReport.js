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

const PROMPT = `This is a screenshot of a service-advisor "add-on" rank board table. Work carefully, column by column.

STEP 1 — Read the header row and list the column titles left to right. The usual order is:
RANK | STORE (or advisor name) | STORE SCORE | TICKETS | ADD-ON RATE | OIL-ONLY TKTS | ADD'L HRS / RO | ADD'L GP / TICKET | TOTAL ADD'L GP | +0.1HR UPSIDE
(Some may be missing or the screenshot may be cropped — use what is actually there.)

STEP 2 — Find EVERY row whose second column is a PERSON'S NAME (e.g. "JORDAN TROXEL", "DAVID RILEY"). Skip dealership/store rows like "FW Lexus" or "LAF Hyundai", headers, and totals. Do not stop early — count the person rows and return all of them, including the last one at the bottom edge.

STEP 3 — For each person row, transcribe the BIG number in every column in order into "cells" (ignore the small grey sub-labels like "5 pts", "49%", "$938 sales" underneath). Then fill the named fields FROM those cells:
- name: the name as printed
- tickets: the TICKETS column (whole number, e.g. 47)
- add_on_rate: ADD-ON RATE as printed, e.g. 51 for "51%"
- oil_only_tickets: OIL-ONLY TKTS big number (whole number, e.g. 23). It is ALWAYS smaller than tickets. It is NOT a dollar amount.
- addl_hrs_ro: ADD'L HRS / RO decimal, e.g. 0.57
- addl_gp_ticket: ADD'L GP / TICKET dollars (e.g. 84 for "$84"), null if absent
- total_addl_gp: TOTAL ADD'L GP dollars, null if absent

Sanity rule: oil_only_tickets ≈ tickets × (1 − add_on_rate/100). If yours doesn't fit, re-read the columns.

Return ONLY a JSON object, no markdown fences:
{"columns":["RANK","STORE",...],"rows":[{"name":"JORDAN TROXEL","cells":["#14","JORDAN TROXEL","39.6","47","51%","23","0.57","$84","$3,945","+$697"],"tickets":47,"add_on_rate":51,"oil_only_tickets":23,"addl_hrs_ro":0.57,"addl_gp_ticket":84,"total_addl_gp":3945}]}
If there are no person rows return {"columns":[],"rows":[]}.`;

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
      // The full 4o model reads dense tables far more reliably than mini
      // (mini slid columns and dropped rows). A screenshot is ~1–2¢.
      model: 'gpt-4o',
      temperature: 0,
      max_tokens: 1400,
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
  const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.rows) ? parsed.rows : null);
  if (!list) throw new Error('Unexpected reply from the reader — try again.');

  const warnings = [];
  const rows = list
    .filter(r => r && r.name)
    .map(r => {
      const row = {
        name: String(r.name).trim(),
        first: canonicalAdvisorFirst(r.name),
        tickets: num(r.tickets),
        add_on_rate: rate(r.add_on_rate),
        oil_only_tickets: num(r.oil_only_tickets),
        addl_hrs_ro: num(r.addl_hrs_ro),
        addl_gp_ticket: num(r.addl_gp_ticket),
        total_addl_gp: num(r.total_addl_gp),
      };
      // Tickets and the add-on rate are the big, unambiguous numbers on the
      // board and oil-only = tickets × (1 − rate) by definition. If the
      // oil-only read doesn't agree (or exceeds tickets), derive it instead of
      // storing a number pulled from the wrong column.
      if (row.tickets != null && row.add_on_rate != null) {
        const expect = Math.round(row.tickets * (1 - row.add_on_rate));
        const got = row.oil_only_tickets;
        if (got == null || got > row.tickets || Math.abs(got - expect) > Math.max(2, row.tickets * 0.06)) {
          if (got != null) warnings.push(`${row.first}: oil-only read as ${got} but ${row.tickets} tickets at ${(row.add_on_rate * 100).toFixed(0)}% means ${expect} — used ${expect}.`);
          row.oil_only_tickets = expect;
        }
      }
      return row;
    })
    .filter(r => r.first && (r.add_on_rate != null || r.addl_hrs_ro != null));
  return { rows, warnings, raw: text };
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
