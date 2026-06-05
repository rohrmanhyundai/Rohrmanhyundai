import React, { useMemo, useState } from 'react';
import { setHotRepairOpData, docRawUrl } from '../utils/github';

// ── PDF.js (CDN, shared singleton) ────────────────────────────────────────────
let pdfjsPromise = null;
function loadPdfJs() {
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

const pdfTextCache = {};
async function fetchPdfText(item) {
  if (item.searchText) return item.searchText;
  if (pdfTextCache[item.id] != null) return pdfTextCache[item.id];
  try {
    const pdfjs = await loadPdfJs();
    const res = await fetch(docRawUrl(item.filename));
    const buf = await res.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    let text = '';
    const maxPages = Math.min(pdf.numPages, 15);
    for (let p = 1; p <= maxPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      text += ' ' + content.items.map(i => i.str).join(' ');
    }
    pdfTextCache[item.id] = text;
    return text;
  } catch {
    pdfTextCache[item.id] = '';
    return '';
  }
}

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

  // Isolate the warranty section (from "Warranty Information" to the next NOTE/section).
  const startRe = /warranty\s+information/i;
  const m = startRe.exec(text);
  let section = text;
  if (m) {
    section = text.slice(m.index);
    const endRe = /\bNOTE\s*1\b|\bService\s+Procedure\b/i;
    const e = endRe.exec(section);
    if (e && e.index > 40) section = section.slice(0, e.index);
  }
  const rawText = section.slice(0, 4000);

  // Drop everything up to and including the column-header row (the header ends
  // with "Cause Code" — tolerate the common "C ause Code" extraction spacing)
  // so the header text isn't captured as a model.
  let body = section.replace(/^[\s\S]*?C\s*ause\s+Code/i, '').replace(/\s+/g, ' ').trim();
  if (!/C\s*ause\s+Code/i.test(section)) {
    // Fallback if no recognizable header: just strip the section label.
    body = section.replace(/warranty\s+information\s*:?/i, ' ').replace(/\s+/g, ' ').trim();
  }

  // Many PDFs extract with stray spaces inside tokens ("5 0 D116 R0", "50D00 5 R0",
  // "0. 9 M/H"). Repair the two that break row matching:
  //  1) op times — collapse spaces around the decimal and the M/H.
  //  2) op codes — Hyundai op codes are 8 alphanumeric chars that start with two
  //     digits and contain at least one letter (e.g. 50D116R0, 954A0F02). Rebuild
  //     any 8-char run that got split by stray spaces, wherever the spaces fell.
  body = body.replace(/(\d)\s*\.\s*(\d)\s*M\s*\/\s*H/gi, '$1.$2 M/H');
  body = body.replace(/\b\d(?:\s*[A-Z0-9]){7}/g, run => {
    if (!/\s/.test(run)) return run;                         // already contiguous — leave it
    // Only rebuild if it was genuinely split (a stray space leaves a 1–2 char
    // fragment). Two normal-length tokens (e.g. causal "18FA0" + nature "Q55")
    // must NOT be merged.
    if (!run.split(/\s+/).some(f => f.length <= 2)) return run;
    const compact = run.replace(/\s+/g, '');
    return (compact.length === 8 && /^\d{2}/.test(compact) && /[A-Z]/.test(compact)) ? compact : run;
  });

  // Normalize causal-part dashes ("940C3 – P9060" → "940C3-P9060") and join op
  // times ("0.6 M/H" → "0.6M/H") so each becomes a single token.
  body = body
    .replace(/([0-9A-Z]{3,7})\s*[-–—]\s*([0-9A-Z]{3,9})/g, '$1-$2')
    .replace(/(\d+(?:\.\d+)?)\s*M\s*\/\s*H/gi, '$1M/H');

  // ── Table parser ─────────────────────────────────────────────────────────────
  // Warranty tables list one op code per model, with Operation / Op Time / Causal
  // Part / Nature / Cause often MERGED across several model rows. We pair each
  // model with its op code, read whatever typed fields sit in the gap after that
  // op code, then carry the merged values forward to rows that share them.
  const tidy = s => s.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s+/g, ' ').trim();
  const toks = body.split(/\s+/).filter(Boolean);
  const isOp     = t => /^[A-Z0-9]{6,10}$/.test(t) && /[A-Z]/.test(t) && /^\d\d/.test(t) && !/M\/H/i.test(t);
  const isTime   = t => /^\d+(?:\.\d+)?M\/H$/i.test(t);
  const isCausal = t => /^[0-9A-Z]{3,7}-[0-9A-Z]{3,9}$/.test(t) && !isOp(t);
  const isNature = t => /^[A-Z]\d{2}$/.test(t);
  const isCause  = t => /^ZZ\d$/i.test(t);
  const isTyped  = t => isOp(t) || isTime(t) || isCausal(t) || isNature(t) || isCause(t);

  const opIdx = [];
  toks.forEach((t, i) => { if (isOp(t)) opIdx.push(i); });

  const modelBefore = oi => {
    const w = [];
    let j = oi - 1;
    while (j >= 0 && !isTyped(toks[j])) { w.unshift(toks[j]); j--; }
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
    gap.forEach((t, gi) => {
      if (isTime(t))        { time = time || t.replace(/M\/H/i, ' M/H'); seenTyped = true; }
      else if (isCausal(t)) { causal = causal || t; seenTyped = true; }
      else if (isNature(t)) { nature = nature || t; seenTyped = true; }
      else if (isCause(t))  { cause = cause || t; seenTyped = true; }
      else if (isOp(t))     { seenTyped = true; }
      else if (!seenTyped)  { opWords.push(t); }
      else if (gi > lastTyped) { trailing.push(t); }
    });
    const operation = seenTyped ? tidy(opWords.join(' ')) : '';
    recs.push({ ...emptyEntry(), model: modelBefore(oi), opCode: toks[oi], operation, opTime: time.trim(), causalPart: causal, natureCode: nature, causeCode: cause });
    // A model trailing the LAST op code (with no op code of its own) shares it.
    if (k === opIdx.length - 1 && trailing.length) {
      recs.push({ ...emptyEntry(), model: tidy(trailing.join(' ')), opCode: toks[oi], operation, opTime: time.trim(), causalPart: causal, natureCode: nature, causeCode: cause });
    }
  }

  // Carry merged values forward to rows that left them blank.
  let lo = '', lt = '', lc = '', ln = '', lcc = '';
  for (const r of recs) {
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

// ── Op Code Generator (lookup UI) ─────────────────────────────────────────────
export function OpCodeGenerator({ items, kindLabel, onClose }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [answers, setAnswers] = useState({});
  const [copiedKey, setCopiedKey] = useState(null);
  // Resolved op data for the selected bulletin: { source:'manual'|'auto', opData, rawText }.
  const [resolved, setResolved] = useState(null);
  const [autoLoading, setAutoLoading] = useState(false);

  // Every bulletin is searchable. Excluded ones still show up, but instead of an
  // op code they offer a link to open the bulletin and read the codes there.
  const searchable = useMemo(() => (items || []), [items]);
  const q = query.trim().toLowerCase();
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const nq = norm(query);
  // Nothing is listed until the user actually searches.
  const matches = q
    ? searchable.filter(it =>
        norm(it.label).includes(nq) || norm(it.tags).includes(nq) || norm(it.filename).includes(nq))
    : [];

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
      const text = await fetchPdfText(item);
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

        {!selected ? (
          <>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 10 }}>
              Search the {kindLabel} number to look up its warranty op code(s).
            </div>
            <input
              autoFocus value={query} onChange={e => setQuery(e.target.value)}
              placeholder='Search bulletin number or keyword (e.g. "26-EM-012H")'
              style={input}
            />
            <div style={{ marginTop: 12, maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!q ? null : matches.length === 0 ? (
                <div style={{ color: '#64748b', fontSize: 13, padding: '12px 4px' }}>
                  {searchable.length === 0
                    ? 'No bulletins have op codes set up yet. A manager can add them with the "⚙️ Op Codes" button on a bulletin.'
                    : 'No matching bulletins.'}
                </div>
              ) : matches.map(it => (
                <button key={it.id} onClick={() => pick(it)} style={rowBtn}>
                  <span style={{ fontWeight: 800, color: '#e2e8f0' }}>{it.label}</span>
                  {it.tags && <span style={{ fontSize: 11, color: '#6ee7f9', marginLeft: 8 }}>{it.tags}</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: '#475569' }}>
                    {it.opExcluded ? 'view bulletin →'
                      : (it.opData && (it.opData.entries || []).length) ? `${it.opData.entries.length} op code(s) →`
                      : 'look up →'}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <button onClick={reset} style={secBtn}>← Back</button>
              <span style={{ fontWeight: 800, color: '#e2e8f0' }}>{selected.label}</span>
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
                {Object.keys(answers).length > 0 && (
                  <button onClick={() => setAnswers({})} style={secBtn}>↺ Change selection</button>
                )}
              </div>
            )}
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

  const q = query.trim().toLowerCase();
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const nq = norm(query);
  const matches = q
    ? (items || []).filter(it => norm(it.label).includes(nq) || norm(it.tags).includes(nq) || norm(it.filename).includes(nq))
    : [];

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

  function runAutoDraft() {
    const { entries: drafted, questions: q, rawText: raw } = extractWarrantyDraft(item.searchText || '');
    setRawText(raw);
    if (q && q.length) setQuestions(q.map(x => ({ ...x })));
    if (drafted.length) setEntries(drafted.map(e => ({ ...e, answers: { ...(e.answers || {}) } })));
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
          <button onClick={runAutoDraft} style={draftBtn}>✨ Auto-draft from PDF text</button>
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
        <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 800, color: '#fbbf24' }}>
          Questions to ask (only needed if there are multiple op codes)
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

        {/* Entries table */}
        <div style={{ margin: '14px 0 8px', fontSize: 13, fontWeight: 800, color: '#fbbf24' }}>Op code rows</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                {questions.map(qq => <th key={qq.id} style={th}>{qq.label || 'Question'}</th>)}
                {OP_FIELDS.map(f => <th key={f.key} style={th}>{f.label}</th>)}
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id}>
                  {questions.map(qq => (
                    <td key={qq.id} style={td}>
                      <input value={e.answers?.[qq.id] || ''} onChange={ev => setAnswer(e.id, qq.id, ev.target.value)} style={cellInput} />
                    </td>
                  ))}
                  {OP_FIELDS.map(f => (
                    <td key={f.key} style={td}>
                      <input value={e[f.key] || ''} onChange={ev => setField(e.id, f.key, ev.target.value)} style={{ ...cellInput, minWidth: f.key === 'operation' ? 180 : 90 }} />
                    </td>
                  ))}
                  <td style={td}><button onClick={() => removeEntry(e.id)} style={delBtn}>🗑</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button onClick={addEntry} style={{ ...secBtn, marginTop: 8 }}>+ Add op code row</button>

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
const xBtn = { background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer', lineHeight: 1 };
const delBtn = { background: 'rgba(248,113,113,.14)', border: '1px solid rgba(248,113,113,.4)', color: '#fca5a5', borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer' };
const th = { textAlign: 'left', color: '#94a3b8', fontWeight: 700, padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,.12)', whiteSpace: 'nowrap' };
const td = { padding: '4px 6px', verticalAlign: 'top' };
const cellInput = { width: '100%', boxSizing: 'border-box', padding: '6px 8px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 6, color: '#e2e8f0', fontSize: 12, outline: 'none' };
