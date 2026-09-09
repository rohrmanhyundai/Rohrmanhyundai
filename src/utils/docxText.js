/* Read the text out of a .docx, with no library.
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
  if (name.endsWith('.doc')) {
    throw new Error('That is the older .doc format. Open it in Word, use Save As and pick .docx, then upload that.');
  }
  return extractTextLines(file);
}
