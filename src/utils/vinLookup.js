// VIN → vehicle → matching bulletins.
//
// A tech has a car on the lift and needs to know what's open on it. This decodes
// the VIN, reads each bulletin's "Applicable Vehicles" section, and reports which
// ones cover that exact vehicle.
//
// Accuracy matters more than tidiness here: telling someone "nothing open" when a
// recall applies is the one outcome to avoid. So anything that can't be confirmed
// is reported as needing a manual check rather than quietly dropped.

// ── VIN basics ───────────────────────────────────────────────────────────────
// I, O and Q are never used in a VIN — they'd be mistaken for 1 and 0.
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i;

export function validateVin(vin) {
  const v = (vin || '').trim().toUpperCase();
  if (!v) return { ok: false, vin: v, error: 'Enter a VIN.' };
  if (v.length !== 17) return { ok: false, vin: v, error: `A VIN is 17 characters — that one is ${v.length}.` };
  if (!VIN_RE.test(v)) return { ok: false, vin: v, error: 'That VIN contains a letter a VIN never uses (I, O or Q).' };
  return { ok: true, vin: v };
}

// Position 10 carries the model year. Used on its own only when the decoder
// can't be reached, so the tech still gets the year and can pick the model.
const YEAR_CODES = {
  A: 2010, B: 2011, C: 2012, D: 2013, E: 2014, F: 2015, G: 2016, H: 2017,
  J: 2018, K: 2019, L: 2020, M: 2021, N: 2022, P: 2023, R: 2024, S: 2025,
  T: 2026, V: 2027, W: 2028, X: 2029, Y: 2030,
  1: 2001, 2: 2002, 3: 2003, 4: 2004, 5: 2005, 6: 2006, 7: 2007, 8: 2008, 9: 2009,
};

export function yearFromVin(vin) {
  const c = (vin || '').toUpperCase()[9];
  return YEAR_CODES[c] || null;
}

// ── Decode ───────────────────────────────────────────────────────────────────
// NHTSA's vPIC service — free, no key, and it reports hybrid/EV status, which is
// what keeps a "Tucson Hybrid" recall off a gas Tucson.
const VPIC = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/';

export async function decodeVin(vin, { timeoutMs = 12000 } = {}) {
  const v = validateVin(vin);
  if (!v.ok) return { ok: false, error: v.error };

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${VPIC}${encodeURIComponent(v.vin)}?format=json`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`decoder returned ${res.status}`);
    const r = (await res.json())?.Results?.[0] || {};
    const year = parseInt(r.ModelYear, 10) || yearFromVin(v.vin);
    const model = (r.Model || '').trim();
    if (!model) throw new Error('decoder did not recognise that VIN');
    const elec = `${r.ElectrificationLevel || ''} ${r.FuelTypePrimary || ''}`;
    return {
      ok: true, source: 'nhtsa', vin: v.vin, year,
      make: (r.Make || 'Hyundai').trim(),
      model,
      trim: (r.Trim || r.Series || '').trim(),
      electrified: /HEV|PHEV|BEV|FCEV|Electric/i.test(elec),
      electrificationLabel: (r.ElectrificationLevel || '').replace(/\s*-\s*Level Unknown/i, '').trim(),
    };
  } catch (err) {
    // Offline / blocked / unrecognised: hand back the year from the VIN itself so
    // the tech can pick the model and still get an answer.
    const year = yearFromVin(v.vin);
    return {
      ok: false, source: 'offline', vin: v.vin, year,
      needsModel: true,
      error: /abort/i.test(err.name || '') ? 'The VIN decoder timed out.' : `Couldn't reach the VIN decoder (${err.message}).`,
    };
  }
}

// ── "Applicable Vehicles" parsing ────────────────────────────────────────────
const SECTION_END = /(Dealers must|Vehicle repairs|Parts Information|Warranty Information|Service Procedure|SST Information|Salt Belt Areas|\*\*\*)/i;
// Column headers and filler that must never end up inside a model name.
const NOISE_WORD = /^(?:certain|my|and|the|model|year|years|trim|production|date|dates|vehicle|vehicles|beginning|w|with|vin|all|also|includes?|in|plug)$/i;

// PDF extraction splits digits apart ("201 6 – 2017MY"). Rejoin only when the
// pieces form a plausible model year, so "Page 2 of 23" is left alone.
function healYears(s) {
  return s
    .replace(/\b(\d{1,3})\s(\d{1,3})\b/g, (full, a, b) => {
      const j = a + b;
      return (j.length === 4 && +j >= 1990 && +j <= 2100) ? j : full;
    })
    .replace(/\b(\d)\s(\d)\s(\d)\s(\d)\b/g, (full, ...d) => {
      const j = d.slice(0, 4).join('');
      return (+j >= 1990 && +j <= 2100) ? j : full;
    });
}

// → { entries: [{ name, code, hybrid, from, to }], raw }
export function parseApplicableVehicles(fullText) {
  const text = (fullText || '').replace(/\s+/g, ' ');
  const m = /Applicable\s+Vehicle\s?S?\b[^:]{0,24}:?/i.exec(text);
  if (!m) return { entries: [], raw: '' };
  let sec = text.slice(m.index + m[0].length);
  const e = SECTION_END.exec(sec);
  if (e && e.index > 30) sec = sec.slice(0, e.index);
  sec = sec.slice(0, 1200);
  const raw = sec.trim();

  // Production dates would otherwise read as model years.
  const clean = healYears(sec.replace(/\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{2,4}/g, ' '));

  // "Santa Fe Sport (AN)", "Sonata Hybrid (DN8 HEV)", "IONIQ 6 (CE EV)"
  const RE = /([A-Za-z][A-Za-z0-9]*(?:[ -][A-Za-z0-9]+){0,3}?)\s*\(\s*([A-Z0-9][A-Z0-9 \-]{0,10})\s*\)/g;
  const entries = [];
  let mm, lastYears = null;
  while ((mm = RE.exec(clean))) {
    let words = mm[1].split(/[\s-]+/).filter(Boolean);
    // Strip leading filler, bare numbers and year prefixes ("2017MY Elantra").
    // Leaving one on would make the name fail to match a real Elantra — a false
    // negative, which is the direction that hides an open recall.
    while (words.length && (NOISE_WORD.test(words[0]) || /^\d+$/.test(words[0]) || /^(?:19|20)?\d{2}my$/i.test(words[0]))) words.shift();
    const name = words.join(' ').trim();
    const code = mm[2].replace(/\s+/g, ' ').trim();
    if (!name || name.length < 3) continue;

    // In table layouts the Model Year cell gets swept into the name match, so
    // look inside the match as well as before it.
    const before = clean.slice(Math.max(0, mm.index - 70), mm.index) + ' ' + mm[1];
    const range = /\b((?:19|20)\d{2})\s*[–—-]\s*((?:19|20)?\d{2})\b/.exec(before);
    const single = /\b((?:19|20)\d{2})\b/.exec(before);
    let years = null;
    if (range) {
      const from = +range[1];
      let to = +range[2];
      if (to < 100) to = +(String(from).slice(0, 2) + String(range[2]).padStart(2, '0')); // "2013 – 18"
      years = { from, to: Math.max(from, to) };
    } else if (single) {
      years = { from: +single[1], to: +single[1] };
    }
    if (years) lastYears = years; else years = lastYears;   // table rows share the Model Year cell
    entries.push({
      name, code,
      hybrid: /hybrid|hev|phev|\bev\b/i.test(`${name} ${code}`),
      from: years?.from ?? null,
      to: years?.to ?? null,
    });
  }
  return { entries, raw };
}

// ── Matching ─────────────────────────────────────────────────────────────────
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const singular = s => s.replace(/\b(\w{4,})s\b/g, '$1');   // "Velosters" → "Veloster"
// The only words allowed to differ between the two names.
const ELEC_WORD = /^(hybrid|hev|phev|ev|n)$/i;

export function entryMatches(entry, vehicle) {
  const en = singular(norm(entry.name));
  const vn = singular(norm(vehicle.model));
  if (!en || !vn) return false;

  // Compare whole words in order. "Santa Fe Sport" is a different vehicle from
  // "Santa Fe", so the extra words are only allowed to be electrification words.
  const ew = en.split(' '), vw = vn.split(' ');
  const shorter = ew.length <= vw.length ? ew : vw;
  const longer  = ew.length <= vw.length ? vw : ew;
  if (!shorter.every((w, i) => longer[i] === w)) return false;
  if (longer.slice(shorter.length).some(w => !ELEC_WORD.test(w))) return false;

  if (!!entry.hybrid !== !!vehicle.electrified) return false;
  if (entry.from && vehicle.year && (vehicle.year < entry.from || vehicle.year > entry.to)) return false;
  return true;
}

// How a single bulletin relates to the vehicle:
//   'match'   — a listed vehicle covers it, year included
//   'year'    — the model matches but the bulletin's years couldn't be read
//   'unknown' — no readable vehicle list at all; a human has to look
//   'no'      — listed vehicles clearly don't include this one
export function bulletinMatch(item, vehicle) {
  const { entries, raw } = parseApplicableVehicles(item.searchText || '');
  if (!entries.length) return { status: 'unknown', entries: [], raw };
  const hits = entries.filter(e => entryMatches(e, vehicle));
  if (!hits.length) return { status: 'no', entries: [], raw };
  const anyYear = hits.some(h => h.from);
  return { status: anyYear ? 'match' : 'year', entries: hits, raw };
}

// Everything in one library, split into the three buckets the UI shows.
export function findBulletinsForVehicle(items, vehicle) {
  const matched = [], checkYear = [], unreadable = [];
  for (const it of items || []) {
    const r = bulletinMatch(it, vehicle);
    if (r.status === 'match') matched.push({ item: it, ...r });
    else if (r.status === 'year') checkYear.push({ item: it, ...r });
    else if (r.status === 'unknown') unreadable.push({ item: it, ...r });
  }
  return { matched, checkYear, unreadable };
}

// Model names to offer when the decoder can't be reached and the tech has to
// pick one. The section parser also picks up stray prose ("Cream White"), so
// this keeps only names that look like a model AND appear on more than one
// bulletin — a real model recurs across the library, a stray phrase doesn't.
export function knownModels(items) {
  const freq = new Map();
  for (const it of items || []) {
    const seen = new Set();
    for (const e of parseApplicableVehicles(it.searchText || '').entries) {
      const name = (e.name || '').replace(/\s+/g, ' ').trim();
      if (!name || seen.has(name)) continue;
      const words = name.split(' ');
      if (words.length > 3) continue;                       // model names are short
      if (!words.every(w => /^[A-Z0-9]/.test(w))) continue; // "below have instrument…"
      seen.add(name);
      freq.set(name, (freq.get(name) || 0) + 1);
    }
  }
  return Array.from(freq.entries())
    .filter(([, n]) => n >= 2)
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));
}
