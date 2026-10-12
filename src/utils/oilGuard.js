// Oil Guard 3X — prepaid oil-change packages, read from the DMS "Schedule
// 3029 — Schedule Summary with Detail" PDF (account 3029 OIL GUARD 3X).
//
// How the report is laid out (checked against the balances, which always add up):
//   VIN line      5NMJECDE3RH325770 620 OG3 -59.99      ← VIN, age (days), last code, balance
//   header        Posting Accounting Date Journal Reference …
//   detail lines  05/14/26 41 777552 Auto Posting 3029 56.68 OG3 0
//                 01/30/25 41 766302 Auto Posting 3029 -175.00 Fee code - OILGuard3X 1
// The detail lines UNDER a VIN line belong to that VIN.
//
// The rule: every package payment ("Fee code - OILGuard3X", negative amount)
// buys 3 oil changes; every OG1/OG2/OG3 line (with or without a trailing G)
// uses one — whatever number it was billed under. Left = 3 × packages − used.
//
// Problems the report can't settle on its own are listed as issues for a
// manager, who fixes them with a remembered fix (fixes survive re-uploading
// the full-history PDF). Fix keys are built from the VIN + RO + amount + code,
// so they keep pointing at the same line in every upload.

export const PER_PACKAGE = 3;

// Last code can be blank on the VIN line ("KM8RMES26TU057366 285 -113.34").
const VIN_RE = /^([A-HJ-NPR-Z0-9]{17})\s+(\d+)\s+(?:(\S+)\s+)?(-?[\d,]+\.\d\d)\s*$/;
const DETAIL_RE = /^(\d\d\/\d\d\/\d\d)\s+(\d+)\s+(\S+)\s+(Auto Posting|General|[A-Za-z ]+?)\s+3029\s+(-?[\d,]+\.\d\d)\s*(.*?)\s+(-?\d+)\s*$/;
// The code can carry a description after it: "OG1 OIL GUARD 3X", "OG2G GV70".
const USE_RE = /^OG([123])G?(?:\s|$)/i;
const money = (s) => Number(String(s).replace(/,/g, '')) || 0;
const r2 = (n) => Math.round(n * 100) / 100;

// "05/14/26" → "2026-05-14" (sortable)
export const isoOf = (mmddyy) => { const [m, d, y] = mmddyy.split('/'); return `20${y}-${m}-${d}`; };
export const prettyDate = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${+m}/${+d}/${y.slice(2)}`; };

// ── Text lines → VIN blocks ──────────────────────────────────────────────────
export function parseLines(lines) {
  const blocks = [];
  const stray = [];          // detail lines with no VIN above them
  let reportStamp = '';
  let cur = null;
  for (const raw of lines) {
    const line = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (!reportStamp && /^\d\d\/\d\d\/\d\d \d{1,2}:\d\d [AP]M/.test(line)) { reportStamp = line.replace(/\s+-?[\d,]+\.\d\d$/, ''); continue; }
    if (/^Posting Accounting Date/i.test(line) || /^Control Age Control 2/i.test(line)) continue;
    const v = VIN_RE.exec(line);
    if (v) {
      cur = { vin: v[1], age: Number(v[2]), last: v[3] || '', balance: money(v[4]), lines: [] };
      blocks.push(cur);
      continue;
    }
    const d = DETAIL_RE.exec(line);
    if (d) {
      const row = {
        date: isoOf(d[1]), journal: d[2], ro: d[3], type: d[4].trim(),
        amount: money(d[5]), text: d[6].trim(), count: Number(d[7]),
      };
      if (cur) cur.lines.push(row); else stray.push(row);
      continue;
    }
    // Anything else is noted so the manager can see what wasn't understood.
    if (cur) cur.lines.push({ unparsed: line });
    else stray.push({ unparsed: line });
  }
  return { reportStamp, blocks, stray };
}

// ── One line's meaning ───────────────────────────────────────────────────────
export const lineKey = (vin, l) => [vin, l.ro || '', l.amount != null ? l.amount.toFixed(2) : '', l.text || l.unparsed || ''].join('|');
function classify(l) {
  if (l.unparsed) return 'unknown';
  if (/fee code/i.test(l.text) && /oilguard/i.test(l.text.replace(/\s/g, '')) && l.amount < 0) return 'package';
  if (USE_RE.test(l.text) && l.amount > 0) return 'use';
  return 'unknown';
}

// ── Analyse a block (with fixes applied) ─────────────────────────────────────
// fixes (all remembered across uploads):
//   [lineKey]   { as: 'package'|'use'|'ignore'|'credit', n, note } — re-read one line
//               ('credit' = adds n oil changes, e.g. a TRANSFER from another VIN)
//   [issue id]  { reviewed: true, note }                  — looked at, leave it
//   [`${vin}|*`] { adjust: ±n, note }                     — add/remove oil changes
export function analyse(block, fixes = {}) {
  const vin = block.vin;
  const events = [];
  const issues = [];
  for (const l of block.lines) {
    const key = lineKey(vin, l);
    const fix = fixes[key];
    let kind = classify(l);
    const auto = kind;
    if (fix && fix.as) kind = fix.as;
    events.push({ ...l, key, kind, auto, fixed: !!(fix && fix.as), note: fix && fix.note });
    if (auto === 'unknown') {   // listed even once fixed, so the fix can be seen and undone
      issues.push({
        id: key, type: 'unknown', lineKey: key,
        title: l.unparsed ? 'Line the reader couldn\'t understand' : `Line that isn't a package or an oil change`,
        detail: l.unparsed ? l.unparsed : `${prettyDate(l.date)} · RO ${l.ro} · ${l.type} · $${l.amount.toFixed(2)}${l.text ? ` · ${l.text}` : ''}`,
        fixes: ['package', 'use', 'credit', 'ignore'],
        // A negative amount is value moved IN — suggest how many oil changes it covers.
        suggestCredit: !l.unparsed && l.amount < 0 ? Math.max(1, Math.round(-l.amount / (170 / PER_PACKAGE))) : 1,
      });
    }
  }
  // Oldest first; on the same day the package comes before the oil change it covers.
  const order = { package: 0, credit: 0, use: 1, unknown: 2, ignore: 3 };
  events.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || (order[a.kind] - order[b.kind]));

  let bought = 0, used = 0, inPkg = 0, pkgNo = 0;
  let overdrawnAt = null;
  for (const e of events) {
    if (e.kind === 'package') { bought += PER_PACKAGE; pkgNo += 1; inPkg = 0; e.pkgNo = pkgNo; }
    else if (e.kind === 'credit') { const n = Number((fixes[e.key] || {}).n) || 0; bought += n; e.credit = n; inPkg = Math.max(0, PER_PACKAGE - n); if (!pkgNo) pkgNo = 1; }
    else if (e.kind === 'use') {
      used += 1;
      if (pkgNo === 0 || inPkg >= PER_PACKAGE) { if (!overdrawnAt) overdrawnAt = e; }
      inPkg += 1;
      e.pkgNo = pkgNo; e.nth = inPkg;
      const billed = Number((USE_RE.exec(e.text || '') || [])[1]);
      if (billed && pkgNo > 0 && inPkg <= PER_PACKAGE && billed !== inPkg && e.auto === 'use') {
        e.misbilled = `billed as OG${billed}, should be OG${inPkg}`;
        issues.push({
          id: `${e.key}#bill`, type: 'billing', lineKey: e.key,
          title: `Billed as OG${billed} — should have been OG${inPkg}`,
          detail: `${prettyDate(e.date)} · RO ${e.ro}. Still counted as oil change ${inPkg} of package ${pkgNo}; the total isn't affected.`,
          fixes: ['reviewed'], minor: true,
        });
      }
    }
  }
  const vinFix = fixes[`${vin}|*`] || {};
  const adjust = Number(vinFix.adjust) || 0;
  const left = bought - used + adjust;

  if (overdrawnAt) {
    issues.push({
      id: `${vin}|over`, type: 'overdrawn',
      title: bought === 0 ? 'Oil change used with no package on file' : 'More oil changes used than were paid for',
      detail: `${used} used against ${bought} paid${overdrawnAt ? ` — first one over on ${prettyDate(overdrawnAt.date)}, RO ${overdrawnAt.ro}` : ''}. Left shows ${left}.`,
      fixes: ['adjust', 'reviewed'],
    });
  }
  // The account balance is the check: the lines under a VIN always total it.
  const sum = r2(block.lines.reduce((s, l) => s + (l.amount || 0), 0));
  if (Math.abs(sum - block.balance) > 0.02) {
    issues.push({
      id: `${vin}|sum`, type: 'balance',
      title: 'Lines don\'t add up to the account balance',
      detail: `Lines total $${sum.toFixed(2)} but the VIN line says $${block.balance.toFixed(2)} — a line may be missing from the PDF read.`,
      fixes: ['adjust', 'reviewed'],
    });
  } else if (!issues.some(i => i.type === 'unknown' && !(fixes[i.lineKey] && fixes[i.lineKey].as))) {
    // (An unread line explains any gap by itself — fixing it settles this too.)
    // Balance → oil changes it still covers (one third of the package price each).
    const pkgs = events.filter(e => e.kind === 'package');
    const share = pkgs.length ? Math.abs(pkgs[pkgs.length - 1].amount) / PER_PACKAGE : 170 / PER_PACKAGE;
    const byBalance = Math.round(-block.balance / share);
    const leftBeforeAdjust = bought - used;
    if (byBalance !== leftBeforeAdjust && Math.abs(-block.balance - leftBeforeAdjust * share) > share * 0.25) {
      issues.push({
        id: `${vin}|bal`, type: 'mismatch',
        title: `Balance says ${byBalance} left, lines say ${leftBeforeAdjust}`,
        detail: `Account balance $${block.balance.toFixed(2)} covers about ${byBalance} oil change${byBalance === 1 ? '' : 's'} at $${share.toFixed(2)} each.`,
        fixes: ['adjust', 'reviewed'],
      });
    }
  }
  // How each issue was settled, and the fix key that undoes it.
  for (const i of issues) {
    const own = fixes[i.id];
    const line = i.lineKey && fixes[i.lineKey];
    if (i.type === 'unknown' && line && line.as) {
      i.resolved = true; i.undoKey = i.lineKey; i.note = line.note;
      i.fixedBy = line.as === 'credit' ? `counted as +${line.n} oil change${line.n === 1 ? '' : 's'}` : line.as === 'package' ? 'counted as a package' : line.as === 'use' ? 'counted as an oil change' : 'ignored';
    }
    else if (own && own.reviewed) { i.resolved = true; i.undoKey = i.id; i.note = own.note; }
    else if (adjust && i.type !== 'unknown' && i.type !== 'billing') { i.resolved = true; i.undoKey = `${vin}|*`; i.note = vinFix.note; i.fixedBy = `adjusted ${adjust > 0 ? '+' : ''}${adjust}`; }
    else i.resolved = false;
  }
  return {
    vin, age: block.age, last: block.last, balance: block.balance,
    packages: events.filter(e => e.kind === 'package').length,
    bought, used, adjust, left, events, issues,
    note: vinFix.note || '',
  };
}

export function analyseAll(store, fixes = {}) {
  const blocks = (store && store.blocks) || [];
  const out = {};
  for (const b of blocks) {
    const a = analyse(b, fixes);
    // The same VIN twice in one report: merge into the first.
    if (out[b.vin]) {
      const merged = analyse({ ...b, lines: [...findBlock(blocks, b.vin).lines, ...b.lines] }, fixes);
      out[b.vin] = merged;
    } else out[b.vin] = a;
  }
  return out;
}
const findBlock = (blocks, vin) => blocks.find(b => b.vin === vin);

// Normalised search: VIN chars only, uppercase; I/O/Q never appear in a VIN.
export const cleanVin = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/[IQ]/g, (c) => (c === 'I' ? '1' : '0'));
