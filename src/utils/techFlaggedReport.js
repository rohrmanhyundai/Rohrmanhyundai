// Technician "Flagged Hours" report parsing.
//
// The dealer's Tekion Tech Performance report is read in Pay Type View, where
// each technician row expands into a per-pay-type breakdown (Warranty /
// Internal / Customer Pay). Warranty time pays at a higher rate than the clock
// hours suggest, so a tech's credited hours for the day are:
//
//     total = (warranty x WARRANTY_MULTIPLIER) + internal + customer pay
//
// e.g. 5 customer pay + 5 warranty + 1 internal => 5 + (5 x 1.4) + 1 = 13.0

export const WARRANTY_MULTIPLIER = 1.4;

// Every non-warranty pay type (Internal, Customer Pay, and anything new Tekion
// adds later) counts at face value; only warranty time is multiplied.
export function isWarrantyPayType(label) {
  return /warrant/i.test(String(label || ''));
}

export function payTypeWeight(label) {
  return isWarrantyPayType(label) ? WARRANTY_MULTIPLIER : 1;
}

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

// payTypes: [{ type, hours }] -> { warranty, other, total }
export function weightedTotal(payTypes) {
  let warranty = 0, other = 0;
  for (const p of payTypes || []) {
    const h = Number(p.hours) || 0;
    if (isWarrantyPayType(p.type)) warranty += h; else other += h;
  }
  return { warranty: round2(warranty), other: round2(other), total: round2(warranty * WARRANTY_MULTIPLIER + other) };
}

const cleanText = (el) => String(el ? el.textContent : '').replace(/\s+/g, ' ').trim();
const toNum = (s) => {
  const v = parseFloat(String(s == null ? '' : s).replace(/[$,\s]/g, ''));
  return isNaN(v) ? 0 : v;
};
// Direct children only — a pay-type row can itself be expandable, and we must
// not read cells belonging to a nested sub-table.
const kids = (el, sel) => (el ? Array.from(el.querySelectorAll(':scope > ' + sel)) : []);

// Locate the Pay Type sub-table hanging under one technician row.
function payTypeTableIn(group) {
  for (const table of Array.from(group.querySelectorAll('.rt-table'))) {
    const headRow = table.querySelector('.rt-thead .rt-tr');
    if (!headRow) continue;
    const heads = kids(headRow, '.rt-th').map(cleanText);
    const iType = heads.findIndex(h => /^pay type$/i.test(h));
    const iHours = heads.findIndex(h => /^flagged hours$/i.test(h));
    if (iType === -1 || iHours === -1) continue;
    return { table, iType, iHours };
  }
  return null;
}

// Parse a saved Tekion "Tech Performance | Service" page (Pay Type View).
// Returns { rows: [{ name, payTypes, warranty, other, total, detailed }], warnings }
export function parseTechReportHtml(htmlText) {
  const doc = new DOMParser().parseFromString(String(htmlText || ''), 'text/html');
  const nameCells = Array.from(doc.querySelectorAll('[data-test-id*="-TECHNICIAN-cell-"]'));
  if (!nameCells.length) {
    throw new Error('No technician rows found. Save the Tekion "Tech Performance" page with the report on screen, then upload that .html file.');
  }

  const rows = [];
  const warnings = [];
  for (const cell of nameCells) {
    const name = cleanText(cell);
    if (!name || name === '-' || /^total$/i.test(name)) continue;   // summary row

    const group = cell.closest('.rt-tr-group');
    const outerRow = cell.closest('.rt-tr');
    const found = group ? payTypeTableIn(group) : null;

    if (!found) {
      // Row wasn't expanded into Pay Type View — fall back to the flat flagged
      // total so the tech still gets hours, and say so in the preview.
      const flagCell = outerRow && outerRow.querySelector('[data-test-id*="-FLAGGED_TIME-cell-"]');
      const flat = round2(toNum(cleanText(flagCell)));
      rows.push({ name, payTypes: [], warranty: 0, other: flat, total: flat, detailed: false });
      warnings.push(`${name}: no Pay Type breakdown in the report — used the flat flagged total (${flat.toFixed(2)}), no warranty multiplier applied.`);
      continue;
    }

    const { table, iType, iHours } = found;
    const payTypes = [];
    for (const g of Array.from(table.querySelectorAll('.rt-tbody .rt-tr-group'))) {
      const tr = kids(g, '.rt-tr')[0];
      if (!tr) continue;
      const tds = kids(tr, '.rt-td');
      const type = cleanText(tds[iType]);
      if (!type || /^total$/i.test(type)) continue;
      payTypes.push({ type, hours: round2(toNum(cleanText(tds[iHours]))) });
    }

    const { warranty, other, total } = weightedTotal(payTypes);
    rows.push({ name, payTypes, warranty, other, total, detailed: true });
  }

  if (!rows.length) throw new Error('The report has no technician rows other than the Total line.');
  return { rows, warnings };
}
