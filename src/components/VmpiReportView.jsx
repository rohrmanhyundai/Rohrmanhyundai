// View VMPI Report — every repair order per tech from the last VMPI upload,
// YES / NO for a video attached to the inspection, each tech's %. Opened from
// Edit Dashboard → Technicians; "Save as .pdf" downloads what's on screen.
import React, { useEffect, useMemo, useState } from 'react';
import { loadVmpiReport } from '../utils/github';

const pctTxt = (p) => `${(Number(p || 0) * 100).toFixed(1)}%`;
const tone = (p) => (p >= 0.9 ? '#4ade80' : p >= 0.75 ? '#fbbf24' : '#f87171');

async function savePdf(report, techs, onlyNo) {
  const { default: jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 36;
  const cols = [['RO', 62], ['Closed', 58], ['Customer', 150], ['Vehicle', 150], ['Advisor', 0], ['VMPI', 44]];
  cols[4][1] = W - 2 * M - cols.reduce((n, c) => n + c[1], 0);
  let y = M, page = 1;
  const footer = () => { pdf.setFontSize(8.5); pdf.setTextColor(148, 163, 184); pdf.text(`Page ${page}`, W - M, H - 18, { align: 'right' }); };
  const newPage = () => { footer(); pdf.addPage(); page += 1; y = M; };
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.setTextColor(15, 23, 42);
  pdf.text('VMPI Report — video multi-point inspection', M, y + 4);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(100, 116, 139);
  const all = techs.reduce((a, t) => ({ ros: a.ros + t.ros, w: a.w + t.withVideo }), { ros: 0, w: 0 });
  pdf.text(`${report.store || 'Bob Rohrman Hyundai'} · report ${report.stamp || ''} · shop ${all.w} of ${all.ros} ROs with video (${pctTxt(all.ros ? all.w / all.ros : 0)})${onlyNo ? ' · showing ROs WITHOUT video only' : ''}`, M, y + 20);
  y += 40;
  for (const t of techs) {
    const lines = onlyNo ? t.lines.filter(l => !l.video) : t.lines;
    if (y > H - M - 70) newPage();
    pdf.setFillColor(241, 245, 249); pdf.rect(M, y - 13, W - 2 * M, 20, 'F');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.setTextColor(15, 23, 42);
    pdf.text(t.name, M + 6, y + 1);
    const [r, g, b] = t.pct >= 0.9 ? [22, 163, 74] : t.pct >= 0.75 ? [202, 138, 4] : [220, 38, 38];
    pdf.setTextColor(r, g, b); pdf.text(`${pctTxt(t.pct)}`, W - M - 6, y + 1, { align: 'right' });
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(100, 116, 139);
    pdf.text(`${t.withVideo} of ${t.ros} ROs with video · ${t.videos} videos`, W - M - 60, y + 1, { align: 'right' });
    y += 20;
    if (lines.length) {
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(71, 85, 105);
      let x = M + 6; for (const [k, w] of cols) { pdf.text(k.toUpperCase(), x, y); x += w; }
      y += 12;
    }
    if (!lines.length) { pdf.setFont('helvetica', 'italic'); pdf.setFontSize(9); pdf.setTextColor(100, 116, 139); pdf.text(onlyNo ? 'Every RO had a video.' : 'No ROs.', M + 6, y); y += 14; }
    lines.forEach((l, i) => {
      if (y > H - M - 14) { newPage(); }
      if (i % 2 === 1) { pdf.setFillColor(248, 250, 252); pdf.rect(M, y - 9, W - 2 * M, 13, 'F'); }
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(15, 23, 42);
      const cells = [l.ro, l.closed || l.opened, l.customer, l.vehicle, l.advisor];
      let cx = M + 6;
      cells.forEach((c, k) => { pdf.text(pdf.splitTextToSize(String(c || '—'), cols[k][1] - 6)[0] || '', cx, y); cx += cols[k][1]; });
      pdf.setFont('helvetica', 'bold');
      if (l.video) pdf.setTextColor(22, 163, 74); else pdf.setTextColor(220, 38, 38);
      pdf.text(l.video ? 'YES' : 'NO', cx, y);
      y += 13;
    });
    y += 14;
  }
  footer();
  pdf.save(`vmpi-report-${(report.stamp || '').split(' ')[0].replace(/\//g, '-') || 'latest'}${onlyNo ? '-no-video' : ''}.pdf`);
}

// onlyFirst: show just this tech (a tech opening their own VMPI from Technician Resources).
export default function VmpiReportView({ onClose, io, onlyFirst = '' }) {
  const load = (io && io.loadVmpiReport) || loadVmpiReport;
  const [report, setReport] = useState(undefined);
  const [onlyNo, setOnlyNo] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { let c = false; load().then(r => { if (!c) setReport(r); }); return () => { c = true; }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const techs = useMemo(() => ((report && report.techs) || [])
    .filter(t => !onlyFirst || t.first === String(onlyFirst).trim().split(/\s+/)[0].toUpperCase())
    .slice().sort((a, b) => a.pct - b.pct || a.name.localeCompare(b.name)), [report, onlyFirst]);
  const shop = techs.reduce((a, t) => ({ ros: a.ros + t.ros, w: a.w + t.withVideo }), { ros: 0, w: 0 });

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: '#0b1220', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px', borderBottom: '1px solid rgba(148,163,184,.18)', flexWrap: 'wrap', background: '#0f172a' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#67e8f9' }}>🎥 {onlyFirst ? 'My VMPI' : 'VMPI Report'}</div>
          <div style={{ fontSize: 13, color: '#94a3b8' }}>
            {report ? `${report.store || 'Bob Rohrman Hyundai'} · report ${report.stamp || '—'} · uploaded ${new Date(report.savedAt).toLocaleDateString()}` : report === null ? 'No VMPI report uploaded yet' : 'Loading…'}
          </div>
        </div>
        <label style={{ fontSize: 13, color: '#cbd5e1', display: 'inline-flex', gap: 6, alignItems: 'center', fontWeight: 700 }}>
          <input type="checkbox" checked={onlyNo} onChange={e => setOnlyNo(e.target.checked)} /> Only ROs without video
        </label>
        <button disabled={!techs.length || saving} onClick={async () => { setSaving(true); try { await savePdf(report, techs, onlyNo); } finally { setSaving(false); } }}
          style={{ background: 'rgba(74,222,128,.15)', border: '1px solid rgba(74,222,128,.5)', color: '#86efac', borderRadius: 9, padding: '8px 16px', fontWeight: 800, fontSize: 13.5, cursor: 'pointer' }}>
          {saving ? '⏳ Saving…' : '📄 Save as .pdf'}
        </button>
        <button className="secondary" onClick={onClose}>✕ Close</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px 40px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          {report === null && <div style={{ color: '#fbbf24', fontWeight: 700 }}>{onlyFirst ? 'No VMPI report has been uploaded yet.' : 'Upload a VMPI report on this page first — the report is saved when you click Apply.'}</div>}
          {report && onlyFirst && !techs.length && <div style={{ color: '#fbbf24', fontWeight: 700 }}>You're not on the last VMPI report ({report.stamp || 'latest'}).</div>}
          {techs.length > 0 && (
            <>
              {!onlyFirst && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                <div style={{ padding: '10px 16px', borderRadius: 12, background: 'rgba(103,232,249,.08)', border: '1px solid rgba(103,232,249,.3)' }}>
                  <div style={{ fontSize: 11, fontWeight: 900, color: '#94a3b8', letterSpacing: '.08em' }}>SHOP</div>
                  <div style={{ fontSize: 26, fontWeight: 1000, color: tone(shop.ros ? shop.w / shop.ros : 0) }}>{pctTxt(shop.ros ? shop.w / shop.ros : 0)}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{shop.w} of {shop.ros} ROs</div>
                </div>
                {techs.map(t => (
                  <a key={t.name} href={`#vmpi-${t.first}`} style={{ textDecoration: 'none', padding: '10px 16px', borderRadius: 12, background: 'rgba(255,255,255,.04)', border: `1px solid ${tone(t.pct)}55` }}>
                    <div style={{ fontSize: 11, fontWeight: 900, color: '#cbd5e1', letterSpacing: '.06em' }}>{t.first}</div>
                    <div style={{ fontSize: 22, fontWeight: 1000, color: tone(t.pct) }}>{pctTxt(t.pct)}</div>
                    <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{t.withVideo} of {t.ros}</div>
                  </a>
                ))}
              </div>}
              {techs.map(t => {
                const lines = onlyNo ? t.lines.filter(l => !l.video) : t.lines;
                return (
                  <div key={t.name} id={`vmpi-${t.first}`} style={{ marginBottom: 18, borderRadius: 14, border: '1px solid rgba(148,163,184,.18)', background: 'rgba(15,23,42,.6)', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '12px 16px', background: 'rgba(255,255,255,.03)', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 17, fontWeight: 900, color: '#f1f5f9' }}>{t.name}</span>
                      <span style={{ fontSize: 13, color: '#94a3b8' }}>{t.withVideo} of {t.ros} ROs with video · {t.videos} videos</span>
                      <span style={{ flex: 1 }} />
                      <span style={{ fontSize: 22, fontWeight: 1000, color: tone(t.pct) }}>{pctTxt(t.pct)}</span>
                    </div>
                    {lines.length === 0 ? (
                      <div style={{ padding: '10px 16px', color: '#86efac', fontSize: 13, fontWeight: 700 }}>{onlyNo ? '✓ Every RO had a video.' : 'No ROs.'}</div>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'auto' }}>
                        <thead>
                          <tr style={{ textAlign: 'left', color: '#64748b', fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase' }}>
                            {['RO', 'Closed', 'Customer', 'Vehicle', 'Advisor', 'VMPI'].map(h => <th key={h} style={{ padding: '6px 12px', borderBottom: '1px solid rgba(148,163,184,.15)' }}>{h}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map(l => (
                            <tr key={l.ro} style={{ background: l.video ? 'transparent' : 'rgba(248,113,113,.06)' }}>
                              <td style={{ padding: '6px 12px', fontWeight: 800, color: '#67e8f9' }}>{l.ro}</td>
                              <td style={{ padding: '6px 12px', color: '#cbd5e1' }}>{l.closed || l.opened}</td>
                              <td style={{ padding: '6px 12px', color: '#e2e8f0' }}>{l.customer || '—'}</td>
                              <td style={{ padding: '6px 12px', color: '#cbd5e1' }}>{l.vehicle || '—'}</td>
                              <td style={{ padding: '6px 12px', color: '#94a3b8' }}>{l.advisor || '—'}</td>
                              <td style={{ padding: '6px 12px' }}>
                                <span style={{ fontWeight: 900, fontSize: 12, padding: '2px 10px', borderRadius: 999,
                                  color: l.video ? '#052e16' : '#fff', background: l.video ? '#4ade80' : '#ef4444' }}>{l.video ? 'YES' : 'NO'}</span>
                                {l.video && l.videos > 1 ? <span style={{ fontSize: 11, color: '#64748b', marginLeft: 6 }}>{l.videos} videos</span> : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
