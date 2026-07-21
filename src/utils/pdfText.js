import { docRawUrl } from './github';

// Bulletin PDF text + search, shared by the TSB/Recall library and the Op Code
// Generator. Both used to carry their own copy of this with its OWN cache, so
// text the library had already extracted got re-downloaded and re-parsed the
// moment you opened the generator. One module, one cache: read a PDF once.

// ── PDF.js (CDN, shared singleton) ────────────────────────────────────────────
let pdfjsPromise = null;
export function loadPdfJs() {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = new Promise((resolve, reject) => {
    if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error('Failed to load PDF.js'));
    document.head.appendChild(script);
  });
  return pdfjsPromise;
}

// Extracted PDF text by item id — the single cache for the whole app.
export const textCache = {};

// Normalize for forgiving search: lowercase, strip everything but letters/digits.
// So "26-01-045H", "2601045h" and "26 01 045 h" all match each other.
export function norm(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const MAX_PAGES = 15; // cap for very long bulletins

// Text from every page of a PDF given its raw bytes. '' on any failure (e.g. an
// image-only/scanned PDF with no text layer).
export async function extractPdfTextFromBuffer(buf) {
  try {
    const pdfjs = await loadPdfJs();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    let text = '';
    const pages = Math.min(pdf.numPages, MAX_PAGES);
    for (let p = 1; p <= pages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      text += ' ' + content.items.map(i => i.str).join(' ');
    }
    return text;
  } catch {
    return '';
  }
}

// Text for a bulletin, cached by item id. Prefers `searchText` stored in the
// index at upload/re-index — no network at all, and it's there for every
// bulletin today. Falls back to fetching and parsing the PDF.
export async function extractPdfText(item, rawUrl) {
  if (item.searchText) { textCache[item.id] = item.searchText; return item.searchText; }
  if (textCache[item.id] != null) return textCache[item.id];
  try {
    const res = await fetch(rawUrl || docRawUrl(item.filename));
    const buf = await res.arrayBuffer();
    const text = await extractPdfTextFromBuffer(buf);
    textCache[item.id] = text;
    return text;
  } catch {
    textCache[item.id] = '';
    return '';
  }
}

// Same as norm() but keeps word boundaries as single spaces, padded with one on
// each end, so `" " + tok` tests whether a token starts a word. Used to stop a
// short number from matching inside a longer one ("298" vs "1298"/a date).
export function normSpaced(s) {
  return ' ' + (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
}

// Words that carry no search value in a repair-order concern line. Techs paste
// the whole line ("CUST REQ ONLY ANTITHEFT PROT. 25-BE-016H"), and under the old
// all-tokens-must-match rule the boilerplate ("cust", "req", "only") sank the
// search even though the bulletin number was sitting right there.
const NOISE = new Set([
  // RO / concern-line boilerplate
  'cust', 'customer', 'customers', 'states', 'state', 'stated', 'says', 'said',
  'req', 'reqs', 'request', 'requests', 'requested', 'requesting', 'only',
  'please', 'pls', 'plz', 'advise', 'adv', 'concern', 'complaint', 'cause',
  'correction', 'perform', 'performed', 'check', 'ck', 'chk', 'tech',
  'technician', 'found', 'veh', 'vehicle', 'car', 'ro', 'line', 'job', 'work',
  'op', 'code', 'codes', 'tsb', 'bulletin', 'recall', 'campaign', 'time',
  'hrs', 'hours', 'mi', 'miles', 'note', 'notes',
  // ordinary English filler
  'and', 'the', 'for', 'with', 'a', 'an', 'of', 'to', 'on', 'in', 'at', 'is',
  'it', 'be', 'by', 'or', 'per', 'from', 'this', 'that', 'all', 'any', 'no',
  'not', 'has', 'have', 'had', 'was', 'were', 'when', 'if', 'do', 'does',
  'done', 'see', 'need', 'needs', 'needed', 'want', 'wants', 'will', 'as',
]);

// Hyundai bulletin numbers: "25-BE-016H", "26-EM-012H", "20-01-045H-1" — two
// digits, a two/three-character group, a number, optional letter and revision.
// Spaces around the dashes are tolerated because PDFs and paste-ins are messy.
const BULLETIN_RE = /\b\d{2}\s*-\s*[A-Z0-9]{2,3}\s*-\s*\d{2,3}\s*[A-Z]?(?:\s*-\s*\d)?\b/gi;

// Split a query into what actually identifies a bulletin: the bulletin
// number(s), the meaningful keywords, and (for reference) the words we ignored.
// Exported so the search UI can show the tech what it understood.
export function parseQuery(query) {
  const raw = (query || '').trim();
  const found = raw.match(BULLETIN_RE) || [];
  const numbers = Array.from(new Set(found.map(norm).filter(Boolean)));
  // The same numbers as typed (minus stray spacing) — what to show a human.
  const numbersRaw = Array.from(new Set(found.map(n => n.replace(/\s+/g, '').toUpperCase())));
  const rest = raw.replace(BULLETIN_RE, ' ');
  const tokens = rest.split(/\s+/).map(norm).filter(t => t.length >= 2);
  const words = tokens.filter(t => !NOISE.has(t));
  const ignored = tokens.filter(t => NOISE.has(t));
  // If the query was ALL boilerplate ("recall", "tsb"), search it anyway rather
  // than searching nothing.
  return { numbers, numbersRaw, words: words.length ? words : tokens, ignored, tokens };
}

// Where a token was found, worth most in the title, least in the PDF body — so
// searching "298" lands on the bulletin titled "(RECALL 298)" rather than one
// that merely mentions 298 in a table. Body text still counts, which is what
// finds a bulletin by what it SAYS ("inoperable horn") and not just its number.
const W_LABEL = 100, W_TAGS = 80, W_FILE = 40, W_TEXT = 10;

function tokenWeight(tok, hay) {
  // Short numeric tokens must start a word; anything else matches as a
  // substring so abbreviations still work ("prot" → "protection").
  const shortNum = tok.length <= 4 && /^\d+$/.test(tok);
  const hit = (loose, spaced) => shortNum ? spaced.includes(' ' + tok) : loose.includes(tok);
  if (hit(hay.label, hay.labelS)) return W_LABEL;
  if (hit(hay.tags, hay.tagsS)) return W_TAGS;
  if (hit(hay.filename, hay.filenameS)) return W_FILE;
  if (hit(hay.text, hay.textS)) return W_TEXT;
  return 0;
}

// Relevance score for an item against the query, or -1 for "not a match".
//
// Matching is no longer all-or-nothing. A bulletin NUMBER in the query is
// treated as decisive: the bulletin carrying that number wins outright, and a
// bulletin that only mentions it in its body ranks below. Otherwise keywords
// score by where they hit, and an item qualifies when it covers enough of them
// — one word is enough for a short query or a title hit, half of a long one.
// That's what lets a pasted RO line find its bulletin instead of nothing.
export function scoreItem(item, query) {
  const { numbers, words } = parseQuery(query);
  if (numbers.length === 0 && words.length === 0) return 0;

  const label = norm(item.label), tags = norm(item.tags || '');
  const filename = norm(item.filename || ''), text = norm(item.searchText || textCache[item.id] || '');
  const hay = {
    label, tags, filename, text,
    labelS: normSpaced(item.label), tagsS: normSpaced(item.tags || ''),
    filenameS: normSpaced(item.filename || ''), textS: normSpaced(item.searchText || textCache[item.id] || ''),
  };

  // ── Bulletin number: the strongest possible signal ─────────────────────────
  let numScore = 0;
  for (const n of numbers) {
    if (label.includes(n) || tags.includes(n) || filename.includes(n)) numScore += 5000;
    else if (text.includes(n)) numScore += 150;   // referenced inside (supersedes, related)
  }

  // ── Keywords ──────────────────────────────────────────────────────────────
  let wordScore = 0, matched = 0, best = 0;
  for (const tok of words) {
    const w = tokenWeight(tok, hay);
    if (!w) continue;
    matched++; wordScore += w; best = Math.max(best, w);
  }
  // Reward covering more of what was typed, so the bulletin hitting 4 of 5
  // keywords outranks one that hits a single common word many times over.
  const coverage = words.length ? matched / words.length : 0;
  wordScore += Math.round(coverage * 120);

  if (numScore > 0) return numScore + wordScore;
  // A number was typed and this item isn't it — only keep it if the words alone
  // make a genuinely strong case (title/tag hit), well below any number match.
  if (numbers.length && best < W_TAGS) return -1;
  if (matched === 0) return -1;
  // How much of a multi-word query has to land. A lone word in a PDF body is a
  // real match for a one-word query and pure noise for anything longer ("door
  // latch" shouldn't list every bulletin that says "door"), so multi-word
  // queries need two keywords — half of them once the query gets long. A
  // title/tag hit always qualifies on its own.
  const need = words.length === 1 ? 1 : Math.max(2, Math.ceil(words.length * 0.5));
  if (matched < need && best < W_TAGS) return -1;
  return wordScore;
}

// Boolean match wrapper (kept for readability at call sites).
export function itemMatches(item, query) {
  return scoreItem(item, query) >= 0;
}

// All matching items, best match first (ties keep original/newest order).
export function rankedMatches(items, query, limit) {
  const out = items
    .map((it, i) => ({ it, i, s: scoreItem(it, query) }))
    .filter(m => m.s >= 0)
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map(m => m.it);
  return limit ? out.slice(0, limit) : out;
}
