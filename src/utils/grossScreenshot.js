// Gross from SCREENSHOTS of the group store board (stores down the side, LAF
// Hyundai expanded to its pay types). There are two of them — the Service gross
// board and the Parts gross board — laid out identically: GROSS / SALES / GP%,
// each Actual · Projected · Last Year. OpenAI vision reads LAF Hyundai's row and
// the category rows under it.
//
// A screenshot is month-to-date only (no daily rows like the PDF), so the day's
// Goal Forecast actual = the MTD gross minus the days already entered before it.

import { openaiRequest } from './openai';
import { loadGoalForecast } from './github';

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ''));
  r.onerror = () => reject(new Error('Could not read the image.'));
  r.readAsDataURL(file);
});

const PROMPT = `This is a screenshot of a dealership-group gross profit board. Rows are stores (e.g. "Kenosha Nissan", "Schaumburg Honda", "LAF Honda", "LAF Hyundai"), with state total rows ("ILLINOIS TOTAL"). ONE store may be expanded to show its pay-type rows underneath it (e.g. "Customer pay", "Warranty", "Internal", "Sublet", "Gas, oil, grease", "Counter retail", "Wholesale").

Columns, left to right: STORE, PROJ GROSS VS LY, then GROSS (ACTUAL, PROJECTED, LAST YEAR), SALES (ACTUAL, PROJECTED, LAST YEAR), GP% (ACTUAL, PROJECTED, LAST YEAR).

Find the store "LAF Hyundai" (NOT LAF Honda, LAF Kia, LAF Toyota or any other store). Return its own row as "total", and EVERY pay-type row listed directly under it as "rows" (stop at the next store). Use plain numbers without $ or commas; a blank or "·" cell is null.

Return ONLY JSON, no markdown fences:
{"store":"LAF Hyundai","total":{"gross":85176,"gross_projected":126474,"gross_ly":127779,"sales":110251,"sales_projected":163706,"sales_ly":169805},"rows":[{"name":"Customer pay","gross":45039,"gross_ly":59734,"sales":56196,"sales_ly":76072}]}
If LAF Hyundai is not on the screenshot, return {"store":null,"total":null,"rows":[]}.`;

const num = (v) => {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
};

// Parts has oil / counter / wholesale rows; service doesn't. Fall back to GP%
// (service labor runs ~75%+, parts ~40%).
function detectDept(total, rows) {
  if (rows.some(r => /gas|oil|grease|counter|retail|wholesale|tire/i.test(r.name))) return 'parts';
  if (rows.some(r => /sublet/i.test(r.name))) return 'service';
  if (total && total.gross && total.sales) return total.gross / total.sales > 0.6 ? 'service' : 'parts';
  return null;
}

export async function parseGrossScreenshot(file) {
  if (!/^image\//.test(file.type || '')) throw new Error('That is not an image — take a screenshot (PNG/JPG) of the gross board.');
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
  try { parsed = JSON.parse(text); } catch { throw new Error('Could not read the board from that image. Try a sharper screenshot with LAF Hyundai on it.'); }
  const t = parsed && parsed.total;
  const total = t ? {
    gross: num(t.gross), grossProjected: num(t.gross_projected), grossLy: num(t.gross_ly),
    sales: num(t.sales), salesProjected: num(t.sales_projected), salesLy: num(t.sales_ly),
  } : null;
  if (!total || total.gross == null) throw new Error("Couldn't find LAF Hyundai on that screenshot — make sure its row is showing, then screenshot again.");
  const rows = (Array.isArray(parsed.rows) ? parsed.rows : []).map(r => ({
    name: String(r.name || '').trim(),
    gross: num(r.gross), grossLy: num(r.gross_ly), sales: num(r.sales), salesLy: num(r.sales_ly),
  })).filter(r => r.name);
  return { dept: detectDept(total, rows), store: 'LAF Hyundai', total, rows };
}

// Category rows → the Goal Forecast breakdown shapes (same keys the PDF fills).
const pick = (rows, test, field) => rows.filter(r => test(r.name)).reduce((s, r) => s + (r[field] || 0), 0);
function laborBreakdownFrom(shot) {
  const side = (g) => {
    const total = shot.total[g === 'gross' ? 'gross' : 'grossLy'] || 0;
    const f = g === 'gross' ? 'gross' : 'grossLy';
    const cp = pick(shot.rows, n => /customer/i.test(n), f);
    const warranty = pick(shot.rows, n => /warrant/i.test(n), f);
    const internal = pick(shot.rows, n => /internal/i.test(n), f);
    // Whatever the named pay types don't explain (sublet, adjustments) lands here.
    return { cp, warranty, internal, unapplied: total - cp - warranty - internal, total };
  };
  return { mtd: side('gross'), ly: side('ly') };
}
function partsBreakdownFrom(shot) {
  const side = (ly) => {
    const g = ly ? 'grossLy' : 'gross', s = ly ? 'salesLy' : 'sales';
    const isTire = n => /tire/i.test(n);
    return {
      cpParts:       pick(shot.rows, n => /customer/i.test(n) && !isTire(n), g),
      cpTire:        pick(shot.rows, n => /customer/i.test(n) && isTire(n), g),
      warrantyParts: pick(shot.rows, n => /warrant/i.test(n), g),
      internalParts: pick(shot.rows, n => /internal/i.test(n) && !isTire(n), g),
      internalTire:  pick(shot.rows, n => /internal/i.test(n) && isTire(n), g),
      oilParts:      pick(shot.rows, n => /gas|oil|grease/i.test(n), g),
      oilRetail:     pick(shot.rows, n => /counter|retail/i.test(n), g),
      wholesale:     pick(shot.rows, n => /wholesale/i.test(n), s), // the card tracks wholesale SALES
      total:         shot.total[g] || 0,
    };
  };
  return { mtd: side(false), ly: side(true) };
}

// The working day the board's MTD runs through — the previous working day, so a
// morning upload lands on yesterday (Saturday on a Monday).
export function defaultThroughKey(d = new Date()) {
  const y = new Date(d); y.setDate(y.getDate() - 1);
  while (y.getDay() === 0) y.setDate(y.getDate() - 1);
  return `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
}

// Turn the read screenshots into what the Goal Forecast stores, per dept:
//   { mk, throughKey, depts: { service|parts: { mtd, prior, day, later, rows, extra } }, gaugePatch }
// `rows` = { [throughKey]: day } where day = MTD − the month's entries before it.
export async function buildScreenshotImport(shots, throughKey) {
  const mk = throughKey.slice(0, 7);
  const depts = {};
  for (const dept of ['service', 'parts']) {
    const shot = shots[dept];
    if (!shot) continue;
    let bucket = {};
    try { bucket = ((await loadGoalForecast(dept)) || {})[mk] || {}; } catch {}
    const actuals = bucket.actuals || {};
    const inMonth = Object.keys(actuals).filter(k => k.slice(0, 7) === mk);
    const prior = inMonth.filter(k => k < throughKey).reduce((s, k) => s + (Number(actuals[k]) || 0), 0);
    const mtd = shot.total.gross;
    const day = Math.round((mtd - prior) * 100) / 100;
    const extra = dept === 'service' ? { laborBreakdown: laborBreakdownFrom(shot) } : { partsBreakdown: partsBreakdownFrom(shot) };
    if (shot.total.grossLy > 0) extra.lastYear = shot.total.grossLy;
    depts[dept] = {
      mtd, prior, day, lastYear: shot.total.grossLy, oldLastYear: Number(bucket.lastYear) || 0,
      later: inMonth.filter(k => k > throughKey).length,
      rows: { [throughKey]: day }, extra,
    };
  }
  // Dashboard gauges: service MTD gross + customer-pay labor gross.
  const gaugePatch = {};
  if (depts.service) {
    gaugePatch.grossActual = depts.service.mtd;
    const cp = depts.service.extra.laborBreakdown.mtd.cp;
    if (cp) gaugePatch.cpActual = cp;
  }
  return { mk, throughKey, depts, gaugePatch };
}
