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

// Relevance score for an item against the query. Every token must appear
// somewhere (title, manager tags, filename, or PDF text) or the item doesn't
// match at all (score -1). When it does match, WHERE each token is found is
// weighted: a hit in the TITLE or TAGS (e.g. the bulletin number a manager
// typed) counts far more than an incidental hit buried in the PDF body — so
// searching "298" opens the bulletin titled "(RECALL 298)" rather than some
// other PDF that merely mentions 298 in a date or table. Body text still counts,
// which is what lets you find a bulletin by what it SAYS ("inoperable horn",
// "oxidize") and not just by its number.
export function scoreItem(item, query) {
  const tokens = query.trim().split(/\s+/).filter(Boolean).map(norm).filter(Boolean);
  if (tokens.length === 0) return 0;
  const label = norm(item.label);
  const tags = norm(item.tags || '');
  const filename = norm(item.filename || '');
  const text = norm(item.searchText || textCache[item.id] || '');
  let total = 0;
  for (const tok of tokens) {
    let best;
    if (label.includes(tok)) best = 100;
    else if (tags.includes(tok)) best = 80;
    else if (filename.includes(tok)) best = 40;
    else if (text.includes(tok)) best = 10;
    else return -1; // token not found anywhere → not a match
    total += best;
  }
  return total;
}

// Boolean match wrapper (kept for readability at call sites).
export function itemMatches(item, query) {
  return scoreItem(item, query) >= 0;
}

// All matching items, best match first (ties keep original/newest order).
export function rankedMatches(items, query) {
  return items
    .map((it, i) => ({ it, i, s: scoreItem(it, query) }))
    .filter(m => m.s >= 0)
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map(m => m.it);
}
