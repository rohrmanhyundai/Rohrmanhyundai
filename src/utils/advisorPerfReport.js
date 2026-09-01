// Advisor Performance Report parsing.
//
// The dealer's Tekion "Advisor Performance Report" is read in Pay Type View,
// where each advisor row expands into a per-pay-type breakdown (Internal /
// Customer Pay / Warranty). Internal work isn't the advisor's own production,
// so the hours we report are:
//
//     MTD Hrs = Bill Hrs (advisor total) - Bill Hrs (Internal)
//
// e.g. Jordan: 320.4 total - 29.20 internal = 291.2, which is exactly
// Customer Pay 165.10 + Warranty 126.10.
//
// Nothing else is netted. RO Count, ELR (%), Coupon Labor and Total Sales all
// come straight off the advisor's top-level row — the pay-type RO counts
// overlap (one RO carries lines in several pay types) so they can't be summed
// or subtracted, and the percentages are ratios rather than totals.

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

const cleanText = (el) => String(el ? el.textContent : '').replace(/\s+/g, ' ').trim();

const toNum = (s) => {
  const v = parseFloat(String(s == null ? '' : s).replace(/[$,%\s]/g, ''));
  return isNaN(v) ? null : v;
};

// Direct children only — an advisor row hangs its Pay Type sub-table inside the
// same group, and we must not read cells belonging to that nested table.
const kids = (el, sel) => (el ? Array.from(el.querySelectorAll(':scope > ' + sel)) : []);

const stripWs = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

// First .rt-thead in document order belongs to this table — any nested Pay Type
// table sits further down, inside the body. Matched loosely (rather than as a
// direct child) so an extra wrapper div in Tekion's markup doesn't break it.
const headsOf = (table) => {
  const headRow = table.querySelector('.rt-thead .rt-tr');
  return headRow ? kids(headRow, '.rt-th').map(cleanText) : [];
};

const findHead = (heads, test) => heads.findIndex(h => test(h));

const isBillHrs = (h) => /^bill\s*(hrs|hours)$/i.test(h);
const isPayType = (h) => /^pay\s*type$/i.test(h);

// The advisor grid: has a Name column and Bill Hrs, and — unlike the expanded
// sub-tables — no Pay Type column.
function findAdvisorTable(doc) {
  for (const table of Array.from(doc.querySelectorAll('.rt-table'))) {
    const heads = headsOf(table);
    if (!heads.length) continue;
    if (heads.some(isPayType)) continue;
    const iName = findHead(heads, h => /^name$/i.test(h) || /advisor/i.test(h));
    if (iName === -1) continue;
    if (!heads.some(isBillHrs)) continue;
    return { table, heads, iName };
  }
  return null;
}

// The Pay Type sub-table hanging under one advisor row.
function payTypeTableIn(group) {
  for (const table of Array.from(group.querySelectorAll('.rt-table'))) {
    const heads = headsOf(table);
    const iType = findHead(heads, isPayType);
    const iHours = findHead(heads, isBillHrs);
    if (iType === -1 || iHours === -1) continue;
    return { table, iType, iHours };
  }
  return null;
}

// Sum the Bill Hrs of every Internal pay-type row (normally one, but a report
// that splits internal into sub-types still nets out correctly).
function internalHoursFrom(found) {
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
  const internal = payTypes
    .filter(p => /internal/i.test(p.type))
    .reduce((s, p) => s + (Number(p.hours) || 0), 0);
  return { payTypes, internal: round2(internal) };
}

// Parse a saved Tekion "Advisor Performance Report" page (Pay Type View).
// Returns { rows, warnings } where each row is:
//   { name, bill_hrs_total, internal_hours, mtd_hours, ro_count, elr,
//     coupon_labor, total_sales, payTypes, detailed }
export function parseAdvisorReportHtml(htmlText) {
  const doc = new DOMParser().parseFromString(String(htmlText || ''), 'text/html');
  const outer = findAdvisorTable(doc);
  if (!outer) {
    throw new Error('No advisor rows found. Open the Tekion "Advisor Performance Report" in Pay Type View, expand every advisor, save the page, then upload that .html file.');
  }

  const { table, heads, iName } = outer;
  const iBillHrs = findHead(heads, isBillHrs);
  const iROs     = findHead(heads, h => /^ro\s*count$/i.test(h));
  const iELR     = findHead(heads, h => ['elr(%)', 'elr%'].includes(stripWs(h)));
  const iCoupon  = findHead(heads, h => /coupon/i.test(h));
  const iSales   = findHead(heads, h => /^total\s*sales$/i.test(h));

  const rows = [];
  const warnings = [];
  // Direct-child groups only: a nested Pay Type table has groups of its own.
  const tbody = table.querySelector('.rt-tbody');
  const groups = tbody ? kids(tbody, '.rt-tr-group') : [];

  for (const group of groups) {
    const tr = kids(group, '.rt-tr')[0];
    if (!tr) continue;
    const tds = kids(tr, '.rt-td');
    if (!tds.length) continue;

    const name = cleanText(tds[iName]);
    if (!name || name === '-') continue;
    if (/^(total|grand|average|avg|summary)/i.test(name)) continue;   // summary row

    const cell = (i) => (i === -1 ? null : toNum(cleanText(tds[i])));
    const billHrs = cell(iBillHrs);

    const found = payTypeTableIn(group);
    let internal = 0, payTypes = [], detailed = true;
    if (found) {
      ({ payTypes, internal } = internalHoursFrom(found));
    } else {
      // Row wasn't expanded, so there's no Internal line to net out. Keep the
      // advisor's total hours and say so — the number will read high.
      detailed = false;
      warnings.push(`${name}: no Pay Type breakdown in the report — Internal hours were NOT subtracted, so MTD Hrs reads high. Expand this advisor before saving the page.`);
    }

    rows.push({
      name,
      bill_hrs_total: billHrs === null ? null : round2(billHrs),
      internal_hours: internal,
      mtd_hours: billHrs === null ? null : round2(billHrs - internal),
      ro_count: cell(iROs),
      elr: (() => { const v = cell(iELR); return v === null ? null : Math.round((v / 100) * 10000) / 10000; })(),
      coupon_labor: cell(iCoupon),
      total_sales: cell(iSales),
      payTypes,
      detailed,
    });
  }

  if (!rows.length) throw new Error('The report has no advisor rows other than the Total line.');
  return { rows, warnings, columns: { name: iName, bill_hrs: iBillHrs, ro_count: iROs, elr: iELR, coupon_labor: iCoupon, total_sales: iSales }, heads };
}

// Report row → the field set both importers write onto an advisor. Hrs/RO and
// Coupon Usage % are derived here so the two call sites stay in step.
export function advisorFieldsFromRow(row) {
  const fields = {};
  if (row.mtd_hours    !== null && row.mtd_hours    !== undefined) fields.mtd_hours = row.mtd_hours;
  // RO counts are whole numbers — a decimal or huge value means we grabbed the
  // wrong column, so leave the existing figure alone.
  if (row.ro_count     !== null && Number.isInteger(row.ro_count) && row.ro_count < 5000) fields.ro_count = row.ro_count;
  // Real ELR % sits roughly between 60-110; above 200 we matched something else.
  if (row.elr          !== null && row.elr !== undefined && row.elr <= 2) fields.elr = row.elr;
  if (row.coupon_labor !== null && row.coupon_labor !== undefined) fields.coupon_labor = row.coupon_labor;
  if (row.total_sales  !== null && row.total_sales  !== undefined) fields.total_sales = row.total_sales;
  return fields;
}
