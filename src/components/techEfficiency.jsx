// 2-week tech efficiency (average goal % over the last two closed weeks, from
// the weekly performance-report snapshots) and the small arc gauge that shows
// it. Shared by The Daily Wrench and the TV dashboard (/dashboard/).
import React, { useEffect, useState } from 'react';
import { fetchLiveJson } from '../utils/liveData';


export function useTwoWeekEfficiency(names, asOf) {
  const [eff, setEff] = useState({});
  const key = names.join(',');
  useEffect(() => {
    let cancelled = false;
    const cutoff = asOf || new Date().toISOString().slice(0, 10);
    Promise.all(names.map(n =>
      fetchLiveJson(`performance-reports/${encodeURIComponent(String(n).toUpperCase())}.json`)
        .then(j => j || [])
        .then(list => {
          const weeks = (Array.isArray(list) ? list : [])
            .filter(e => e && e.type === 'tech' && (e.weekEnd || e.date) < cutoff)
            .sort((a, b) => String(b.date).localeCompare(String(a.date)))
            .slice(0, 2)
            .map(e => { const g = parseFloat(e.goal), tot = parseFloat(e.total); return g > 0 && Number.isFinite(tot) ? tot / g : parseFloat(e.goal_pct) || 0; });
          return [n, weeks.length ? { pct: weeks.reduce((a, b) => a + b, 0) / weeks.length, weeks: weeks.length } : null];
        })))
      .then(pairs => { if (!cancelled) setEff(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [key, asOf]); // eslint-disable-line react-hooks/exhaustive-deps
  return eff;
}
export function MiniGauge({ pct, width = 138, height = 82 }) {
  const none = pct == null || !Number.isFinite(pct);
  const p = none ? 0 : Math.max(0, Math.min(1.5, pct));
  const col = none ? '#334155' : pct >= 1 ? '#4ade80' : pct >= 0.8 ? '#fbbf24' : '#f87171';
  const R = 34, cx = 44, cy = 42, len = Math.PI * R;
  const a = Math.PI * (1 - p / 1.5);
  return (
    <svg viewBox="0 0 88 52" width={width} height={height} style={{ display: 'block' }}>
      <path d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`} fill="none" stroke="rgba(148,163,184,.18)" strokeWidth="7" strokeLinecap="round" />
      {!none && <path d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`} fill="none" stroke={col} strokeWidth="7" strokeLinecap="round"
        strokeDasharray={`${len * (p / 1.5)} ${len}`} />}
      {/* 100% mark */}
      {(() => { const m = Math.PI * (1 - 1 / 1.5); return <line x1={cx + (R - 6) * Math.cos(m)} y1={cy - (R - 6) * Math.sin(m)} x2={cx + (R + 5) * Math.cos(m)} y2={cy - (R + 5) * Math.sin(m)} stroke="#e2e8f0" strokeWidth="1.5" />; })()}
      {!none && <circle cx={cx + R * Math.cos(a)} cy={cy - R * Math.sin(a)} r="3.2" fill="#fff" />}
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="15" fontWeight="900" fill={col}>{none ? '—' : `${Math.round(pct * 100)}%`}</text>
    </svg>
  );
}
