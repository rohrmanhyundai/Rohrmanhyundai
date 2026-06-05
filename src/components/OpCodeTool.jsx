import React, { useMemo, useState } from 'react';
import { setHotRepairOpData } from '../utils/github';

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

// ── Auto-draft: best-effort parse of the bulletin's Warranty Information ───────
// These tables are irregular, so this only pre-fills what it can confidently
// detect (op codes, op times, causal parts) and hands the manager a draft plus
// the raw section text to finish from. NOT authoritative — manager confirms.
export function extractWarrantyDraft(fullText) {
  const text = (fullText || '').replace(/\s+/g, ' ').trim();
  if (!text) return { entries: [], rawText: '' };

  // Isolate the warranty section (from "Warranty Information" to the next NOTE/section).
  const startRe = /warranty\s+information/i;
  const m = startRe.exec(text);
  let section = text;
  if (m) {
    section = text.slice(m.index);
    const endRe = /\bNOTE\s*1\b/i;
    const e = endRe.exec(section);
    if (e && e.index > 40) section = section.slice(0, e.index);
  }
  const rawText = section.slice(0, 4000);

  // Op codes: 6–10 char alphanumeric tokens containing BOTH letters and digits,
  // no dash (causal parts contain a dash). e.g. 60D089R1, 954A0F02, 10D223IA.
  const codeRe = /\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*[0-9])[A-Z0-9]{6,10}\b/g;
  // Causal parts: like 26345-3LAA1 or 954A1-2N250.
  const partRe = /\b[0-9A-Z]{4,6}-[0-9A-Z]{4,7}\b/g;
  const timeRe = /\b\d+\.\d+\s*M\/H\b/gi;
  const ncRe   = /\b[A-Z][0-9]{2}\b/g;   // Nature code e.g. B31, S21
  const ccRe   = /\bZZ[0-9]\b/g;          // Cause code e.g. ZZ4, ZZ3

  const codes = Array.from(new Set((section.match(codeRe) || []).filter(c => !/M\/H/i.test(c))));
  const parts = section.match(partRe) || [];
  const times = section.match(timeRe) || [];
  const ncs   = section.match(ncRe) || [];
  const ccs   = section.match(ccRe) || [];

  // Remove any "codes" that are actually causal parts split oddly — keep distinct.
  const partSet = new Set(parts.map(p => p.replace('-', '')));
  const opCodes = codes.filter(c => !partSet.has(c));

  const entries = (opCodes.length ? opCodes : ['']).map((code, i) => ({
    ...emptyEntry(),
    opCode: code,
    opTime: times[i] || times[0] || '',
    causalPart: parts[i] || '',
    natureCode: ncs[i] || ncs[0] || '',
    causeCode: ccs[i] || ccs[0] || '',
  }));

  return { entries, rawText };
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

  // Only bulletins that have op-code data and aren't excluded.
  const searchable = useMemo(
    () => (items || []).filter(it => !it.opExcluded && it.opData && (it.opData.entries || []).length > 0),
    [items]
  );
  const q = query.trim().toLowerCase();
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const nq = norm(query);
  // Nothing is listed until the user actually searches.
  const matches = q
    ? searchable.filter(it =>
        norm(it.label).includes(nq) || norm(it.tags).includes(nq) || norm(it.filename).includes(nq))
    : [];

  function pick(item) { setSelected(item); setAnswers({}); }
  function reset() { setSelected(null); setAnswers({}); }

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

  const step = selected ? resolveStep(selected.opData.questions || [], selected.opData.entries || [], answers) : null;

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
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: '#475569' }}>{(it.opData.entries || []).length} op code(s) →</span>
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

            {!step.done ? (
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
    const { entries: drafted, rawText: raw } = extractWarrantyDraft(item.searchText || '');
    setRawText(raw);
    if (drafted.length) setEntries(drafted);
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
