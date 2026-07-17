import React, { useMemo, useState } from 'react';
import { setHotRepairOpData, docRawUrl } from '../utils/github';
import { loadPdfJs, extractPdfText, rankedMatches } from '../utils/pdfText';


// ── Shared helpers ───────────────────────────────────────────────────────────

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// The 7 output fields, in the order they appear on a warranty table row and in
// the copied line. `model` first, then op code, operation, op time, causal part,
// nature code, cause code.
export const OP_FIELDS = [
  { key: 'model',      label: 'Model' },
  { key: 'opCode',     label: 'Op Code' },
  { key: 'operation',  label: 'Operation' },
  { key: 'opTime',     label: 'Op Time' },
  { key: 'causalPart', label: 'Causal Part' },
  { key: 'natureCode', label: 'Nature Code' },
  { key: 'causeCode',  label: 'Cause Code' },
];

// Build the single copy line, e.g.
// "Palisade (LX2) 60D089R1 Engine Oil Filter Seal Replacement 0.6 M/H 26345-3LAA1 B31 ZZ4"
export function formatOpLine(entry) {
  return OP_FIELDS
    .map(f => (entry?.[f.key] || '').toString().trim())
    .filter(Boolean)
    .join(' ');
}

function emptyEntry() {
  return { id: uid(), answers: {}, model: '', opCode: '', operation: '', opTime: '', causalPart: '', natureCode: '', causeCode: '' };
}

// ── Auto-read the bulletin's Warranty Information table ────────────────────────
// Best-effort, since these tables are irregular. It captures complete warranty
// rows (Model · Op Code · Operation · Op Time · Causal Part · Nature · Cause)
// where all columns sit together, which covers the common single-row and most
// per-model tables. Anything it can't fully resolve is left for the manager to
// finish in the editor (the raw section text is returned for reference).
// NOT authoritative — always verify against the bulletin before submitting.
export function extractWarrantyDraft(fullText) {
  const text = (fullText || '').replace(/\s+/g, ' ').trim();
  if (!text) return { entries: [], rawText: '' };

  // Anchor on the actual warranty TABLE, identified by its column header
  // ("Model … Op. Code … Operation …"). This avoids early "see the Warranty
  // Information section" references elsewhere in the bulletin that would
  // otherwise hijack the parse. Fall back to the "Warranty Information" label.
  const headerRe = /Model\s+Op\.?\s*Code\s+(?:Operation|Description)/i;
  let section;
  const hm = headerRe.exec(text);
  if (hm) {
    section = text.slice(hm.index);
  } else {
    const m = /warranty\s+information/i.exec(text);
    section = m ? text.slice(m.index) : text;
  }
  const endRe = /\bNOTE\s*1\b|\bService\s+Procedure\b/i;
  const e = endRe.exec(section);
  if (e && e.index > 40) section = section.slice(0, e.index);
  const rawText = section.slice(0, 4000);

  // Drop everything up to and including the column-header row so its labels
  // aren't read as a model. The header ends "… Nature Cause [Code]" (some
  // bulletins print "Cause", others "Cause Code", and "Description" instead of
  // "Operation"); tolerate the common "C ause" extraction spacing.
  let body;
  if (/Nature\s+C\s*ause/i.test(section)) {
    body = section.replace(/^[\s\S]*?Nature\s+C\s*ause(?:\s+Code)?/i, '').replace(/\s+/g, ' ').trim();
  } else if (/C\s*ause\s+Code/i.test(section)) {
    body = section.replace(/^[\s\S]*?C\s*ause\s+Code/i, '').replace(/\s+/g, ' ').trim();
  } else {
    // Fallback: strip whatever header label we anchored on.
    body = section.replace(headerRe, ' ').replace(/warranty\s+information\s*:?/i, ' ').replace(/\s+/g, ' ').trim();
  }

  // Many PDFs extract with stray spaces inside tokens ("5 0 D116 R0", "50D00 5 R0",
  // "60DV 03I0", "0. 9 M/H", "ZZ 3", "B1 E"). Repair them so each column is one
  // solid token. ORDER MATTERS: de-fragment cause/nature and collapse op times &
  // causal parts FIRST (so a causal suffix like "18FA0" is absorbed and a stray
  // cause digit can't be eaten by an op code), THEN rebuild op codes.
  body = body
    .replace(/(\d)\s*\.\s*(\d)\s*M\s*\/\s*H/gi, '$1.$2 M/H')                    // "0. 9 M/H" → "0.9 M/H"
    .replace(/\bZZ\s+(\d)\b/gi, 'ZZ$1')                                        // cause "ZZ 3" → "ZZ3"
    .replace(/\b([A-Z]\d?)\s*([A-Z0-9])\s+(ZZ\d)\b/g, '$1$2 $3')               // nature "B1 E ZZ3" → "B1E ZZ3"
    .replace(/([0-9A-Z]{3,7})\s*[-–—]\s*([0-9A-Z]{3,9})/g, '$1-$2')            // causal "940C3 – P9060" → "940C3-P9060"
    .replace(/(\d+(?:\.\d+)?)\s*M\s*\/\s*H/gi, '$1M/H');                        // "0.6 M/H" → "0.6M/H"

  // Op codes are 8 alphanumeric chars starting with two digits and containing at
  // least one letter (50D116R0, 954A0F02, 60DV03I0). Rebuild any split by stray
  // spaces. The leading "(^|[^-A-Za-z0-9])" guard (vs a lookbehind, for older-
  // browser safety) stops a rebuild from STARTING inside a hyphenated causal part
  // (no pulling "18FA0" out of "44000-18FA0" to glue on "Q55"). The final
  // "letter-then-digit" check keeps operation text out: a real op code always has
  // a digit AFTER its first letter (the trailing revision digit — 61D196R1,
  // 954A0F02), whereas a fragment like "1476 ONLY" (digits + a trailing word)
  // does not, so we never glue "1476 ONLY" → "1476ONLY" and mistake it for a code.
  body = body.replace(/(^|[^-A-Za-z0-9])(\d(?:\s*[A-Z0-9]){7})/g, (full, pre, run) => {
    if (!/\s/.test(run)) return full;                        // already contiguous — leave it
    const compact = run.replace(/\s+/g, '');
    return (compact.length === 8 && /^\d{2}/.test(compact) && /[A-Z][A-Z0-9]*\d/.test(compact)) ? pre + compact : full;
  });
  // Op-code RANGES ("50D310R2 - R5*" → "50D310R2-R5"): one entry covering several
  // codes whose exact value depends on a sub-condition in the bulletin.
  body = body.replace(/\b(\d{2}[A-Z0-9]{6})\s*[-–—]\s*([A-Z0-9]{1,3})\*?/g, '$1-$2');
  body = body.replace(/\*/g, ' ').replace(/\s+/g, ' ').trim();                  // drop footnote asterisks

  // ── Table parser ─────────────────────────────────────────────────────────────
  // Warranty tables list one op code per model, with Operation / Op Time / Causal
  // Part / Nature / Cause often MERGED across several model rows. We pair each
  // model with its op code, read whatever typed fields sit in the gap after that
  // op code, then carry the merged values forward to rows that share them.
  const tidy = s => s.replace(/\b([A-Z]) ([a-z])/g, '$1$2').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s+/g, ' ').trim();
  const toks = body.split(/\s+/).filter(Boolean);
  const isCause  = t => /^ZZ\d$/i.test(t);
  // Op code: 8 base alphanumeric chars with at least one letter AND one digit
  // (so digit-leading "50D116R0" AND letter-leading "REC290I0" both qualify),
  // optionally a "-SUFFIX" range. Excludes causes and op-time tokens.
  const isOp     = t => { const m = /^([A-Z0-9]{8})(-[A-Z0-9]{1,3})?$/.exec(t); return !!m && /[A-Z]/.test(m[1]) && /\d/.test(m[1]) && !isCause(t) && !/M\/H/i.test(t); };
  const isTime   = t => /^\d+(?:\.\d+)?M\/H$/i.test(t);
  const isCausal = t => /^[0-9A-Z]{3,7}-[0-9A-Z]{3,9}$/.test(t) && !isOp(t);
  // Nature is detected POSITIONALLY (the token right before the cause code), since
  // by pattern alone a 3-char code like "B1E" is indistinguishable from an
  // operation word like "AAF". This is only used as a sanity check on that token.
  const looksNature = t => /^[A-Z][A-Z0-9]{2}$/.test(t) && !isCause(t) && !isOp(t);
  const isTyped  = t => isOp(t) || isTime(t) || isCausal(t) || isCause(t);

  const opIdx = [];
  toks.forEach((t, i) => { if (isOp(t)) opIdx.push(i); });

  // Global indices of tokens absorbed into a causal-part suffix (e.g. the "NN B"
  // in "88085-DO000 NN B" → "88085-DO000NNB"). modelBefore must skip these so the
  // suffix can't leak in as a phantom model on the next row.
  const consumed = new Set();
  const modelBefore = oi => {
    const w = [];
    let j = oi - 1;
    while (j >= 0 && !isTyped(toks[j]) && !consumed.has(j)) { w.unshift(toks[j]); j--; }
    return tidy(w.join(' '));
  };

  const recs = [];
  for (let k = 0; k < opIdx.length; k++) {
    const oi = opIdx[k];
    const next = k + 1 < opIdx.length ? opIdx[k + 1] : toks.length;
    const gap = toks.slice(oi + 1, next);
    let lastTyped = -1;
    gap.forEach((t, gi) => { if (isTyped(t)) lastTyped = gi; });
    let seenTyped = false, time = '', causal = '', nature = '', cause = '';
    const opWords = [], trailing = [];
    for (let gi = 0; gi < gap.length; gi++) {
      const t = gap[gi];
      if (isTime(t))        { time = time || t.replace(/M\/H/i, ' M/H'); seenTyped = true; }
      else if (isCausal(t)) {
        if (!causal) {
          causal = t;
          // Absorb a fragmented pure-letter suffix ("DO000 NN B" → "DO000NNB").
          while (gi + 1 < gap.length && /^[A-Z]{1,4}$/.test(gap[gi + 1]) && !isCause(gap[gi + 1])) {
            causal += gap[gi + 1]; consumed.add(oi + 1 + gi + 1); gi++;
          }
        }
        seenTyped = true;
      }
      else if (isCause(t))  { cause = cause || t; seenTyped = true; const prev = gap[gi - 1]; if (prev && looksNature(prev)) nature = nature || prev; }
      else if (isOp(t))     { seenTyped = true; }
      else if (!seenTyped)  { opWords.push(t); }
      else if (gi > lastTyped) { trailing.push(t); }
    }
    const operation = seenTyped ? tidy(opWords.join(' ')) : '';
    recs.push({ ...emptyEntry(), model: modelBefore(oi), opCode: toks[oi], operation, opTime: time.trim(), causalPart: causal, natureCode: nature, causeCode: cause });
    // A model trailing the LAST op code (with no op code of its own) shares it.
    if (k === opIdx.length - 1 && trailing.length) {
      recs.push({ ...emptyEntry(), model: tidy(trailing.join(' ')), opCode: toks[oi], operation, opTime: time.trim(), causalPart: causal, natureCode: nature, causeCode: cause });
    }
  }

  // Carry merged values forward to rows that left them blank. Includes the model,
  // so a single-model table with many op codes (one model cell spanning all rows,
  // op codes differing by inspection result) fills the model on every row.
  let lm = '', lo = '', lt = '', lc = '', ln = '', lcc = '';
  for (const r of recs) {
    if (r.model)      lm = r.model;      else r.model      = lm;
    if (r.operation)  lo = r.operation;  else r.operation  = lo;
    if (r.opTime)     lt = r.opTime;     else r.opTime     = lt;
    if (r.causalPart) lc = r.causalPart; else r.causalPart = lc;
    if (r.natureCode) ln = r.natureCode; else r.natureCode = ln;
    if (r.causeCode)  lcc = r.causeCode; else r.causeCode  = lcc;
  }

  // If more than one model, build a "Model" question so the lookup asks which
  // model before showing the op code.
  const distinctModels = Array.from(new Set(recs.map(r => r.model).filter(Boolean)));
  let questions = [];
  if (recs.length > 1 && distinctModels.length > 1) {
    questions = [{ id: 'model', label: 'Model' }];
    recs.forEach(r => { r.answers = { model: r.model }; });
  }

  return { entries: recs, questions, rawText };
}

// ── Guided lookup engine ──────────────────────────────────────────────────────
// Given the questions, entries, and the answers chosen so far, return either the
// next discriminating question to ask, or the set of matching entries when no
// further question would narrow things down.
function resolveStep(questions, entries, answers) {
  const matching = entries.filter(e =>
    Object.entries(answers).every(([qid, val]) => (e.answers?.[qid] ?? '') === val)
  );
  if (matching.length <= 1) return { done: true, matching };
  for (const q of questions) {
    if (answers[q.id] != null) continue;
    const vals = Array.from(new Set(matching.map(e => (e.answers?.[q.id] ?? '')).filter(v => v !== '')));
    if (vals.length > 1) return { done: false, question: q, options: vals, matching };
  }
  return { done: true, matching };
}

// ── Digital Documentation viewer ──────────────────────────────────────────────
// Finds the bulletin pages that hold the photo/claim-submission requirements and
// renders them, plus a quick checklist of each required photo.
export function DigitalDocModal({ item, onClose }) {
  const [loading, setLoading] = useState(true);
  const [pages, setPages] = useState([]);       // [{ num, img }]
  const [checklist, setChecklist] = useState([]);
  const [error, setError] = useState('');

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        const res = await fetch(docRawUrl(item.filename));
        const buf = await res.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
        const qualifying = [];
        const checks = new Set();
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          const content = await page.getTextContent();
          const t = content.items.map(i => i.str).join(' ');
          // A real photo-requirement page (not just a passing "Digital
          // Documentation Policy" mention in a NOTE).
          const qualifies = /picture requirement/i.test(t) ||
            (/digital\s+documentation/i.test(t) && /(take a photo|take photos|stui|photo of the|photos of)/i.test(t));
          if (qualifies) {
            qualifying.push(p);
            (t.match(/tak\w* (?:a )?photos?[^.]*\./gi) || []).forEach(s => checks.add(s.replace(/\s+/g, ' ').trim()));
          }
          if (cancelled) return;
        }
        if (cancelled) return;
        setChecklist(Array.from(checks));
        const imgs = [];
        for (const p of qualifying) {
          const page = await pdf.getPage(p);
          const vp = page.getViewport({ scale: 1 });
          const sv = page.getViewport({ scale: 1400 / vp.width });
          const canvas = document.createElement('canvas');
          canvas.width = sv.width; canvas.height = sv.height;
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: sv }).promise;
          imgs.push({ num: p, img: canvas.toDataURL('image/jpeg', 0.85) });
          if (cancelled) return;
        }
        if (!cancelled) setPages(imgs);
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [item]);

  return (
    <div onClick={onClose} style={{ ...overlay, zIndex: 1100 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...modal, maxWidth: 900 }}>
        <div style={modalHeader}>
          <span style={{ fontWeight: 900, fontSize: 17, color: '#fb923c' }}>📸 Digital Documentation — {item.label}</span>
          <button onClick={onClose} style={xBtn}>✕</button>
        </div>

        {loading ? (
          <div style={{ color: '#94a3b8', fontSize: 14, padding: '16px 4px' }}>⏳ Finding the photo requirements in the bulletin…</div>
        ) : error ? (
          <div style={{ color: '#fca5a5', fontSize: 14 }}>Couldn't load the bulletin: {error}</div>
        ) : pages.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ color: '#cbd5e1', fontSize: 14 }}>No digital-documentation / picture-requirement section was found in this bulletin.</div>
            <button onClick={() => window.open(docRawUrl(item.filename), '_blank')} style={copyBtn}>📄 Open full bulletin</button>
          </div>
        ) : (
          <>
            {checklist.length > 0 && (
              <div style={{ background: 'rgba(251,146,60,.08)', border: '1px solid rgba(251,146,60,.3)', borderRadius: 10, padding: '12px 16px', marginBottom: 14 }}>
                <div style={{ fontWeight: 800, color: '#fb923c', fontSize: 13, marginBottom: 8 }}>Required photos</div>
                <ul style={{ margin: 0, paddingLeft: 20, color: '#e2e8f0', fontSize: 13, lineHeight: 1.6 }}>
                  {checklist.map((c, i) => <li key={i}>{c.charAt(0).toUpperCase() + c.slice(1)}</li>)}
                </ul>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {pages.map(pg => (
                <div key={pg.num}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Page {pg.num}</div>
                  <img src={pg.img} alt={`Page ${pg.num}`} style={{ width: '100%', borderRadius: 8, background: '#fff' }} />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Op Code Generator (lookup UI) ─────────────────────────────────────────────
// `items` is the UNIVERSAL pool — every TSB *and* every recall — because a tech
// looking up an op code has a bulletin number in hand and no reason to know which
// library it was filed under. Each item carries `_kind` so a hit can say where it
// came from. Everything the generator needs (opData, filename) rides on the item,
// and docRawUrl() is kind-agnostic, so cross-library hits resolve like any other.
export function OpCodeGenerator({ items, onClose }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [answers, setAnswers] = useState({});
  const [copiedKey, setCopiedKey] = useState(null);
  // Resolved op data for the selected bulletin: { source:'manual'|'auto', opData, rawText }.
  const [resolved, setResolved] = useState(null);
  const [autoLoading, setAutoLoading] = useState(false);
  const [showDigDoc, setShowDigDoc] = useState(false);

  // Every bulletin is searchable. Excluded ones still show up, but instead of an
  // op code they offer a link to open the bulletin and read the codes there.
  const searchable = useMemo(() => (items || []), [items]);
  const q = query.trim();
  // Same ranked, full-text search as the bulletin library: matches the title, the
  // manager's tags, the filename AND the text of the PDF itself, so a tech who
  // knows the symptom but not the number ("inoperable horn") finds the bulletin.
  // Title/tag hits still outrank a passing mention in the body, so searching a
  // number lands on the bulletin that IS that number. Nothing lists until the
  // user actually types.
  const matches = useMemo(() => (q ? rankedMatches(searchable, q) : []), [searchable, q]);

  async function pick(item) {
    setSelected(item); setAnswers({}); setResolved(null);
    if (item.opExcluded) {
      setResolved({ source: 'excluded', opData: { questions: [], entries: [] }, rawText: '' });
      return;
    }
    if (item.opData && (item.opData.entries || []).length > 0) {
      setResolved({ source: 'manual', opData: item.opData, rawText: '' });
      return;
    }
    // No manual data — auto-read the warranty table from the PDF text.
    setAutoLoading(true);
    try {
      const text = await extractPdfText(item);
      const { entries, questions, rawText } = extractWarrantyDraft(text);
      setResolved({ source: 'auto', opData: { questions: questions || [], entries }, rawText });
    } catch {
      setResolved({ source: 'auto', opData: { questions: [], entries: [] }, rawText: '' });
    } finally {
      setAutoLoading(false);
    }
  }
  function reset() { setSelected(null); setAnswers({}); setResolved(null); }

  function copyLine(entry, key) {
    const line = formatOpLine(entry);
    const done = () => { setCopiedKey(key); setTimeout(() => setCopiedKey(k => k === key ? null : k), 1400); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(line).then(done).catch(() => {});
    else {
      const ta = document.createElement('textarea'); ta.value = line; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch {}
      document.body.removeChild(ta);
    }
  }

  const step = resolved ? resolveStep(resolved.opData.questions || [], resolved.opData.entries || [], answers) : null;

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={e => e.stopPropagation()} style={{ ...modal, maxWidth: 720 }}>
        <div style={modalHeader}>
          <span style={{ fontWeight: 900, fontSize: 18, color: '#6ee7f9' }}>⚙️ Op Code Generator</span>
          <button onClick={onClose} style={xBtn}>✕</button>
        </div>

        <div style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.5)', borderRadius: 8, padding: '8px 14px', marginBottom: 14, color: '#fca5a5', fontWeight: 800, fontSize: 13, textAlign: 'center', letterSpacing: 0.3 }}>
          ⚠️ ALWAYS VIEW BULLETIN FOR PROPER INSTRUCTIONS
        </div>

        {!selected ? (
          <>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 10 }}>
              Searches every TSB <strong style={{ color: '#cbd5e1' }}>and</strong> recall — title, tags, and the full text inside each PDF.
              Don't know the number? Describe the job.
            </div>
            <input
              autoFocus value={query} onChange={e => setQuery(e.target.value)}
              placeholder='Number or description — e.g. "26-EM-012H", "298", or "inoperable horn"'
              style={input}
            />
            <div style={{ marginTop: 12, maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!q ? null : matches.length === 0 ? (
                <div style={{ color: '#64748b', fontSize: 13, padding: '12px 4px' }}>
                  {searchable.length === 0
                    ? 'No bulletins have op codes set up yet. A manager can add them with the "⚙️ Op Codes" button on a bulletin.'
                    : 'No matching bulletins.'}
                </div>
              ) : matches.map(it => {
                // Ids are only unique within a library, so qualify the key by kind.
                const isRecall = it._kind === 'recalls';
                return (
                <button key={`${it._kind || ''}-${it.id}`} onClick={() => pick(it)} style={rowBtn}>
                  <span style={{
                    fontSize: 10, fontWeight: 900, letterSpacing: 0.4, marginRight: 8, padding: '2px 7px', borderRadius: 999, whiteSpace: 'nowrap',
                    background: isRecall ? 'rgba(251,191,36,.15)' : 'rgba(96,165,250,.15)',
                    border: `1px solid ${isRecall ? 'rgba(251,191,36,.45)' : 'rgba(96,165,250,.45)'}`,
                    color: isRecall ? '#fbbf24' : '#93c5fd',
                  }}>{isRecall ? '📢 RECALL' : '🔧 TSB'}</span>
                  <span style={{ fontWeight: 800, color: '#e2e8f0' }}>{it.label}</span>
                  {it.tags && <span style={{ fontSize: 11, color: '#6ee7f9', marginLeft: 8 }}>{it.tags}</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: '#475569' }}>
                    {it.opExcluded ? 'view bulletin →'
                      : (it.opData && (it.opData.entries || []).length) ? `${it.opData.entries.length} op code(s) →`
                      : 'look up →'}
                  </span>
                </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <button onClick={reset} style={secBtn}>← Back</button>
              <span style={{
                fontSize: 10, fontWeight: 900, letterSpacing: 0.4, padding: '2px 7px', borderRadius: 999, whiteSpace: 'nowrap',
                background: selected._kind === 'recalls' ? 'rgba(251,191,36,.15)' : 'rgba(96,165,250,.15)',
                border: `1px solid ${selected._kind === 'recalls' ? 'rgba(251,191,36,.45)' : 'rgba(96,165,250,.45)'}`,
                color: selected._kind === 'recalls' ? '#fbbf24' : '#93c5fd',
              }}>{selected._kind === 'recalls' ? '📢 RECALL' : '🔧 TSB'}</span>
              <span style={{ fontWeight: 800, color: '#e2e8f0', flex: 1 }}>{selected.label}</span>
              <button onClick={() => window.open(docRawUrl(selected.filename), '_blank')} style={viewBulletinBtn}>📄 View Bulletin</button>
            </div>

            {resolved?.source === 'auto' && (resolved.opData.entries || []).length > 0 && (
              <div style={{ background: 'rgba(251,191,36,.1)', border: '1px solid rgba(251,191,36,.4)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#fbbf24' }}>
                ⚠️ Auto-read from the PDF — please verify against the bulletin before submitting a claim.
              </div>
            )}

            {resolved?.source === 'excluded' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ color: '#cbd5e1', fontSize: 14 }}>
                  This bulletin is excluded from the op-code generator.
                </div>
                <button
                  onClick={() => window.open(docRawUrl(selected.filename), '_blank')}
                  style={{ background: 'rgba(96,165,250,.2)', border: '1px solid rgba(96,165,250,.5)', color: '#bfdbfe', borderRadius: 10, padding: '10px 18px', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
                  📄 View bulletin for operation codes
                </button>
              </div>
            ) : autoLoading || !resolved ? (
              <div style={{ color: '#94a3b8', fontSize: 14, padding: '16px 4px' }}>⏳ Reading the bulletin's warranty table…</div>
            ) : (resolved.opData.entries || []).length === 0 ? (
              <div>
                <div style={{ color: '#fca5a5', fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                  Couldn't automatically read an op code from this bulletin.
                </div>
                <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 10 }}>
                  It may be a scanned image, or the table is laid out unusually. A manager can enter it by hand
                  with the “⚙️ Op Codes” button on the bulletin card.
                </div>
                {resolved.rawText && (
                  <textarea readOnly value={resolved.rawText} style={{ width: '100%', minHeight: 110, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, color: '#cbd5e1', fontSize: 12, padding: 10, boxSizing: 'border-box' }} />
                )}
              </div>
            ) : !step.done ? (
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#fbbf24', marginBottom: 10 }}>
                  {step.question.label}
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {step.options.map(opt => (
                    <button key={opt} onClick={() => setAnswers(a => ({ ...a, [step.question.id]: opt }))} style={optBtn}>
                      {opt}
                    </button>
                  ))}
                </div>
                {Object.keys(answers).length > 0 && (
                  <button onClick={() => setAnswers({})} style={{ ...secBtn, marginTop: 14 }}>↺ Start over</button>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>
                  {step.matching.length === 1 ? 'Op code:' : `${step.matching.length} matching op codes:`}
                </div>
                {step.matching.map((e, i) => (
                  <div key={e.id || i} style={resultCard}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 13 }}>
                      {OP_FIELDS.filter(f => (e[f.key] || '').trim()).map(f => (
                        <React.Fragment key={f.key}>
                          <span style={{ color: '#64748b', fontWeight: 700 }}>{f.label}</span>
                          <span style={{ color: f.key === 'opCode' ? '#4ade80' : '#e2e8f0', fontWeight: f.key === 'opCode' ? 800 : 600 }}>{e[f.key]}</span>
                        </React.Fragment>
                      ))}
                    </div>
                    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <code style={{ flex: 1, fontSize: 12, color: '#cbd5e1', background: 'rgba(255,255,255,.04)', padding: '6px 10px', borderRadius: 6, overflowX: 'auto', whiteSpace: 'nowrap' }}>{formatOpLine(e)}</code>
                      <button onClick={() => copyLine(e, e.id || i)} style={copyBtn}>
                        {copiedKey === (e.id || i) ? '✓ Copied' : '📋 Copy'}
                      </button>
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button onClick={() => setShowDigDoc(true)} style={digDocBtn}>📸 View Digital Documentation</button>
                  {Object.keys(answers).length > 0 && (
                    <button onClick={() => setAnswers({})} style={secBtn}>↺ Change selection</button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showDigDoc && selected && (
        <DigitalDocModal item={selected} onClose={() => setShowDigDoc(false)} />
      )}
    </div>
  );
}

// ── Missing Op Codes scanner (manager) ────────────────────────────────────────
// Scans every bulletin on the tab and lists the ones the generator can't produce
// an op code for (not excluded, no manual op data, and auto-read finds nothing),
// each with a one-click button to open its editor and fix it.
export function MissingOpCodesModal({ items, onFix, onClose }) {
  const [scanning, setScanning] = useState(true);
  const [progress, setProgress] = useState(0);
  const [missing, setMissing] = useState([]);
  const [counts, setCounts] = useState({ set: 0, auto: 0, missing: 0, excluded: 0 });
  const total = (items || []).length;

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = items || [];
      const miss = [];
      const c = { set: 0, auto: 0, missing: 0, excluded: 0 };
      const BATCH = 4;
      for (let i = 0; i < list.length; i += BATCH) {
        const batch = list.slice(i, i + BATCH);
        await Promise.all(batch.map(async it => {
          if (it.opExcluded) { c.excluded++; return; }
          if (it.opData && (it.opData.entries || []).length) { c.set++; return; }
          let text = it.searchText;
          if (!text) { try { text = await extractPdfText(it); } catch { text = ''; } }
          const { entries } = extractWarrantyDraft(text || '');
          if (entries.length) { c.auto++; } else { c.missing++; miss.push(it); }
        }));
        if (cancelled) return;
        setProgress(Math.min(i + BATCH, list.length));
        setCounts({ ...c });
        setMissing([...miss]);
      }
      if (!cancelled) setScanning(false);
    })();
    return () => { cancelled = true; };
  }, [items]);

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={e => e.stopPropagation()} style={{ ...modal, maxWidth: 760 }}>
        <div style={modalHeader}>
          <span style={{ fontWeight: 900, fontSize: 18, color: '#fbbf24' }}>🔎 Missing Op Codes</span>
          <button onClick={onClose} style={xBtn}>✕</button>
        </div>

        <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 10 }}>
          {scanning ? `Scanning bulletins… ${progress}/${total}` : `Scan complete — checked ${total} bulletin(s).`}
        </div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: '#cbd5e1', marginBottom: 14 }}>
          <span>✅ Auto-readable: <b style={{ color: '#4ade80' }}>{counts.auto}</b></span>
          <span>⚙️ Manually set: <b style={{ color: '#6ee7f9' }}>{counts.set}</b></span>
          <span>🚫 Excluded: <b style={{ color: '#94a3b8' }}>{counts.excluded}</b></span>
          <span>⚠️ Missing: <b style={{ color: '#fca5a5' }}>{counts.missing}</b></span>
        </div>

        {!scanning && missing.length === 0 ? (
          <div style={{ color: '#4ade80', fontSize: 14, fontWeight: 700, padding: '12px 4px' }}>
            🎉 No missing op codes — every bulletin either has op codes or can be auto-read.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#fca5a5', marginBottom: 8 }}>
              Bulletins with no op code {scanning ? 'so far' : ''} (click Fix to add):
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
              {missing.map(it => (
                <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(248,113,113,.06)', border: '1px solid rgba(248,113,113,.3)', borderRadius: 10, padding: '10px 14px' }}>
                  <span style={{ flex: 1, fontWeight: 700, color: '#e2e8f0', fontSize: 13 }}>{it.label}</span>
                  <button onClick={() => onFix(it)} style={{ background: 'rgba(96,165,250,.2)', border: '1px solid rgba(96,165,250,.5)', color: '#bfdbfe', borderRadius: 8, padding: '6px 16px', fontWeight: 800, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>⚙️ Fix</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Op Code Editor Launcher (manager) ─────────────────────────────────────────
// Search any bulletin and jump straight into its op-code editor.
export function OpCodeEditorLauncher({ items, kind, kindLabel, onSaved, onClose }) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null);

  // Full-text ranked, same as the generator — a manager finding the bulletin to
  // add op codes to has the same problem a tech does.
  const q = query.trim();
  const matches = q ? rankedMatches(items || [], q) : [];

  if (picked) {
    // Re-resolve the picked item from the latest items so it reflects saves.
    const fresh = (items || []).find(it => it.id === picked.id) || picked;
    return (
      <OpCodeEditor
        item={fresh}
        kind={kind}
        onSaved={onSaved}
        onClose={() => setPicked(null)}
      />
    );
  }

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={e => e.stopPropagation()} style={{ ...modal, maxWidth: 720 }}>
        <div style={modalHeader}>
          <span style={{ fontWeight: 900, fontSize: 18, color: '#bfdbfe' }}>⚙️ Op Code Editor</span>
          <button onClick={onClose} style={xBtn}>✕</button>
        </div>
        <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 10 }}>
          Search a {kindLabel} to edit its op codes.
        </div>
        <input
          autoFocus value={query} onChange={e => setQuery(e.target.value)}
          placeholder='Search bulletin number or keyword'
          style={input}
        />
        <div style={{ marginTop: 12, maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!q ? null : matches.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: 13, padding: '12px 4px' }}>No matching bulletins.</div>
          ) : matches.map(it => (
            <button key={it.id} onClick={() => setPicked(it)} style={rowBtn}>
              <span style={{ fontWeight: 800, color: '#e2e8f0' }}>{it.label}</span>
              {it.tags && <span style={{ fontSize: 11, color: '#6ee7f9', marginLeft: 8 }}>{it.tags}</span>}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#475569' }}>
                {(it.opData && (it.opData.entries || []).length) ? `⚙️ ${it.opData.entries.length} op code(s) — edit →` : 'add op codes →'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Op Code Editor (manager) ──────────────────────────────────────────────────
export function OpCodeEditor({ item, kind, onSaved, onClose }) {
  const [questions, setQuestions] = useState(item.opData?.questions ? item.opData.questions.map(q => ({ ...q })) : []);
  const [entries, setEntries] = useState(item.opData?.entries ? item.opData.entries.map(e => ({ ...e, answers: { ...(e.answers || {}) } })) : [emptyEntry()]);
  const [excluded, setExcluded] = useState(!!item.opExcluded);
  const [rawText, setRawText] = useState('');
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState('');

  function addQuestion() { setQuestions(qs => [...qs, { id: uid(), label: '' }]); }
  function setQLabel(id, label) { setQuestions(qs => qs.map(q => q.id === id ? { ...q, label } : q)); }
  function removeQuestion(id) {
    setQuestions(qs => qs.filter(q => q.id !== id));
    setEntries(es => es.map(e => { const a = { ...e.answers }; delete a[id]; return { ...e, answers: a }; }));
  }

  function addEntry() { setEntries(es => [...es, emptyEntry()]); }
  function removeEntry(id) { setEntries(es => es.filter(e => e.id !== id)); }
  function setField(id, key, val) { setEntries(es => es.map(e => e.id === id ? { ...e, [key]: val } : e)); }
  function setAnswer(id, qid, val) { setEntries(es => es.map(e => e.id === id ? { ...e, answers: { ...e.answers, [qid]: val } } : e)); }

  async function runAutoDraft() {
    setDrafting(true);
    try {
      // Use stored text if present, otherwise read the PDF live (same as the
      // generator) so un-indexed bulletins still draft.
      const text = await extractPdfText(item);
      const { entries: drafted, questions: q, rawText: raw } = extractWarrantyDraft(text);
      setRawText(raw);
      if (q && q.length) setQuestions(q.map(x => ({ ...x })));
      if (drafted.length) setEntries(drafted.map(e => ({ ...e, answers: { ...(e.answers || {}) } })));
    } finally {
      setDrafting(false);
    }
  }

  async function save() {
    setSaving(true); setError('');
    try {
      const cleanQuestions = questions.filter(q => (q.label || '').trim()).map(q => ({ id: q.id, label: q.label.trim() }));
      const cleanEntries = entries
        .filter(e => OP_FIELDS.some(f => (e[f.key] || '').trim()))
        .map(e => {
          const answers = {};
          for (const q of cleanQuestions) if ((e.answers?.[q.id] || '').trim()) answers[q.id] = e.answers[q.id].trim();
          const out = { id: e.id || uid(), answers };
          for (const f of OP_FIELDS) out[f.key] = (e[f.key] || '').trim();
          return out;
        });
      const opData = { questions: cleanQuestions, entries: cleanEntries };
      const newItems = await setHotRepairOpData(item.id, { opData, opExcluded: excluded }, kind);
      onSaved && onSaved(newItems);
      onClose();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={e => e.stopPropagation()} style={{ ...modal, maxWidth: 1040 }}>
        <div style={modalHeader}>
          <span style={{ fontWeight: 900, fontSize: 17, color: '#6ee7f9' }}>⚙️ Op Codes — {item.label}</span>
          <button onClick={onClose} style={xBtn}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <button onClick={runAutoDraft} disabled={drafting} style={{ ...draftBtn, opacity: drafting ? 0.6 : 1 }}>{drafting ? '⏳ Reading PDF…' : '✨ Auto-draft from PDF text'}</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#cbd5e1', cursor: 'pointer' }}>
            <input type="checkbox" checked={excluded} onChange={e => setExcluded(e.target.checked)} />
            Exclude this bulletin from the Op Code search
          </label>
        </div>

        {rawText && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, marginBottom: 4 }}>WARRANTY SECTION (reference — copy values from here):</div>
            <textarea readOnly value={rawText} style={{ width: '100%', minHeight: 90, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, color: '#cbd5e1', fontSize: 12, padding: 10, boxSizing: 'border-box' }} />
          </div>
        )}

        {/* Questions */}
        <div style={{ marginBottom: 4, fontSize: 13, fontWeight: 800, color: '#fbbf24' }}>
          Questions to ask (only needed if there are multiple op codes)
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
          Add a question (like “Model” or “Drivetrain”) when one bulletin has several op codes. The advisor's answer picks the matching row below. Leave empty if there's just one op code.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
          {questions.map((qq, i) => (
            <div key={qq.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#64748b', width: 70 }}>Question {i + 1}</span>
              <input value={qq.label} onChange={e => setQLabel(qq.id, e.target.value)} placeholder='e.g. "Model" or "Drivetrain (AWD/FWD)"' style={{ ...input, flex: 1, margin: 0 }} />
              <button onClick={() => removeQuestion(qq.id)} style={delBtn}>🗑</button>
            </div>
          ))}
          <button onClick={addQuestion} style={{ ...secBtn, alignSelf: 'flex-start' }}>+ Add question</button>
        </div>

        {/* Entries — one labeled card per op code (no cramped wide table) */}
        <div style={{ margin: '18px 0 4px', fontSize: 13, fontWeight: 800, color: '#fbbf24' }}>Op code rows</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
          Each card is one op code. Fill in the values exactly as they appear in the bulletin's Warranty table.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {entries.map((e, idx) => (
            <div key={e.id} style={entryCard}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: '#6ee7f9', textTransform: 'uppercase', letterSpacing: 0.6 }}>Row {idx + 1}</span>
                <button onClick={() => removeEntry(e.id)} style={delBtn}>🗑 Remove row</button>
              </div>

              {questions.length > 0 && (
                <div style={{ marginBottom: 14, padding: '10px 12px', background: 'rgba(251,191,36,.06)', border: '1px solid rgba(251,191,36,.22)', borderRadius: 10 }}>
                  <div style={sectionLbl('#fbbf24')}>Pick this row when the advisor answers…</div>
                  <div style={fieldGrid}>
                    {questions.map(qq => (
                      <label key={qq.id} style={fieldWrap}>
                        <span style={fieldLbl}>{qq.label || 'Question'}</span>
                        <input value={e.answers?.[qq.id] || ''} onChange={ev => setAnswer(e.id, qq.id, ev.target.value)} style={cellInput2} />
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div style={sectionLbl('#94a3b8')}>Op code details</div>
              <div style={fieldGrid}>
                {OP_FIELDS.map(f => (
                  <label key={f.key} style={{ ...fieldWrap, gridColumn: f.key === 'operation' ? '1 / -1' : 'auto' }}>
                    <span style={fieldLbl}>{f.label}</span>
                    <input
                      value={e[f.key] || ''}
                      onChange={ev => setField(e.id, f.key, ev.target.value)}
                      placeholder={OP_PLACEHOLDERS[f.key] || ''}
                      style={cellInput2}
                    />
                  </label>
                ))}
              </div>

              <div style={{ marginTop: 12, fontSize: 11, color: '#64748b' }}>
                Copied line: <span style={{ color: formatOpLine(e) ? '#86efac' : '#475569', fontWeight: 600 }}>{formatOpLine(e) || '—'}</span>
              </div>
            </div>
          ))}
        </div>
        <button onClick={addEntry} style={{ ...secBtn, marginTop: 12 }}>+ Add op code row</button>

        {error && <div style={{ color: '#fca5a5', fontSize: 13, marginTop: 12 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={onClose} style={secBtn}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ ...copyBtn, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : '💾 Save Op Codes'}</button>
        </div>
      </div>
    </div>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────
const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', zIndex: 1000, overflowY: 'auto' };
const modal = { width: '100%', background: '#0f172a', border: '1px solid rgba(110,231,249,.25)', borderRadius: 16, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,.5)' };
const modalHeader = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 };
const input = { width: '100%', boxSizing: 'border-box', padding: '10px 14px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(110,231,249,.3)', borderRadius: 10, color: '#e2e8f0', fontSize: 14, outline: 'none' };
const rowBtn = { display: 'flex', alignItems: 'center', gap: 6, textAlign: 'left', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: '12px 14px', cursor: 'pointer' };
const optBtn = { background: 'rgba(96,165,250,.18)', border: '1px solid rgba(96,165,250,.5)', color: '#bfdbfe', borderRadius: 10, padding: '10px 18px', fontWeight: 800, fontSize: 14, cursor: 'pointer' };
const resultCard = { background: 'rgba(74,222,128,.06)', border: '1px solid rgba(74,222,128,.3)', borderRadius: 12, padding: '14px 16px' };
const copyBtn = { background: 'linear-gradient(135deg,#22c55e,#4ade80)', border: 'none', color: '#06280f', borderRadius: 8, padding: '8px 16px', fontWeight: 800, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' };
const secBtn = { background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.14)', color: '#cbd5e1', borderRadius: 8, padding: '7px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' };
const draftBtn = { background: 'rgba(167,139,250,.18)', border: '1px solid rgba(167,139,250,.5)', color: '#c4b5fd', borderRadius: 8, padding: '8px 14px', fontWeight: 800, fontSize: 13, cursor: 'pointer' };
const digDocBtn = { background: 'rgba(251,146,60,.18)', border: '1px solid rgba(251,146,60,.5)', color: '#fb923c', borderRadius: 8, padding: '9px 16px', fontWeight: 800, fontSize: 13, cursor: 'pointer' };
const viewBulletinBtn = { background: 'rgba(96,165,250,.18)', border: '1px solid rgba(96,165,250,.5)', color: '#bfdbfe', borderRadius: 8, padding: '7px 14px', fontWeight: 800, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' };
const xBtn = { background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer', lineHeight: 1 };
const delBtn = { background: 'rgba(248,113,113,.14)', border: '1px solid rgba(248,113,113,.4)', color: '#fca5a5', borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer' };
// ── Op code editor card layout ────────────────────────────────────────────────
const entryCard = { background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: '14px 16px' };
const fieldGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 };
const fieldWrap = { display: 'flex', flexDirection: 'column', gap: 4 };
const fieldLbl = { fontSize: 10, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 };
const cellInput2 = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.16)', borderRadius: 8, color: '#e2e8f0', fontSize: 13, outline: 'none' };
const sectionLbl = (color) => ({ fontSize: 11, fontWeight: 800, color, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 });

// Example values shown as placeholders to guide what each field should contain.
const OP_PLACEHOLDERS = {
  model: 'Palisade (LX2)',
  opCode: '61D016R0',
  operation: '3rd Row Quarter Window Film',
  opTime: '0.4 M/H',
  causalPart: '87810-S8100',
  natureCode: 'A31',
  causeCode: 'ZZ4',
};
