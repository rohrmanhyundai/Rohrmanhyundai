import { engineYearOk, engineMatches, isEngineOil, filterLines } from './fluidSpecs';

// ── Oil Capacity → 🖨 Print / Save PDF ────────────────────────────────────────
// One vehicle's fluid sheet as a clean, light, print-first page, printed from
// a hidden iframe so nothing leaves the screen. The browser's print dialog
// offers "Save as PDF"; the document title becomes the PDF's file name.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const yr = (v) => (v.yearTo && v.yearTo !== v.yearFrom ? `${v.yearFrom}–${v.yearTo}` : `${v.yearFrom}`);
const mono = (pn) => /^\d/.test(pn || '');

const CSS = `
@page { size: letter; margin: 14mm 13mm 16mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; background: #fff; color: #0f172a; font: 13px/1.45 "Inter", -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
.top { display: flex; align-items: center; gap: 12px; padding-bottom: 12px; border-bottom: 3px solid #0b2a5b; }
.badge { width: 38px; height: 38px; border-radius: 10px; background: linear-gradient(135deg, #0b2a5b, #1d4f91); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 19px; }
.brand { font-size: 11px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: #1d4f91; }
.doc { font-size: 18px; font-weight: 800; letter-spacing: -.01em; }
.meta { margin-left: auto; text-align: right; font-size: 11px; color: #64748b; }
.veh { margin: 18px 0 14px; display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; }
.veh h1 { margin: 0; font-size: 30px; line-height: 1.05; letter-spacing: -.02em; }
.chip { display: inline-block; font-size: 11px; font-weight: 800; padding: 3px 9px; border-radius: 999px; background: #eef2f8; color: #1e3a6b; margin-right: 6px; }
.chip.vin { font-family: ui-monospace, Menlo, Consolas, monospace; letter-spacing: .06em; }
.label { font-size: 10.5px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: #64748b; margin: 18px 0 8px; }
.oil { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
.card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 14px; break-inside: avoid; background: #fafbfd; }
.card.mine { border: 2px solid #16a34a; background: #f0fdf4; }
.card .eng { font-size: 11px; font-weight: 800; color: #475569; display: flex; justify-content: space-between; gap: 6px; }
.card .pill { font-size: 9.5px; font-weight: 900; color: #fff; background: #16a34a; border-radius: 999px; padding: 1px 7px; letter-spacing: .05em; }
.card .vol { font-size: 22px; font-weight: 800; letter-spacing: -.01em; margin-top: 3px; }
.card .spec { font-weight: 700; margin-top: 2px; }
.card .pn { font-size: 11.5px; color: #475569; margin-top: 3px; }
.card .note { font-size: 11px; color: #92400e; margin-top: 5px; }
.card .filter { display: inline-block; margin-top: 7px; padding: 3px 9px; border-radius: 8px; background: #eef2f8; font-size: 11.5px; }
.card .filter span { font-size: 9.5px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #64748b; }
table { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
th { text-align: left; font-size: 10px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #64748b; background: #f1f5f9; padding: 8px 10px; }
td { padding: 8px 10px; border-top: 1px solid #edf1f6; vertical-align: top; }
tr:nth-child(even) td { background: #fafbfd; }
tr { break-inside: avoid; }
td.fluid { font-weight: 700; } tr.filt td { background: #fffbeb !important; } tr.filt td:last-child { font-weight: 800; color: #0f172a; } td.vol { font-weight: 800; white-space: nowrap; } td.eng { color: #475569; white-space: nowrap; } td.eng.mine { color: #15803d; font-weight: 800; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
.tnote { font-size: 11px; color: #92400e; font-weight: 500; margin-top: 2px; }
.foot { margin-top: 18px; padding-top: 10px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; gap: 12px; font-size: 10.5px; color: #64748b; }
`;

export function fluidSheetHtml(v, { year, vin, decoded, by } = {}) {
  const rows = v.fluids.filter(f => engineYearOk(f.engine, year));
  const oil = rows.filter(isEngineOil), other = [...filterLines(oil), ...rows.filter(f => !isEngineOil(f))];
  const disp = decoded && decoded.displacement;
  const name = `${year || v.yearFrom} ${v.make ? v.make.charAt(0) + v.make.slice(1).toLowerCase() : ''} ${v.model.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')}`.replace(/\s+/g, ' ').trim();
  const now = new Date();
  const oilCards = oil.map(f => {
    const mine = engineMatches(f.engine, disp);
    return `<div class="card${mine ? ' mine' : ''}">
      <div class="eng"><span>${esc(f.engine || 'All engines')}</span>${mine ? '<span class="pill">YOUR ENGINE</span>' : ''}</div>
      <div class="vol">${esc(f.volume || '—')}</div>
      <div class="spec">${esc(f.spec)}</div>
      ${f.partNumber ? `<div class="pn">P/N <span class="${mono(f.partNumber) ? 'mono' : ''}">${esc(f.partNumber)}</span></div>` : ''}
      ${f.filter ? `<div class="filter"><span>Oil filter</span> <b class="${mono(f.filter) ? 'mono' : ''}">${esc(f.filter)}</b></div>` : ''}
      ${f.note ? `<div class="note">${esc(f.note)}</div>` : ''}
    </div>`;
  }).join('');
  const table = other.map(f => `<tr${f.isFilter ? ' class="filt"' : ''}>
      <td class="fluid">${esc(f.fluid)}${f.note ? `<div class="tnote">${esc(f.note)}</div>` : ''}</td>
      <td class="eng${engineMatches(f.engine, disp) ? ' mine' : ''}">${esc(f.engine || 'All')}</td>
      <td class="vol">${esc(f.volume)}</td>
      <td>${esc(f.spec)}</td>
      <td class="${mono(f.partNumber) ? 'mono' : ''}">${esc(f.partNumber)}${!f.isFilter && f.filter ? `${f.partNumber ? '<br>' : ''}<b class="${mono(f.filter) ? 'mono' : ''}">${esc(f.filter)}</b>` : ''}</td>
    </tr>`).join('');
  const title = `${name}${v.code ? ` ${v.code}` : ''} — Fluid Specs`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>
  <div class="top">
    <div class="badge">🛢</div>
    <div><div class="brand">Bob Rohrman Hyundai · Parts &amp; Service</div><div class="doc">Fluid Capacities &amp; Specifications</div></div>
    <div class="meta">Printed ${esc(now.toLocaleDateString())} ${esc(now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}${by ? `<br>by ${esc(by)}` : ''}</div>
  </div>
  <div class="veh">
    <h1>${esc(name)}</h1>
    <div>
      ${v.code ? `<span class="chip">${esc(v.code)}</span>` : ''}<span class="chip">Covers ${esc(yr(v))}</span>${vin ? `<span class="chip vin">VIN ${esc(vin)}</span>` : ''}${disp ? `<span class="chip">${esc(Number(disp).toFixed(1))}L engine</span>` : ''}
    </div>
  </div>
  ${oil.length ? `<div class="label">Engine oil</div><div class="oil">${oilCards}</div>` : ''}
  ${other.length ? `<div class="label">Other fluids</div><table><thead><tr><th>Fluid</th><th>Engine</th><th>Capacity</th><th>Specification</th><th>Part #</th></tr></thead><tbody>${table}</tbody></table>` : ''}
  <div class="foot">
    <span>Source: ${esc((v.source && v.source.fileName) || 'Oil Capacity')}. Always confirm against the owner's manual / HMA Tech Info.</span>
    <span>Rohrman Hyundai Dashboard</span>
  </div>
  </body></html>`;
}

// Print (or Save as PDF from the dialog) without leaving the page.
export function printFluidSheet(v, opts) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open(); doc.write(fluidSheetHtml(v, opts)); doc.close();
  const go = () => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch {}
    setTimeout(() => frame.remove(), 60000);
  };
  // Let layout settle (and any font) before printing.
  if (doc.readyState === 'complete') setTimeout(go, 150); else frame.onload = () => setTimeout(go, 150);
}
