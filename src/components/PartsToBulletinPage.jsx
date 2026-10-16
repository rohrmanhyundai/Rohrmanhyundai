import React, { useEffect, useState } from 'react';
import { loadHotRepairs } from '../utils/github';
import { trackPage } from '../utils/activityTracker';
import { PartsToBulletinSearch } from './PartsToBulletin';
import { PreviewModal } from './HotRepairs';

// Parts to Bulletin as its own page, for the Advisor Tools and Warranty Hub
// tiles. Same search as the button on the TSB page; this just loads both
// libraries itself (search text rides in the index, so no PDFs are fetched).
export default function PartsToBulletinPage({ currentUser, currentUserDisplay, onBack, backLabel }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [previewItem, setPreviewItem] = useState(null);

  useEffect(() => {
    trackPage('partsToBulletin');
    let cancelled = false;
    const kinds = ['hot-repairs', 'recalls'];
    Promise.all(kinds.map(k => loadHotRepairs(k).then(list => (list || []).map(it => ({ ...it, _kind: k })))))
      .then(lists => { if (!cancelled) { setItems(lists.flat()); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">🔩 Parts to Bulletin</div>
          <div className="adv-sub">{currentUserDisplay || currentUser}</div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="secondary" onClick={onBack}>{backLabel || '← Back'}</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '28px 16px' }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <PartsToBulletinSearch items={items} loading={loading} onOpen={setPreviewItem} />
        </div>
      </div>
      {previewItem && <PreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />}
    </div>
  );
}
