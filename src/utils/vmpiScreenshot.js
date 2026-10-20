// VMPI from a SCREENSHOT of the group tech board (stores down the side, LAF
// Hyundai expanded to its techs). OpenAI vision reads each LAF Hyundai tech's
// TICKETS and VIDEO % — the VMPI number now. Same row shape as the CSV import
// (utils/vmpiReport parseVmpiReport) so the upload/apply path is shared:
//   { stamp, store, rows: [{ name, first, pct (0–1), ros (tickets), withVideo }] }
// There are no RO lists in a screenshot — just the percentages.

import { openaiRequest } from './openai';

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ''));
  r.onerror = () => reject(new Error('Could not read the image.'));
  r.readAsDataURL(file);
});

const PROMPT = `This is a screenshot of a service-technician performance board. Rows are dealership stores (e.g. "Indy Hyundai", "LAF Honda", "LAF Hyundai" with "N techs"); ONE store is expanded to show its technicians underneath it (each tech's FIRST name is printed small above the LAST name in bold, e.g. "CARTER" over "JEAN").

Columns, left to right: STORE, TECHNICIAN, TICKETS, MPI %, MPI VOIDED, VIDEO %, SENT %, REPEAT FILE, CP HRS, W HRS, ... (the header row may be cropped — use this order).

Find the store "LAF Hyundai" and return EVERY technician row listed under it (not the store rows, not other stores). For each tech:
- first: the small first name, last: the bold last name
- tickets: the TICKETS number (whole number)
- video_pct: the VIDEO % number (e.g. 57.7 for "57.7%") — NOT MPI %, NOT SENT %.
Also return "store_video_pct": LAF Hyundai's own VIDEO % on its store row.

Return ONLY JSON, no markdown fences:
{"store":"LAF Hyundai","store_video_pct":79.5,"techs":[{"first":"CARTER","last":"JEAN","tickets":52,"video_pct":57.7}]}
If LAF Hyundai's techs are not shown, return {"store":"LAF Hyundai","store_video_pct":null,"techs":[]}.`;

const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null; };

export async function parseVmpiScreenshot(file) {
  if (!/^image\//.test(file.type || '')) throw new Error('That is not an image — take a screenshot (PNG/JPG) of the tech board.');
  const res = await openaiRequest({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0,
      max_tokens: 1200,
      messages: [{ role: 'user', content: [
        { type: 'text', text: PROMPT },
        { type: 'image_url', image_url: { url: await readAsDataUrl(file), detail: 'high' } },
      ] }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `OpenAI error ${res.status}`);
  }
  const data = await res.json();
  const text = String(data.choices?.[0]?.message?.content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('Could not read the board from that image. Try a sharper screenshot with LAF Hyundai opened up.'); }
  const techs = Array.isArray(parsed?.techs) ? parsed.techs : [];
  const rows = techs.map(t => {
    const first = String(t.first || '').trim().split(/\s+/)[0].toUpperCase();
    const last = String(t.last || '').trim().toUpperCase();
    const pctRaw = num(t.video_pct);
    const tickets = num(t.tickets);
    if (!first || pctRaw == null || pctRaw < 0 || pctRaw > 100) return null;
    const pct = Math.round(pctRaw * 10) / 1000;          // 57.7 → 0.577
    const ros = tickets != null && tickets >= 0 ? Math.round(tickets) : null;
    return { name: [first, last].filter(Boolean).join(' '), first, pct, ros, withVideo: ros != null ? Math.round(ros * pct) : null };
  }).filter(Boolean);
  if (!rows.length) throw new Error("Couldn't find LAF Hyundai's technicians in that screenshot — open LAF Hyundai on the board so its techs show, then screenshot again.");
  const d = new Date();
  return {
    stamp: `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} (screenshot)`,
    store: 'LAF Hyundai',
    storePct: num(parsed?.store_video_pct) != null ? num(parsed.store_video_pct) / 100 : null,
    fromScreenshot: true,
    rows,
  };
}
