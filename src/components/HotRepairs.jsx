import React, { useState, useEffect, useRef, useMemo } from 'react';
import { loadHotRepairs, uploadHotRepair, deleteHotRepair, renameHotRepair, reorderHotRepairs, setHotRepairWarranty, setHotRepairTags, backfillHotRepairSearchText, moveHotRepair, docRawUrl, getGithubToken, setGithubToken, loadUsers } from '../utils/github';
import { trackPage } from '../utils/activityTracker';
import { OpCodeGenerator, OpCodeEditor, OpCodeEditorLauncher, DigitalDocModal, MissingOpCodesModal } from './OpCodeTool';

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB
const NEW_DAYS = 7; // show NEW badge for items uploaded within this many days

function formatSize(bytes) {
  if (bytes < 1024)        return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(iso) {
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}

function isNew(iso) {
  try { return (Date.now() - new Date(iso).getTime()) < NEW_DAYS * 24 * 60 * 60 * 1000; }
  catch { return false; }
}

// ── PDF.js – loaded from CDN on first use ─────────────────────────────────────
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

// Cache rendered previews (data URLs) by item id so we only render once.
const previewCache = {};

// Cache extracted first-page text (for search) by item id.
const textCache = {};

// Normalize a string for forgiving search: lowercase, strip everything but
// letters/digits. So "26-01-045H" and "2601045h" and "26 01 045 h" all match.
function norm(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Extract text from EVERY page of a PDF given its raw bytes. Returns '' on any
// failure (e.g. an image-only/scanned PDF with no text layer).
async function extractPdfTextFromBuffer(buf) {
  try {
    const pdfjs = await loadPdfJs();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    let text = '';
    const maxPages = Math.min(pdf.numPages, 15); // cap for very long bulletins
    for (let p = 1; p <= maxPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      text += ' ' + content.items.map(i => i.str).join(' ');
    }
    return text;
  } catch {
    return '';
  }
}

// Extract text from a PDF by URL (cached by item id). Used only for search.
async function extractPdfText(item, rawUrl) {
  // Prefer text already stored in the index (extracted at upload / re-index) —
  // no network needed and always available.
  if (item.searchText) { textCache[item.id] = item.searchText; return item.searchText; }
  if (textCache[item.id] != null) return textCache[item.id];
  try {
    const res = await fetch(rawUrl);
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
// match at all (score -1). When it does match, where each token is found is
// weighted: a hit in the TITLE or TAGS (e.g. the recall/bulletin number a
// manager typed) counts far more than an incidental hit buried in the PDF body
// text — so searching "298" opens the bulletin titled "(RECALL 298)" rather
// than some other PDF that merely mentions 298 in a date or table.
function scoreItem(item, query) {
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
function itemMatches(item, query) {
  return scoreItem(item, query) >= 0;
}

// All matching items, sorted best-match first (ties keep original/newest order).
function rankedMatches(items, query) {
  return items
    .map((it, i) => ({ it, i, s: scoreItem(it, query) }))
    .filter(m => m.s >= 0)
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map(m => m.it);
}

// Renders a large image of page 1 of the PDF; falls back to a wrench icon.
function PdfPreview({ item, rawUrl }) {
  const [thumb, setThumb] = useState(() => previewCache[item.id] || null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (thumb || failed) return;
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        const res = await fetch(rawUrl);
        const buf = await res.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        const scale = 1000 / viewport.width; // render at high resolution for large cards
        const scaled = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = scaled.width;
        canvas.height = scaled.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: scaled }).promise;
        const url = canvas.toDataURL('image/png');
        previewCache[item.id] = url;
        if (!cancelled) setThumb(url);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [item.id, rawUrl, thumb, failed]);

  if (thumb) {
    return (
      <img src={thumb} alt={item.label}
        style={{ width: '100%', display: 'block', objectFit: 'cover', objectPosition: 'top', background: '#fff' }} />
    );
  }
  return (
    <div style={{ width: '100%', aspectRatio: '3 / 4', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,.03)', color: '#64748b', fontSize: 48 }}>
      {failed ? '🔧' : <span style={{ fontSize: 13 }}>Loading preview…</span>}
    </div>
  );
}

// ── PDF Preview Modal ─────────────────────────────────────────────────────────
function PreviewModal({ item, onClose }) {
  const rawUrl = docRawUrl(item.filename);
  const [loading, setLoading] = useState(true);
  // We prefer the browser's NATIVE PDF viewer (loaded from a blob URL) because
  // it renders a real text layer — so users can select, copy, and Ctrl+F the
  // text. Google Docs Viewer only rasterizes pages to images, which can't be
  // copied. If fetching the blob fails (CORS/offline), fall back to gview.
  const [blobUrl, setBlobUrl] = useState(null);
  const [useGview, setUseGview] = useState(false);
  const viewerUrl = `https://docs.google.com/gview?url=${encodeURIComponent(rawUrl)}&embedded=true`;

  useEffect(() => {
    let cancelled = false;
    let createdUrl = null;
    (async () => {
      try {
        const res = await fetch(rawUrl);
        if (!res.ok) throw new Error('fetch failed');
        let blob = await res.blob();
        if (blob.type !== 'application/pdf') blob = new Blob([blob], { type: 'application/pdf' });
        createdUrl = URL.createObjectURL(blob);
        if (!cancelled) { setBlobUrl(createdUrl + '#toolbar=1&navpanes=0'); setLoading(false); }
      } catch {
        if (!cancelled) setUseGview(true); // loading cleared by the iframe's onLoad
      }
    })();
    return () => { cancelled = true; if (createdUrl) URL.revokeObjectURL(createdUrl); };
  }, [rawUrl]);

  const iframeSrc = useGview ? viewerUrl : (blobUrl || '');

  async function handleDownload() {
    try {
      const res  = await fetch(rawUrl);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = item.filename.replace(/^[a-z0-9]+-/, '');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch { window.open(rawUrl, '_blank'); }
  }

  function handlePrint() {
    window.open(`https://docs.google.com/gview?url=${encodeURIComponent(rawUrl)}`, '_blank');
  }

  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="doc-preview-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="doc-preview-modal">
        <div className="doc-preview-header">
          <div className="doc-preview-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="secondary" onClick={onClose}>← Back</button>
            <span className="doc-preview-icon">🔧</span>
            <span>{item.label}</span>
          </div>
          <div className="doc-preview-actions">
            <button onClick={handlePrint}>🖨 Print</button>
            <button onClick={handleDownload}>⬇ Download</button>
            <button className="secondary adv-del-btn" onClick={onClose} title="Close preview" style={{ fontSize: 20 }}>×</button>
          </div>
        </div>
        <div className="doc-preview-body">
          {loading && <div className="doc-preview-loading">Loading preview…</div>}
          {iframeSrc && (
            <iframe
              src={iframeSrc}
              className="doc-preview-iframe"
              style={{ display: loading ? 'none' : 'block' }}
              title={item.label}
              onLoad={() => setLoading(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Hot Repairs Page ─────────────────────────────────────────────────────
export default function HotRepairs({ currentUser, currentUserDisplay, currentRole, onBack, backLabel }) {
  const canManage = currentRole === 'admin' || (currentRole || '').includes('manager');

  const [items, setItems]             = useState([]);
  // The OTHER kind's index (recalls when viewing TSBs and vice-versa), tagged
  // with _kind, so the search box can find matches across both libraries no
  // matter which tab is active. Only used while a search query is present.
  const [otherItems, setOtherItems]   = useState([]);
  const [loading, setLoading]         = useState(true);
  const [uploading, setUploading]     = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [reindexing, setReindexing]   = useState(false);
  const [reindexStatus, setReindexStatus] = useState('');
  const [showOpGen, setShowOpGen]     = useState(false);
  const [showOpEditSearch, setShowOpEditSearch] = useState(false);
  const [showMissingOps, setShowMissingOps] = useState(false);
  const [opEditItem, setOpEditItem]   = useState(null);
  const [digDocItem, setDigDocItem]   = useState(null);
  const [visibleCount, setVisibleCount] = useState(20);
  const loadMoreRef = useRef(null);
  const [label, setLabel]             = useState('');
  const [file, setFile]               = useState(null);
  const [fileError, setFileError]     = useState('');
  const [actionError, setActionError] = useState('');
  const [previewItem, setPreviewItem] = useState(null);
  const [editId, setEditId]           = useState(null);
  const [editLabel, setEditLabel]     = useState('');
  const [savingEdit, setSavingEdit]   = useState(false);
  const [tagsId, setTagsId]           = useState(null);
  const [tagsText, setTagsText]       = useState('');
  const [savingTags, setSavingTags]   = useState(false);
  const [reordering, setReordering]   = useState(false);
  const [tab, setTab]                 = useState('hot-repairs'); // 'hot-repairs' | 'recalls'
  const [search, setSearch]           = useState('');
  const [textVer, setTextVer]         = useState(0); // bumps as PDF text finishes extracting
  const [indexing, setIndexing]       = useState(false);

  const fileInputRef = useRef(null);

  const isRecalls = tab === 'recalls';
  const tabNoun = isRecalls ? 'Recall' : 'Hot Repair';

  useEffect(() => {
    trackPage(isRecalls ? 'recalls' : 'hotRepairs');
    setLoading(true);
    setEditId(null); setTagsId(null); setPreviewItem(null); setSearch('');
    setFile(null); setLabel(''); setFileError(''); setActionError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    setOtherItems([]);
    let cancelled = false;
    loadHotRepairs(tab).then(idx => {
      if (cancelled) return;
      const list = idx || [];
      // Display follows the stored order (newest uploads prepend; managers can reorder).
      setItems(list);
      setLoading(false);
      // Pre-extract first-page text in the background so search is ready & fast.
      if (list.length) {
        setIndexing(true);
        Promise.allSettled(list.map(it => extractPdfText(it, docRawUrl(it.filename))))
          .then(() => { if (!cancelled) { setIndexing(false); setTextVer(v => v + 1); } });
      }
    });
    // Load the OTHER kind in the background so search spans both libraries.
    const otherKind = tab === 'recalls' ? 'hot-repairs' : 'recalls';
    loadHotRepairs(otherKind).then(idx => {
      if (cancelled) return;
      const list = (idx || []).map(it => ({ ...it, _kind: otherKind }));
      setOtherItems(list);
      if (list.length) {
        Promise.allSettled(list.map(it => extractPdfText(it, docRawUrl(it.filename))))
          .then(() => { if (!cancelled) setTextVer(v => v + 1); });
      }
    });
    return () => { cancelled = true; };
  }, [tab]);

  // Items to display, filtered AND ranked by the live search query (best match
  // first), so the bulletin whose title/number matches floats to the top.
  // Warranty Hot Repairs are always pinned to the top (stable sort keeps the
  // existing relative order within each group).
  // While searching, pool BOTH libraries so a recall number is found from the
  // TSB tab and vice-versa. Without a query, show only the current tab.
  const searchPool = search.trim() ? [...items, ...otherItems] : items;

  // The Op Code Generator is universal: a tech looking up an op code knows the
  // bulletin number, not which library it lives in, so it searches BOTH no matter
  // which tab is open. Items from the active tab carry no `_kind` (only the other
  // library is tagged on load), so stamp it here — the generator badges each hit
  // with where it came from.
  const opCodePool = useMemo(
    () => [...items.map(it => ({ ...it, _kind: tab })), ...otherItems],
    [items, otherItems, tab],
  );

  const filteredItems = (search.trim() ? rankedMatches(searchPool, search) : items)
    .slice()
    .sort((a, b) => (b.warranty ? 1 : 0) - (a.warranty ? 1 : 0));
  // eslint-disable-next-line no-unused-expressions
  textVer; // referenced so filtering recomputes as extraction completes

  // ── Lazy paging: render 20 cards at a time, load 20 more on scroll. Keeps the
  // initial render of large libraries (recalls especially) fast. ──────────────
  const PAGE = 20;
  const visibleItems = filteredItems.slice(0, visibleCount);
  // Reset the window whenever the tab or search changes.
  useEffect(() => { setVisibleCount(PAGE); }, [tab, search]);
  // Auto-extend when the sentinel scrolls into view.
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const io = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) setVisibleCount(c => Math.min(c + PAGE, filteredItems.length));
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [filteredItems.length, visibleCount]);

  function runSearchOpen() {
    const matches = rankedMatches([...items, ...otherItems], search);
    if (matches.length >= 1) setPreviewItem(matches[0]);
  }

  // Auto-open the best match when the search clearly points at one bulletin:
  // either it's the only match, or the top match scores strictly higher than
  // the next (e.g. a title/number hit beats incidental body-text mentions).
  // Won't reopen the same one after you close it unless the query changes.
  const autoOpenedRef = useRef(null);
  useEffect(() => {
    if (!search.trim()) { autoOpenedRef.current = null; return; }
    const scored = [...items, ...otherItems]
      .map(it => ({ it, s: scoreItem(it, search) }))
      .filter(m => m.s >= 0)
      .sort((a, b) => b.s - a.s);
    if (scored.length === 0) return;
    // Only auto-pop when there's an unambiguous winner: a single match, or a
    // strong title/tag hit (≥80) that outscores everything else. This opens the
    // right bulletin for "298" while not popping up mid-typing on partial/ambiguous
    // queries (e.g. "29" matching both RECALL 298 and 299 equally).
    const isClearWinner = scored.length === 1 || (scored[0].s >= 80 && scored[0].s > scored[1].s);
    if (isClearWinner && autoOpenedRef.current !== scored[0].it.id) {
      autoOpenedRef.current = scored[0].it.id;
      setPreviewItem(scored[0].it);
    }
  }, [search, textVer, items, otherItems]);

  function handleFileChange(e) {
    const f = e.target.files[0];
    setFileError('');
    if (!f) { setFile(null); return; }
    if (f.size > MAX_SIZE) {
      setFileError('File exceeds 50 MB limit. Please choose a smaller file.');
      setFile(null); e.target.value = ''; return;
    }
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (ext !== 'pdf') {
      setFileError('Only PDF files are allowed for hot repairs.');
      setFile(null); e.target.value = ''; return;
    }
    setFile(f);
    if (!label) setLabel(f.name.replace(/\.[^.]+$/, '').replace(/_/g, ' '));
  }

  async function ensureToken() {
    if (!getGithubToken()) {
      try {
        const result = await loadUsers();
        const shared = result?.sharedSaveCode;
        if (shared) setGithubToken(shared);
      } catch {}
    }
    if (!getGithubToken()) {
      const code = prompt('This device needs a one-time save code to upload.\n\nEnter the save code (ask your admin for it):');
      if (!code) return false;
      setGithubToken(code.trim());
    }
    return true;
  }

  async function handleUpload() {
    if (!file || !label.trim()) { setFileError('Please select a PDF and enter a title.'); return; }
    setActionError('');

    // Warn if this looks like a duplicate of something already uploaded.
    // Match on either the same original PDF filename + size, or the same title.
    const newName  = (file.name || '').replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ').trim().toLowerCase();
    const newTitle = label.trim().toLowerCase();
    const dup = items.find(it => {
      const itName  = (it.filename || '').replace(/^[a-z0-9]+-/, '').replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ').trim().toLowerCase();
      const itTitle = (it.label || '').trim().toLowerCase();
      const sameTitle = itTitle && itTitle === newTitle;
      const sameFile  = itName && itName === newName && Number(it.size) === Number(file.size);
      return sameTitle || sameFile;
    });
    if (dup) {
      const ok = window.confirm(
        `⚠ Possible duplicate\n\nThis looks like it's already uploaded:\n"${dup.label}" (${formatSize(dup.size)}, posted ${formatDate(dup.uploadedAt)}).\n\nUpload it again anyway?`
      );
      if (!ok) return;
    }

    if (!await ensureToken()) return;

    setUploading(true);
    setUploadStatus(file.size > 5 * 1024 * 1024 ? 'Uploading large file — please wait...' : 'Uploading...');
    try {
      // Extract the PDF's full text from the local file BEFORE upload (no network
      // needed) so it's stored in the index and searchable immediately.
      let searchText = '';
      try {
        setUploadStatus('Reading PDF text for search…');
        const buf = await file.arrayBuffer();
        searchText = await extractPdfTextFromBuffer(buf);
      } catch { searchText = ''; }
      setUploadStatus(file.size > 5 * 1024 * 1024 ? 'Uploading large file — please wait...' : 'Uploading...');
      const newItems = await uploadHotRepair(file, label.trim(), currentUserDisplay || currentUser, tab, searchText);
      setItems(newItems); // new upload is prepended → appears on top
      setFile(null); setLabel(''); setFileError('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setUploadStatus('');
    } catch (err) {
      setActionError('Upload failed: ' + err.message);
      setUploadStatus('');
    } finally {
      setUploading(false);
    }
  }

  // Backfill stored search text for every bulletin that doesn't have it yet
  // (i.e. uploaded before full-text indexing existed). Fetches each PDF, extracts
  // its text, and saves the whole index in one commit. One-time, manager-only.
  async function reindexAll() {
    if (!await ensureToken()) return;
    const todo = items.filter(it => !it.searchText);
    if (todo.length === 0) { setReindexStatus('✓ All bulletins already indexed.'); return; }
    setReindexing(true);
    setActionError('');
    try {
      const textById = {};
      let done = 0;
      // Extract in small parallel batches so a big library finishes quickly
      // without hammering the network with hundreds of simultaneous fetches.
      const BATCH = 4;
      for (let i = 0; i < todo.length; i += BATCH) {
        const batch = todo.slice(i, i + BATCH);
        await Promise.all(batch.map(async it => {
          try {
            const res = await fetch(docRawUrl(it.filename));
            const buf = await res.arrayBuffer();
            textById[it.id] = await extractPdfTextFromBuffer(buf);
          } catch { textById[it.id] = ''; }
          textCache[it.id] = textById[it.id];
        }));
        done = Math.min(i + BATCH, todo.length);
        setReindexStatus(`Indexing ${done}/${todo.length}…`);
      }
      const newItems = await backfillHotRepairSearchText(textById, tab);
      setItems(newItems);
      setTextVer(v => v + 1);
      const withText = Object.values(textById).filter(t => t && t.trim()).length;
      const noText = todo.length - withText;
      setReindexStatus(`✓ Indexed ${todo.length} PDF(s).${noText > 0 ? ` ${noText} had no readable text (likely scanned images — add a # tag).` : ''}`);
    } catch (e) {
      setReindexStatus('Failed: ' + (e.message || e));
    } finally {
      setReindexing(false);
    }
  }

  function startEdit(item) {
    setEditId(item.id);
    setEditLabel(item.label);
  }

  async function saveEdit(item) {
    const trimmed = editLabel.trim();
    if (!trimmed || trimmed === item.label) { setEditId(null); return; }
    setActionError('');
    if (!await ensureToken()) return;
    setSavingEdit(true);
    try {
      const newItems = await renameHotRepair(item.id, trimmed, tab);
      setItems(newItems);
      setEditId(null);
    } catch (err) {
      setActionError('Rename failed: ' + err.message);
    } finally {
      setSavingEdit(false);
    }
  }

  function startTags(item) {
    setTagsId(item.id);
    setTagsText(item.tags || '');
  }

  async function saveTags(item) {
    setActionError('');
    if (!await ensureToken()) return;
    setSavingTags(true);
    try {
      const newItems = await setHotRepairTags(item.id, tagsText.trim(), tab);
      setItems(newItems);
      setTagsId(null);
    } catch (err) {
      setActionError('Save failed: ' + err.message);
    } finally {
      setSavingTags(false);
    }
  }

  async function toggleWarranty(item) {
    setActionError('');
    if (!await ensureToken()) return;
    // optimistic
    const next = items.map(i => i.id === item.id ? { ...i, warranty: !i.warranty } : i);
    setItems(next);
    try {
      const saved = await setHotRepairWarranty(item.id, !item.warranty, tab);
      setItems(saved);
    } catch (err) {
      setItems(items); // revert
      setActionError('Update failed: ' + err.message);
    }
  }

  // Move an item to a new position; optimistic UI then persist order.
  async function move(index, toIndex) {
    if (toIndex < 0 || toIndex >= items.length || toIndex === index) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(toIndex, 0, moved);
    setItems(next); // optimistic
    setReordering(true);
    setActionError('');
    try {
      if (!await ensureToken()) { setItems(items); setReordering(false); return; }
      const saved = await reorderHotRepairs(next.map(i => i.id), tab);
      setItems(saved);
    } catch (err) {
      setItems(items); // revert
      setActionError('Reorder failed: ' + err.message);
    } finally {
      setReordering(false);
    }
  }

  async function handleDelete(item) {
    if (!window.confirm(`Delete "${item.label}"?\n\nThis cannot be undone.`)) return;
    setActionError('');
    try {
      const newItems = await deleteHotRepair(item, tab);
      setItems(newItems);
    } catch (err) {
      setActionError('Delete failed: ' + err.message);
    }
  }

  async function handleMove(item) {
    const toKind = isRecalls ? 'hot-repairs' : 'recalls';
    const toLabel = isRecalls ? "TSB'S" : 'Recalls';
    const fromLabel = isRecalls ? 'Recalls' : "TSB'S";
    if (!window.confirm(`Move "${item.label}" from ${fromLabel} to ${toLabel}?\n\nIt will appear under ${toLabel} instead.`)) return;
    setActionError('');
    try {
      const newItems = await moveHotRepair(item, tab, toKind);
      setItems(newItems);
    } catch (err) {
      setActionError('Move failed: ' + err.message);
    }
  }

  return (
    <div className="adv-page doc-lib-page">
      <style>{`
        @keyframes hrWarrantyPulse {
          0%, 100% { box-shadow: 0 0 0 4px rgba(251,191,36,.12); }
          50%      { box-shadow: 0 0 0 7px rgba(251,191,36,.28); }
        }
      `}</style>
      {/* Top bar */}
      <div className="adv-topbar no-print">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button className="secondary" onClick={onBack}>{backLabel || '← Back'}</button>
          <span className="doc-lib-topbar-title">{isRecalls ? '📢 Recalls' : "🔧 TSB'S — New Releases"}</span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, padding: '14px 24px 0', justifyContent: 'center' }}>
        {[
          { key: 'hot-repairs', label: "🔧 TSB'S" },
          { key: 'recalls',     label: '📢 Recalls' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              background: tab === t.key ? 'linear-gradient(135deg,rgba(61,214,195,.28),rgba(110,231,249,.18))' : 'rgba(255,255,255,.04)',
              border: tab === t.key ? '2px solid rgba(61,214,195,.6)' : '1px solid rgba(255,255,255,.1)',
              color: tab === t.key ? '#6ee7f9' : '#94a3b8',
              borderRadius: 12, padding: '10px 28px', cursor: 'pointer', fontWeight: 800, fontSize: 15,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Op Code Generator / Editor launchers */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, padding: '12px 24px 0', flexWrap: 'wrap' }}>
        <button onClick={() => setShowOpGen(true)}
          style={{ background: 'linear-gradient(135deg,rgba(96,165,250,.25),rgba(59,130,246,.18))', border: '1px solid rgba(96,165,250,.5)', color: '#bfdbfe', borderRadius: 12, padding: '10px 22px', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
          ⚙️ Op Code Generator
        </button>
        {canManage && (
          <button onClick={() => setShowOpEditSearch(true)}
            style={{ background: 'linear-gradient(135deg,rgba(167,139,250,.25),rgba(139,92,246,.18))', border: '1px solid rgba(167,139,250,.5)', color: '#c4b5fd', borderRadius: 12, padding: '10px 22px', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
            ⚙️ Op Code Editor
          </button>
        )}
        {canManage && (
          <button onClick={() => setShowMissingOps(true)}
            style={{ background: 'linear-gradient(135deg,rgba(251,191,36,.25),rgba(245,158,11,.18))', border: '1px solid rgba(251,191,36,.5)', color: '#fbbf24', borderRadius: 12, padding: '10px 22px', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
            🔎 Search Missing Op Codes
          </button>
        )}
      </div>

      {/* Search bar */}
      <div style={{ padding: '16px 24px 0', display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: 760, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 16, opacity: 0.7 }}>🔍</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') runSearchOpen(); if (e.key === 'Escape') setSearch(''); }}
            placeholder={isRecalls
              ? 'Search recalls — title, recall/bulletin number, keyword (e.g. "299" or "26-01-045H")'
              : 'Search hot repairs — title, bulletin number, keyword (e.g. "299" or "26-TC-001H")'}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '12px 40px 12px 40px',
              background: 'rgba(255,255,255,.05)', border: '1px solid rgba(110,231,249,.3)',
              borderRadius: 12, color: '#e2e8f0', fontSize: 15, outline: 'none',
            }}
          />
          {search && (
            <button onClick={() => setSearch('')} title="Clear"
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
          )}
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 6, paddingLeft: 4 }}>
            {indexing
              ? '⏳ Scanning PDF contents for search…'
              : search.trim()
                ? `${filteredItems.length} match${filteredItems.length === 1 ? '' : 'es'} — press Enter to open the top result`
                : 'Searches the title, tags, and the full text of every uploaded PDF. Tip: add a 🏷 # tag if a bulletin number is part of an image and isn’t found.'}
          </div>
          {/* Manager-only: backfill full-text search for older bulletins. */}
          {canManage && (() => {
            const unindexed = items.filter(it => !it.searchText).length;
            if (unindexed === 0 && !reindexStatus) return null;
            return (
              <div style={{ marginTop: 8, paddingLeft: 4, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {unindexed > 0 && (
                  <button
                    onClick={reindexAll}
                    disabled={reindexing}
                    style={{ background: 'rgba(110,231,249,.15)', border: '1px solid rgba(110,231,249,.4)', color: '#6ee7f9', borderRadius: 8, padding: '6px 14px', fontWeight: 800, fontSize: 12, cursor: reindexing ? 'wait' : 'pointer', opacity: reindexing ? 0.6 : 1 }}
                  >{reindexing ? '⏳ Indexing…' : `🔍 Index ${unindexed} PDF${unindexed === 1 ? '' : 's'} for full-text search`}</button>
                )}
                {reindexStatus && <span style={{ fontSize: 12, color: '#94a3b8' }}>{reindexStatus}</span>}
              </div>
            );
          })()}
        </div>
      </div>

      <div className="doc-lib-wrap">

        {/* Upload Panel — managers/admins only */}
        {canManage && (
          <div className="doc-lib-upload-panel">
            <div className="doc-lib-panel-title">{isRecalls ? 'Upload New Recall Bulletin' : 'Upload New Hot Repair'}</div>
            <div className="doc-lib-upload-row">
              <input ref={fileInputRef} type="file" accept=".pdf"
                onChange={handleFileChange} style={{ display: 'none' }} id="hot-repair-file-input" />
              <label htmlFor="hot-repair-file-input" className={`doc-lib-file-pick${file ? ' doc-lib-file-pick--selected' : ''}`}>
                {file ? `✔ ${file.name}` : '📂 Choose PDF'}
              </label>
              <input className="doc-lib-label-input"
                placeholder="Title (what techs will see)"
                value={label} onChange={e => setLabel(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !uploading && file && label.trim() && handleUpload()}
                maxLength={80} />
              <button onClick={handleUpload} disabled={uploading || !file || !label.trim()}>
                {uploading ? (uploadStatus || 'Uploading...') : 'Upload'}
              </button>
            </div>
            {file && !fileError && (
              <div className="doc-lib-file-info">
                {file.name} &nbsp;·&nbsp; {formatSize(file.size)}
                {file.size > 5 * 1024 * 1024 && <span className="doc-lib-warn"> &nbsp;⚠ Large file — upload may take 30–60 seconds</span>}
              </div>
            )}
            {fileError   && <div className="doc-lib-error">{fileError}</div>}
            {actionError && <div className="doc-lib-error">{actionError}</div>}
          </div>
        )}

        {/* List */}
        <div className="doc-lib-list-section">
          <div className="doc-lib-panel-title">
            {isRecalls ? 'Recalls' : "TSB'S"}{!loading && <span className="doc-lib-count"> ({search.trim() ? `${filteredItems.length} of ${items.length}` : items.length})</span>}
          </div>

          {loading ? (
            <div className="doc-lib-empty">Loading…</div>
          ) : (!search.trim() && items.length === 0) ? (
            <div className="doc-lib-empty">
              {canManage
                ? `No ${isRecalls ? 'recalls' : 'hot repairs'} posted yet. Use the panel above to add one.`
                : `No ${isRecalls ? 'recalls' : 'hot repairs'} have been posted yet.`}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="doc-lib-empty">
              No matches for “{search.trim()}”. Try a different number or keyword.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 26 }}>
              {visibleItems.map((item) => {
                const idx = items.indexOf(item);
                // A search match from the OTHER library. It can be viewed inline,
                // but management actions live under its own tab, so hide them here.
                const crossKind = !!item._kind && item._kind !== tab;
                const canManageItem = canManage && !crossKind;
                const itemIsRecall = (item._kind || tab) === 'recalls';
                return (
                <div key={item.id} style={{
                  background: item.warranty ? 'rgba(251,191,36,.06)' : 'rgba(255,255,255,.03)',
                  border: item.warranty ? '2px solid rgba(251,191,36,.85)' : '1px solid rgba(255,255,255,.08)',
                  borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column',
                  boxShadow: item.warranty ? '0 0 0 4px rgba(251,191,36,.15)' : 'none',
                  animation: item.warranty ? 'hrWarrantyPulse 1.8s ease-in-out infinite' : 'none',
                }}>
                  {/* Highlight banner */}
                  {item.warranty && (
                    <div style={{ background: 'linear-gradient(90deg,#f59e0b,#fbbf24)', color: '#3a2400', fontWeight: 900, fontSize: 14, letterSpacing: 0.6, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {itemIsRecall ? '⚠️ URGENT RECALL — ACTION REQUIRED' : '⚠️ WARRANTY HOT REPAIR — PLEASE REVIEW'}
                    </div>
                  )}
                  {/* Large preview — click to open full view */}
                  <div
                    onClick={() => setPreviewItem(item)}
                    title="Click to view full PDF"
                    style={{ position: 'relative', cursor: 'pointer', maxHeight: 720, overflow: 'hidden', borderBottom: '1px solid rgba(255,255,255,.08)' }}
                  >
                    <PdfPreview item={item} rawUrl={docRawUrl(item.filename)} />
                    {isNew(item.uploadedAt) && (
                      <span style={{ position: 'absolute', top: 12, left: 12, background: '#ef4444', color: '#fff', borderRadius: 20, fontSize: 12, fontWeight: 900, padding: '4px 12px', letterSpacing: 0.5, boxShadow: '0 2px 8px rgba(0,0,0,.4)' }}>NEW</span>
                    )}
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,.55)', opacity: 0, transition: 'opacity .15s' }}
                      onMouseEnter={e => e.currentTarget.style.opacity = 1}
                      onMouseLeave={e => e.currentTarget.style.opacity = 0}>
                      <span style={{ background: 'rgba(61,214,195,.9)', color: '#04201d', fontWeight: 800, fontSize: 16, padding: '10px 22px', borderRadius: 10 }}>👁 View Full</span>
                    </div>
                  </div>

                  {/* Info + actions */}
                  <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                    {editId === item.id ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          className="doc-lib-label-input"
                          autoFocus
                          value={editLabel}
                          maxLength={80}
                          onChange={e => setEditLabel(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(item); if (e.key === 'Escape') setEditId(null); }}
                          style={{ flex: 1, fontSize: 16, fontWeight: 700 }}
                        />
                        <button onClick={() => saveEdit(item)} disabled={savingEdit}>{savingEdit ? '…' : 'Save'}</button>
                        <button className="secondary" onClick={() => setEditId(null)} disabled={savingEdit}>Cancel</button>
                      </div>
                    ) : (
                      <div style={{ fontWeight: 800, fontSize: 17, color: '#e2e8f0', lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {crossKind && (
                          <span style={{ fontSize: 11, fontWeight: 800, color: itemIsRecall ? '#fbbf24' : '#6ee7f9', background: itemIsRecall ? 'rgba(251,191,36,.12)' : 'rgba(110,231,249,.12)', border: `1px solid ${itemIsRecall ? 'rgba(251,191,36,.4)' : 'rgba(110,231,249,.35)'}`, borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                            {itemIsRecall ? '📢 In Recalls' : "🔧 In TSB'S"}
                          </span>
                        )}
                        <span>{item.label}</span>
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      {formatSize(item.size)} · Posted by <strong style={{ color: '#94a3b8' }}>{item.uploadedBy}</strong> · {formatDate(item.uploadedAt)}
                    </div>

                    {/* Searchable tags / bulletin number */}
                    {tagsId === item.id ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          className="doc-lib-label-input"
                          autoFocus
                          value={tagsText}
                          placeholder="Bulletin/recall # & keywords (e.g. 26-01-042H, recall 298, seat belt)"
                          onChange={e => setTagsText(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveTags(item); if (e.key === 'Escape') setTagsId(null); }}
                          style={{ flex: 1, fontSize: 13 }}
                        />
                        <button onClick={() => saveTags(item)} disabled={savingTags}>{savingTags ? '…' : 'Save'}</button>
                        <button className="secondary" onClick={() => setTagsId(null)} disabled={savingTags}>Cancel</button>
                      </div>
                    ) : item.tags ? (
                      <div style={{ fontSize: 12, color: '#6ee7f9', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {item.tags.split(',').map((t, i) => t.trim() && (
                          <span key={i} style={{ background: 'rgba(110,231,249,.1)', border: '1px solid rgba(110,231,249,.25)', borderRadius: 6, padding: '2px 8px' }}>🏷 {t.trim()}</span>
                        ))}
                      </div>
                    ) : null}

                    {canManageItem && editId !== item.id && tagsId !== item.id && (
                      <button onClick={() => toggleWarranty(item)} title="Toggle Warranty Hot Repair highlight"
                        style={{
                          background: item.warranty ? 'linear-gradient(135deg,#f59e0b,#fbbf24)' : 'rgba(251,191,36,.12)',
                          border: '1px solid rgba(251,191,36,.5)',
                          color: item.warranty ? '#3a2400' : '#fbbf24',
                          borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontWeight: 800, fontSize: 13,
                        }}>
                        {isRecalls
                          ? (item.warranty ? '⚠️ Urgent Recall: ON' : '🛡 Mark as Urgent Recall')
                          : (item.warranty ? '⚠️ Warranty Hot Repair: ON' : '🛡 Mark as Warranty Hot Repair')}
                      </button>
                    )}
                    {canManageItem && editId !== item.id && tagsId !== item.id && (
                      <button onClick={() => setOpEditItem(item)} title="Edit op codes for the Op Code Generator"
                        style={{
                          background: (item.opData && (item.opData.entries || []).length) ? 'rgba(96,165,250,.22)' : 'rgba(96,165,250,.1)',
                          border: '1px solid rgba(96,165,250,.45)', color: '#bfdbfe',
                          borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontWeight: 800, fontSize: 13,
                        }}>
                        {(item.opData && (item.opData.entries || []).length)
                          ? `⚙️ Op Codes (${item.opData.entries.length})${item.opExcluded ? ' · excluded' : ''}`
                          : '⚙️ Add Op Codes'}
                      </button>
                    )}
                    {canManageItem && editId !== item.id && tagsId !== item.id && (
                      <button onClick={() => setDigDocItem(item)} title="View the photo / digital documentation requirements"
                        style={{
                          background: 'rgba(251,146,60,.12)', border: '1px solid rgba(251,146,60,.45)', color: '#fb923c',
                          borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontWeight: 800, fontSize: 13,
                        }}>
                        📸 Digital Documentation
                      </button>
                    )}
                    {canManageItem && editId !== item.id && tagsId !== item.id && !search.trim() && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => move(idx, 0)} disabled={reordering || idx === 0} title="Move to top"
                          style={{ background: 'rgba(167,139,250,.12)', border: '1px solid rgba(167,139,250,.3)', color: '#c4b5fd', borderRadius: 8, padding: '5px 10px', cursor: idx === 0 ? 'default' : 'pointer', fontWeight: 700, fontSize: 12, opacity: idx === 0 ? 0.4 : 1 }}>
                          ⤒ Top
                        </button>
                        <button onClick={() => move(idx, idx - 1)} disabled={reordering || idx === 0} title="Move up"
                          style={{ background: 'rgba(167,139,250,.12)', border: '1px solid rgba(167,139,250,.3)', color: '#c4b5fd', borderRadius: 8, padding: '5px 10px', cursor: idx === 0 ? 'default' : 'pointer', fontWeight: 700, fontSize: 12, opacity: idx === 0 ? 0.4 : 1 }}>
                          ↑ Up
                        </button>
                        <button onClick={() => move(idx, idx + 1)} disabled={reordering || idx === items.length - 1} title="Move down"
                          style={{ background: 'rgba(167,139,250,.12)', border: '1px solid rgba(167,139,250,.3)', color: '#c4b5fd', borderRadius: 8, padding: '5px 10px', cursor: idx === items.length - 1 ? 'default' : 'pointer', fontWeight: 700, fontSize: 12, opacity: idx === items.length - 1 ? 0.4 : 1 }}>
                          ↓ Down
                        </button>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
                      <button onClick={() => setPreviewItem(item)} style={{ flex: 1 }}>👁 View</button>
                      {canManageItem && editId !== item.id && tagsId !== item.id && (
                        <button onClick={() => startTags(item)} title="Add searchable bulletin # / keywords"
                          style={{ background: 'rgba(74,222,128,.12)', border: '1px solid rgba(74,222,128,.3)', color: '#4ade80', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                          🏷 {item.tags ? 'Edit #' : 'Add #'}
                        </button>
                      )}
                      {canManageItem && editId !== item.id && tagsId !== item.id && (
                        <button onClick={() => startEdit(item)} title="Rename"
                          style={{ background: 'rgba(110,231,249,.12)', border: '1px solid rgba(110,231,249,.3)', color: '#6ee7f9', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                          ✏️ Rename
                        </button>
                      )}
                      {canManageItem && editId !== item.id && tagsId !== item.id && (
                        <button onClick={() => handleMove(item)} title={`Move this bulletin to ${isRecalls ? "TSB'S" : 'Recalls'}`}
                          style={{ background: 'rgba(251,146,60,.12)', border: '1px solid rgba(251,146,60,.35)', color: '#fb923c', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                          ↔ Move to {isRecalls ? "TSB'S" : 'Recalls'}
                        </button>
                      )}
                      {canManage && (
                        <button className="secondary adv-del-btn" onClick={() => handleDelete(item)} title="Delete">×</button>
                      )}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}

          {/* Lazy-load sentinel + count */}
          {visibleCount < filteredItems.length && (
            <div ref={loadMoreRef} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '24px 0' }}>
              <div style={{ color: '#64748b', fontSize: 12 }}>
                Showing {visibleItems.length} of {filteredItems.length}
              </div>
              <button
                onClick={() => setVisibleCount(c => Math.min(c + PAGE, filteredItems.length))}
                style={{ background: 'rgba(110,231,249,.12)', border: '1px solid rgba(110,231,249,.35)', color: '#6ee7f9', borderRadius: 8, padding: '8px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                Load more
              </button>
            </div>
          )}

          {actionError && !canManage && <div className="doc-lib-error" style={{ marginTop: 12 }}>{actionError}</div>}
        </div>

      </div>

      {previewItem && <PreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />}

      {showOpGen && (
        <OpCodeGenerator
          items={opCodePool}
          onClose={() => setShowOpGen(false)}
        />
      )}
      {opEditItem && (
        <OpCodeEditor
          item={opEditItem}
          kind={tab}
          onSaved={(newItems) => setItems(newItems)}
          onClose={() => setOpEditItem(null)}
        />
      )}
      {showOpEditSearch && (
        <OpCodeEditorLauncher
          items={items}
          kind={tab}
          kindLabel={isRecalls ? 'recall' : 'TSB'}
          onSaved={(newItems) => setItems(newItems)}
          onClose={() => setShowOpEditSearch(false)}
        />
      )}
      {digDocItem && (
        <DigitalDocModal item={digDocItem} onClose={() => setDigDocItem(null)} />
      )}
      {showMissingOps && (
        <MissingOpCodesModal
          items={items}
          onFix={(it) => { setShowMissingOps(false); setOpEditItem(it); }}
          onClose={() => setShowMissingOps(false)}
        />
      )}
    </div>
  );
}
