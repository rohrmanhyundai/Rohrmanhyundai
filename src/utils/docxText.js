/* Read the text out of an uploaded document — .docx, .rtf or plain text — with
 * no library.
 *
 * A .docx is a ZIP holding word/document.xml. The browser can inflate a raw
 * deflate stream on its own (DecompressionStream), so this walks the ZIP's
 * central directory to find that one entry and unpacks it — cheaper than adding
 * a dependency for one upload button.
 *
 * Structure is kept, because on a contacts list the layout IS the information:
 * each paragraph and each table row comes back as its own line, and cells and
 * tabs within a line are separated so a name can be told from a phone number.
 */

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;

function findEOCD(view) {
  // The end-of-central-directory record sits at the end, after a comment of up
  // to 64 KB — scan backwards for its signature.
  const max = Math.min(view.byteLength, 66000);
  for (let i = view.byteLength - 22; i >= view.byteLength - max && i >= 0; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  return -1;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser cannot open .docx files. Save the document as plain text (.txt) and upload that instead.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Pull one named entry out of the archive.
async function readZipEntry(buffer, wanted) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const eocd = findEOCD(view);
  if (eocd < 0) throw new Error('That file is not a Word document.');

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);          // start of the central directory

  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== SIG_CEN) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOff = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));

    if (name === wanted) {
      // The local header repeats the name and extra field with its OWN lengths —
      // they differ from the central directory's, so read them from there.
      const lNameLen = view.getUint16(localOff + 26, true);
      const lExtraLen = view.getUint16(localOff + 28, true);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const data = bytes.subarray(start, start + compSize);
      return method === 0 ? data : await inflateRaw(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('That Word document has no readable text.');
}

/* document.xml -> lines. Paragraphs and table rows end a line; tabs and cell
 * boundaries become separators inside one. */
function xmlToLines(xml) {
  // Inside a table cell a paragraph is not a new line — Word wraps every cell's
  // contents in <w:p>, so ending the line there scattered one row across four.
  // Cells are flattened first, then the row itself becomes the line.
  const flattened = xml.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g,
    (cell) => cell.replace(/<\/w:p>/g, ' ') + '\t');

  const text = flattened
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<\/w:tr>/g, '\n')            // end of a table row
    .replace(/<\/w:p>/g, '\n')             // end of a paragraph outside a table
    .replace(/<[^>]+>/g, '')               // drop every tag, keeping the text runs
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');               // last, so &amp;lt; doesn't become <

  return text
    .split('\n')
    .map(l => l.replace(/ /g, ' ').replace(/[ \t]*\t[ \t]*/g, '\t').replace(/ +/g, ' ').trim())
    .filter(Boolean);
}

/* ── RTF ───────────────────────────────────────────────────────────────────
 *
 * An .rtf is plain text carrying its formatting inline, so reading it as text
 * drags \pard\sa200\f0\fs22 into the middle of every company name. This walks it
 * properly: control words are obeyed or dropped, \par ends a line, and the
 * groups that hold fonts, colours and the generator stamp are skipped whole
 * rather than having their contents mistaken for content.
 */

// Groups whose contents are bookkeeping, not text.
const RTF_SKIP = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'listtable', 'listoverridetable',
  'info', 'generator', 'pict', 'object', 'themedata', 'datastore',
  'latentstyles', 'rsidtbl', 'xmlnstbl', 'filetbl', 'header', 'footer',
]);

export function rtfToText(rtf) {
  let out = '';
  let i = 0;
  const stack = [];               // one entry per open group: true = skipping
  let skipping = 0;               // depth of the group being skipped, 0 = not

  while (i < rtf.length) {
    const ch = rtf[i];

    if (ch === '{') {
      stack.push(skipping > 0);
      i++;
      // Two ways a group is bookkeeping: it opens with \* (a destination this
      // reader may ignore), or its control word is one of the known tables.
      if (!skipping) {
        const starred = rtf[i] === '\\' && rtf[i + 1] === '*';
        const word = /^\\([a-zA-Z]+)/.exec(rtf.slice(i));
        if (starred || (word && RTF_SKIP.has(word[1]))) skipping = stack.length;
      }
      continue;
    }
    if (ch === '}') {
      if (skipping === stack.length) skipping = 0;
      stack.pop();
      i++;
      continue;
    }
    if (ch === '\\') {
      const word = /^\\([a-zA-Z]+)(-?\d+)?[ ]?/.exec(rtf.slice(i));
      if (word) {
        i += word[0].length;
        if (skipping) continue;
        if (word[1] === 'par' || word[1] === 'line' || word[1] === 'sect') out += '\n';
        else if (word[1] === 'tab') out += '\t';
        else if (word[1] === 'u') {
          // \uN with a replacement character after it, which must be dropped.
          const code = parseInt(word[2], 10);
          if (Number.isFinite(code)) out += String.fromCharCode(code < 0 ? code + 65536 : code);
          if (rtf[i] === '?') i++;
        }
        continue;
      }
      const esc = rtf[i + 1];
      if (esc === "'") {                       // \'hh — one byte, written in hex
        const code = parseInt(rtf.substr(i + 2, 2), 16);
        if (!skipping && Number.isFinite(code)) out += String.fromCharCode(code);
        i += 4;
        continue;
      }
      if (esc === '\\' || esc === '{' || esc === '}') {
        if (!skipping) out += esc;
        i += 2;
        continue;
      }
      i += 2;                                   // \* and friends
      continue;
    }
    if (ch === '\r' || ch === '\n') { i++; continue; }   // layout only; \par is the real break
    if (!skipping) out += ch;
    i++;
  }
  return out;
}

export async function extractRtfLines(file) {
  const lines = rtfToText(await file.text())
    .split('\n')
    .map(l => l.replace(/ /g, ' ').replace(/[ \t]*\t[ \t]*/g, '\t').replace(/ +/g, ' ').trim())
    .filter(Boolean);
  if (!lines.length) throw new Error('That document has no readable text.');
  return lines;
}

export async function extractDocxLines(file) {
  const buffer = await file.arrayBuffer();
  const xml = new TextDecoder().decode(await readZipEntry(buffer, 'word/document.xml'));
  return xmlToLines(xml);
}

// A plain-text or CSV fallback, so a document saved as .txt still works.
export async function extractTextLines(file) {
  const text = await file.text();
  return text.split(/\r?\n/)
    .map(l => l.replace(/ /g, ' ').replace(/ +/g, ' ').trim())
    .filter(Boolean);
}

export async function extractLines(file) {
  const name = ((file && file.name) || '').toLowerCase();
  if (name.endsWith('.docx')) return extractDocxLines(file);
  if (name.endsWith('.rtf')) return extractRtfLines(file);
  if (name.endsWith('.doc')) {
    throw new Error('That is the older .doc format. Open it in Word, use Save As and pick .docx, then upload that.');
  }
  return extractTextLines(file);
}
