import React, { useCallback, useEffect, useRef, useState } from 'react';
import { loadHubOrder, saveHubOrder } from '../utils/github';

/* Press and hold a tile, drag it where you want it, let go.
 *
 * Every hub in the app is a grid of tiles built from a list, so this wraps the
 * grid rather than living inside any one hub: a new hub becomes rearrangeable
 * by wrapping its tiles here and passing a hubKey. The order is per user and
 * saved to their account, so it follows them from the shop PC to their phone.
 *
 * The saved order is a list of tile ids, never the tiles themselves. A tile
 * that gains, loses or renames a feature is matched by id; anything the saved
 * order doesn't know about is appended in its original position rather than
 * dropped, so a new tile always shows up.
 */

const HOLD_MS = 400;      // long enough not to fire on a normal tap
const MOVE_SLOP = 8;      // a scroll gesture shouldn't turn into a drag

// Apply a saved order to the live tile list without ever losing a tile.
export function applyOrder(items, savedIds, idOf = (it) => it.key) {
  if (!Array.isArray(savedIds) || !savedIds.length) return items;
  const rank = new Map(savedIds.map((id, i) => [id, i]));
  // Unknown tiles (new features, or ones a saved layout predates) keep their
  // natural position by sorting on their own index offset past the saved list.
  return items
    .map((it, i) => ({ it, i, r: rank.has(idOf(it)) ? rank.get(idOf(it)) : savedIds.length + i }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(x => x.it);
}

export default function SortableTiles({
  hubKey,
  currentUser,
  items,
  idOf = (it) => it.key,
  children,            // (item, index) => node — renders one tile
  style,               // grid styles from the host hub
  className,
  disabled = false,
  // 'full' suits a hub grid. 'compact' is for a toolbar, where a permanent
  // instruction line would take space the row hasn't got: it says nothing until
  // you're dragging or you've actually rearranged something.
  hint = 'full',
}) {
  const [savedIds, setSavedIds] = useState(null);   // null = not loaded yet
  const [order, setOrder] = useState(items);
  const [dragId, setDragId] = useState('');
  const [status, setStatus] = useState('');

  const wrapRef = useRef(null);
  const cellRefs = useRef(new Map());
  const gesture = useRef({ id: '', timer: null, startX: 0, startY: 0, dragging: false, moved: false });
  const orderRef = useRef(items);
  orderRef.current = order;

  // Load this user's layout once.
  useEffect(() => {
    let alive = true;
    if (!currentUser) { setSavedIds([]); return () => {}; }
    loadHubOrder(currentUser)
      .then(all => { if (alive) setSavedIds(Array.isArray(all?.[hubKey]) ? all[hubKey] : []); })
      .catch(() => { if (alive) setSavedIds([]); });
    return () => { alive = false; };
  }, [currentUser, hubKey]);

  // Re-apply when the SET of tiles changes (a permission change adds or removes
  // one) or the saved order arrives. Keyed on the ids, not the array: hubs build
  // their list inline, so a fresh array arrives on every render and depending on
  // its identity would set state forever.
  const itemSig = items.map(idOf).join('|');
  useEffect(() => {
    setOrder(applyOrder(items, savedIds || [], idOf));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemSig, savedIds]);

  const persist = useCallback(async (ids) => {
    if (!currentUser) return;
    setSavedIds(ids);
    try {
      await saveHubOrder(currentUser, hubKey, ids);
      setStatus('✓ Layout saved');
      setTimeout(() => setStatus(s => (s === '✓ Layout saved' ? '' : s)), 2200);
    } catch (err) {
      setStatus('⚠ Layout not saved: ' + (err.message || err));
    }
  }, [currentUser, hubKey]);

  // Which tile is under the pointer right now.
  function indexAtPoint(x, y) {
    const list = orderRef.current;
    for (let i = 0; i < list.length; i++) {
      const el = cellRefs.current.get(idOf(list[i]));
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i;
    }
    return -1;
  }

  function endGesture() {
    const g = gesture.current;
    if (g.timer) clearTimeout(g.timer);
    gesture.current = { id: '', timer: null, startX: 0, startY: 0, dragging: false, moved: g.moved };
    setDragId('');
  }

  function onPointerDown(e, id) {
    if (disabled || e.button === 2) return;
    const g = gesture.current;
    g.id = id; g.startX = e.clientX; g.startY = e.clientY; g.dragging = false; g.moved = false;
    if (g.timer) clearTimeout(g.timer);
    g.timer = setTimeout(() => {
      g.dragging = true;
      setDragId(id);
      // Feedback that the tile is now "picked up" — phones that support it buzz.
      try { navigator.vibrate?.(15); } catch { /* not supported */ }
    }, HOLD_MS);
  }

  function onPointerMove(e) {
    const g = gesture.current;
    if (!g.id) return;
    const dx = Math.abs(e.clientX - g.startX), dy = Math.abs(e.clientY - g.startY);
    if (!g.dragging) {
      // Moving before the hold completes means they're scrolling, not sorting.
      if (dx > MOVE_SLOP || dy > MOVE_SLOP) { clearTimeout(g.timer); g.id = ''; }
      return;
    }
    g.moved = true;
    e.preventDefault();
    const from = orderRef.current.findIndex(it => idOf(it) === g.id);
    const to = indexAtPoint(e.clientX, e.clientY);
    if (from < 0 || to < 0 || to === from) return;
    const next = orderRef.current.slice();
    next.splice(to, 0, next.splice(from, 1)[0]);
    setOrder(next);
  }

  function onPointerUp() {
    const g = gesture.current;
    const wasDragging = g.dragging;
    const moved = g.moved;
    endGesture();
    if (wasDragging && moved) persist(orderRef.current.map(idOf));
  }

  // A long press ends in a click the browser still delivers; swallow it so
  // rearranging a tile doesn't also open it.
  function onClickCapture(e) {
    if (gesture.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      gesture.current.moved = false;
    }
  }

  const hasCustom = Array.isArray(savedIds) && savedIds.length > 0;

  async function resetOrder() {
    setSavedIds([]);
    setOrder(items);
    try {
      await saveHubOrder(currentUser, hubKey, []);
      setStatus('✓ Layout reset');
      setTimeout(() => setStatus(s => (s === '✓ Layout reset' ? '' : s)), 2200);
    } catch (err) {
      setStatus('⚠ Reset not saved: ' + (err.message || err));
    }
  }

  return (
    <>
      <div
        ref={wrapRef}
        className={className}
        data-dragging={dragId || undefined}
        style={style}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
      >
        {order.map((item, i) => {
          const id = idOf(item);
          const isDragging = dragId === id;
          return (
            <div
              key={id}
              ref={el => { if (el) cellRefs.current.set(id, el); else cellRefs.current.delete(id); }}
              onPointerDown={e => onPointerDown(e, id)}
              style={{
                // Only the tile being carried opts out of touch scrolling, so
                // the page still scrolls normally everywhere else.
                touchAction: isDragging ? 'none' : 'auto',
                transform: isDragging ? 'scale(1.04)' : 'none',
                boxShadow: isDragging ? '0 18px 44px rgba(2,6,23,.6)' : 'none',
                opacity: dragId && !isDragging ? 0.65 : 1,
                borderRadius: 16,
                transition: 'transform .14s ease, opacity .14s ease, box-shadow .14s ease',
                cursor: isDragging ? 'grabbing' : undefined,
                zIndex: isDragging ? 5 : undefined,
                position: 'relative',
              }}
            >
              {children(item, i)}
            </div>
          );
        })}
      </div>

      {(hint === 'full' || dragId || hasCustom) && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: hint === 'full' ? 14 : 6, fontSize: 12, color: '#64748b', flexWrap: 'wrap' }}>
        {(hint === 'full' || dragId) && (
          <span>{dragId ? 'Drop it where you want it' : 'Press and hold a tile to move it'}</span>
        )}
        {hasCustom && !dragId && (
          <button onClick={resetOrder}
            style={{ background: 'transparent', border: 'none', color: '#7dd3fc', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
            ↺ Reset to default order
          </button>
        )}
        {status && <span style={{ color: status.startsWith('✓') ? '#6ee7b7' : '#fca5a5', fontWeight: 700 }}>{status}</span>}
      </div>
      )}
    </>
  );
}
