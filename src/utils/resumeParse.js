import { loadPdfJs } from './pdfText';
import { EMAIL_RE, PHONE_RE, tidyPhone } from './contactPatterns';

/* Read a resume and pull out the name, phone and email.
 *
 * The bulletin extractor flattens a page into one string, which is right for
 * search and wrong here: on a resume the layout IS the information. The name is
 * the biggest text at the top; the contact details are the line under it. So
 * this keeps lines and font sizes and reads the top of page one the way a person
 * would.
 *
 * It fills blanks, never overwrites what someone typed, and every field is
 * editable afterwards — a wrong guess costs a correction, not a lost record.
 */

// Words that appear near the top of a resume but are never someone's name.
const NOT_A_NAME = /\b(resume|curriculum|vitae|\bcv\b|profile|summary|objective|professional|experience|education|skills|contact|address|phone|email|linkedin|portfolio|references|willing|seeking|available)\b/i;

// A line is a name if it reads like one: a few words, letters only, and none of
// the heading words above.
function looksLikeName(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (t.length < 3 || t.length > 40) return false;
  if (/[0-9@|/\\]/.test(t)) return false;          // digits, emails, separators
  if (NOT_A_NAME.test(t)) return false;
  const words = t.split(' ').filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  // Every word should be a word — letters, with the punctuation names carry.
  return words.every(w => /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\-]*$/.test(w));
}

// Group the page's text items into visual lines, tallest font first for ties.
function toLines(items) {
  const rows = new Map();
  for (const it of items) {
    const str = (it.str || '').trim();
    if (!str) continue;
    const y = Math.round((it.transform?.[5] ?? 0) / 3) * 3;   // tolerate tiny drift
    const size = Math.abs(it.transform?.[0] ?? it.height ?? 0);
    const row = rows.get(y) || { y, size: 0, parts: [] };
    row.size = Math.max(row.size, size);
    row.parts.push({ x: it.transform?.[4] ?? 0, str });
    rows.set(y, row);
  }
  return [...rows.values()]
    .sort((a, b) => b.y - a.y)                                 // PDF y grows upward
    .map(r => ({
      size: r.size,
      text: r.parts.sort((a, b) => a.x - b.x).map(p => p.str).join(' ').replace(/\s+/g, ' ').trim(),
    }))
    .filter(l => l.text);
}

export async function parseResume(file) {
  const empty = { name: '', phone: '', email: '' };
  try {
    const pdfjs = await loadPdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    const page = await pdf.getPage(1);                          // it's always page one
    const content = await page.getTextContent();
    const lines = toLines(content.items);
    if (!lines.length) return empty;

    const pageText = lines.map(l => l.text).join('\n');

    const email = (pageText.match(EMAIL_RE) || [''])[0].trim();
    // Skip anything that's part of a longer digit run — a fax/zip block or an
    // account number shouldn't become someone's phone.
    let phone = '';
    for (const m of pageText.matchAll(new RegExp(PHONE_RE, 'gi'))) {
      const before = pageText[m.index - 1] || '';
      const after = pageText[m.index + m[0].length] || '';
      if (/\d/.test(before) || /\d/.test(after)) continue;
      phone = tidyPhone(m[0]);
      break;
    }

    // The name: the biggest text near the top that reads like a name, falling
    // back to the first such line if the typography doesn't single one out.
    const top = lines.slice(0, 14);
    const candidates = top.filter(l => looksLikeName(l.text));
    let name = '';
    if (candidates.length) {
      const biggest = candidates.reduce((a, b) => (b.size > a.size ? b : a));
      name = biggest.text;
    }
    // Last resort: an email like first.last@… often carries the name when the
    // header is an image or a logo font.
    if (!name && email) {
      const local = email.split('@')[0].replace(/\d+/g, '');
      const parts = local.split(/[._-]+/).filter(p => p.length > 1);
      if (parts.length >= 2) {
        name = parts.slice(0, 2).map(p => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(' ');
      }
    }

    return { name: name.trim(), phone, email };
  } catch {
    return empty;   // an image-only scan, or a PDF we can't read — type it in
  }
}
