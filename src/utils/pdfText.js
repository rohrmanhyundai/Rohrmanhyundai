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

// ── The bulletin's own SUBJECT line ───────────────────────────────────────────
// Every Hyundai bulletin states its job in the header block: "SUBJECT: ANTI-THEFT
// IGNITION CYLINDER PROTECTOR & DECAL INSTALLATION (CUSTOMER SATISFACTION
// CAMPAIGN P33)". That's the manufacturer's own description of the work, so it
// beats a manager-typed title for finding a bulletin by what the job IS — and it
// carries wording the title often drops.
// PDF extraction sprinkles stray spaces inside words — real examples from this
// library: "D escription:", "W arranty", "R ADIATOR", "C ause Code". So every
// terminator is matched letter-by-letter with optional spaces between, or the
// subject runs on and swallows half the bulletin.
const looseWord = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split('').join('\\s*');
const loosePhrase = p => '\\b' + p.trim().split(/\s+/).map(looseWord).join('\\s+');

// Where the subject stops: the next section, or a running page header (later
// pages repeat "TSB #: … Page 2 of 2 SUBJECT:", which is how a subject used to
// run on into the page-2 body).
const SUBJECT_END = new RegExp('(?:' + [
  'Description:', 'Applicable Vehicles', 'Warranty Information', 'Information:',
  'This TSB supersedes', 'This bulletin supersedes', 'Circulate To',
  'NOTE:', 'GROUP', 'SUBJECT',
].map(loosePhrase).concat([
  '[*★☆]\\s*IMPORTANT',
  'TSB\\s*#',
  'Page\\s*\\d+\\s*of\\s*\\d+',
]).join('|') + ')', 'i');

// A subject is a short statement of the job. Body text that happens to follow a
// running header ("WARNING! GDS Vehicle Battery Voltage…", a bulleted table) is
// not, and must never land in a high-weight search field.
function looksLikeSubject(s) {
  if (!s || s.length < 4 || s.length > 200) return false;
  if (/[•■]/.test(s)) return false;
  return !/^(?:WARNING|CAUTION|NOTE|IMPORTANT|Page\b|\d+[.)]\s)/i.test(s);
}

export function extractSubject(fullText) {
  const text = (fullText || '').replace(/\s+/g, ' ');
  const re = /SUBJECT\s*:?\s*/gi;
  // Try the first few "SUBJECT" hits, not just the first: on some bulletins the
  // page-1 header extracts without the label, so the first hit is a page-2
  // running header. Anything that doesn't look like a subject is skipped, and
  // if none qualifies we return '' — label and body text still carry the search.
  for (let m, n = 0; (m = re.exec(text)) && n < 4; n++) {
    let s = text.slice(m.index + m[0].length);
    const end = SUBJECT_END.exec(s);
    if (end) s = s.slice(0, end.index);
    s = s.trim();
    if (looksLikeSubject(s)) return s;
  }
  return '';
}

// Derived subjects by item id. The subject comes out of the stored searchText,
// so every bulletin already in the library gets one with no re-index and no
// network — but an explicit `subject` on the item wins if one is ever stored.
export const subjectCache = {};

export function subjectFor(item) {
  if (!item) return '';
  if (item.subject) return item.subject;
  // Keyed by filename, not id: ids are only unique WITHIN a library, and the
  // generator pools TSBs and recalls together.
  const key = item.filename || item.id;
  if (subjectCache[key] != null) return subjectCache[key];
  const text = item.searchText || textCache[item.id] || '';
  if (!text) return '';                      // not indexed yet — don't cache ''
  const s = extractSubject(text);
  subjectCache[key] = s;
  return s;
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
  // Engine sizes must survive the split: "2.5T-GDI" has to become "25t"+"gdi",
  // not "2"(dropped)+"5t"+"gdi".
  const rest = raw.replace(BULLETIN_RE, ' ').replace(/(\d)\.(\d)/g, '$1$2');
  // Split on PUNCTUATION as well as spaces. Splitting on spaces alone and then
  // stripping punctuation glues neighbouring words into one nonsense token —
  // "INSP.,ANTI-THEFT S/W&DECAL" became "inspantitheft"/"swdecal", which appear
  // in no bulletin, so a perfectly good RO title matched nothing.
  const tokens = rest.split(/[^A-Za-z0-9]+/).map(norm).filter(t => t.length >= 2);
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
// The SUBJECT sits just under the title: it's Hyundai's own one-line statement
// of the job, so a hit there is nearly as good as one in the title and far
// better than a passing mention somewhere in the body.
const W_LABEL = 100, W_SUBJECT = 90, W_TAGS = 80, W_FILE = 40, W_TEXT = 10;

function tokenWeight(tok, hay) {
  // Short numeric tokens must start a word; anything else matches as a
  // substring so abbreviations still work ("prot" → "protection").
  const shortNum = tok.length <= 4 && /^\d+$/.test(tok);
  const hit = (loose, spaced) => shortNum ? spaced.includes(' ' + tok) : loose.includes(tok);
  if (hit(hay.label, hay.labelS)) return W_LABEL;
  if (hit(hay.subject, hay.subjectS)) return W_SUBJECT;
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
export function scoreItem(item, query, opts) {
  const parsed = parseQuery(query);
  // `ignoreNumbers` re-runs the query as a pure keyword search. rankedMatches
  // uses it when the number a tech typed is on NO bulletin in the library —
  // usually because they pasted the superseded number off an RO title
  // ("...&DECAL(24-01-009H-1)" when the library files it as 25-01-089H).
  const numbers = opts?.ignoreNumbers ? [] : parsed.numbers;
  const words = parsed.words;
  if (numbers.length === 0 && words.length === 0) return 0;

  const rawText = item.searchText || textCache[item.id] || '';
  const rawSubject = subjectFor(item);
  const label = norm(item.label), subject = norm(rawSubject), tags = norm(item.tags || '');
  const filename = norm(item.filename || ''), text = norm(rawText);
  const hay = {
    label, subject, tags, filename, text,
    labelS: normSpaced(item.label), subjectS: normSpaced(rawSubject), tagsS: normSpaced(item.tags || ''),
    filenameS: normSpaced(item.filename || ''), textS: normSpaced(rawText),
  };

  // ── Bulletin number: the strongest possible signal ─────────────────────────
  let numScore = 0;
  for (const n of numbers) {
    if (label.includes(n) || subject.includes(n) || tags.includes(n) || filename.includes(n)) numScore += 5000;
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
  const rank = opts => (items || [])
    .map((it, i) => ({ it, i, s: scoreItem(it, query, opts) }))
    .filter(m => m.s >= 0)
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map(m => m.it);

  let out = rank();
  // A number in the query normally decides the result. But when that number is
  // on nothing in the library — a superseded number, a typo, a campaign code we
  // don't file under — it must not veto the keywords too. Fall back to a
  // words-only search rather than showing the tech nothing.
  if (out.length === 0 && parseQuery(query).numbers.length) out = rank({ ignoreNumbers: true });
  return limit ? out.slice(0, limit) : out;
}
