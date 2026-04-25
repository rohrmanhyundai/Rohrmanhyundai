import React, { useState } from 'react';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function monthLabel(year, month) {
  return `${MONTHS[month]} ${year}`;
}

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year, month) {
  return new Date(year, month, 1).getDay();
}

function shiftColor(val) {
  if (!val) return null;
  if (val === 'vacation') return '#f59e0b';
  if (val === 'off') return '#64748b';
  return '#3dd6c3';
}

function ShiftBadge({ name, val, isOwn }) {
  const color = shiftColor(val);
  const parts = val && val !== 'vacation' && val !== 'off' ? val.split(' | ') : null;
  const shiftPart = parts ? parts[0] : null;
  const lunchPart = parts && parts[1] ? parts[1].replace('Lunch ', '') : null;
  return (
    <div className={isOwn ? 'ws-badge-mine' : 'ws-badge-other'} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexWrap: 'wrap', gap: 4, marginTop: 3,
      background: 'rgba(255,255,255,0.06)', borderRadius: 5,
      padding: '3px 6px', boxSizing: 'border-box', width: '100%',
    }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span className="ws-print-badge-name" style={{ fontSize: 10, color: '#c8d8f0', fontWeight: 700, whiteSpace: 'nowrap' }}>
        {name.split(' ')[0]}
      </span>
      <span className={`ws-print-badge-shift${val === 'vacation' ? ' ws-print-badge-shift--vac' : val === 'off' ? ' ws-print-badge-shift--off' : ''}`} style={{ fontSize: 9, color: val === 'vacation' ? '#f59e0b' : val === 'off' ? '#94a3b8' : '#3dd6c3', whiteSpace: 'nowrap' }}>
        {val === 'vacation' ? 'Vacation' : val === 'off' ? 'Off' : shiftPart}
      </span>
      {lunchPart && (
        <span className="ws-print-badge-lunch" style={{ fontSize: 9, color: '#f59e0b', whiteSpace: 'nowrap' }}>
          🍽 {lunchPart}
        </span>
      )}
    </div>
  );
}

const PRINT_DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function fmtShiftStr(val) {
  if (!val) return { text: '', cls: 'empty' };
  if (val === 'vacation') return { text: 'VACATION', cls: 'vac' };
  if (val === 'off')      return { text: 'OFF',      cls: 'off' };
  const m = val.match(/(\d+):(\d+)\s*(AM|PM)\s*-\s*(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return { text: val.slice(0, 14), cls: 'shift' };
  const fmt = (h, mn, ap) => `${h}${mn !== '00' ? ':'+mn : ''}${ap[0].toLowerCase()}`;
  const lm  = val.match(/Lunch\s+(\d+):(\d+)\s*(AM|PM)\s*-\s*(\d+):(\d+)\s*(AM|PM)/i);
  const lunch = lm ? `<br><span class="lunch">🍽 ${fmt(lm[1],lm[2],lm[3])}–${fmt(lm[4],lm[5],lm[6])}</span>` : '';
  return { text: `${fmt(m[1],m[2],m[3])}–${fmt(m[4],m[5],m[6])}${lunch}`, cls: 'shift' };
}

function buildScheduleHTML({ year, month, employeeNames, schedules, title }, forPrint) {
  const HOLIDAY_KEY = '__HOLIDAY__';
  const totalDays = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const monthName = MONTHS[month];
  const printedOn = today.toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });

  // Build working day rows
  const rows = [];
  for (let d = 1; d <= totalDays; d++) {
    const dow = new Date(year, month, d).getDay();
    if (dow === 0) continue; // skip Sunday
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isHoliday = schedules[HOLIDAY_KEY]?.[dateStr] === 'holiday';
    const isToday   = dateStr === todayStr;
    rows.push({ d, dow, dateStr, isHoliday, isToday });
  }

  // Build column headers HTML
  const thCols = employeeNames.map(n =>
    `<th>${n.split(' ')[0]}</th>`
  ).join('');

  // Build table rows HTML
  const trRows = rows.map((r, i) => {
    const cls = [
      i % 2 ? 'alt' : '',
      r.isToday   ? 'today'   : '',
      r.isHoliday ? 'holiday' : '',
    ].filter(Boolean).join(' ');

    const dayName = PRINT_DAY_NAMES[r.dow];
    const dateCell = `<td class="date-col"><span class="dow">${dayName}</span><span class="daynum">${r.d}</span></td>`;

    let dataCells;
    if (r.isHoliday) {
      dataCells = `<td colspan="${employeeNames.length}" class="holiday-cell">🎉 Company Holiday</td>`;
    } else {
      dataCells = employeeNames.map(name => {
        const val = schedules[name]?.[r.dateStr];
        const { text, cls: sCls } = fmtShiftStr(val);
        return `<td class="cell ${sCls}">${text || '<span class="dash">—</span>'}</td>`;
      }).join('');
    }
    return `<tr class="${cls}">${dateCell}${dataCells}</tr>`;
  }).join('');

  const colWidth = Math.max(60, Math.floor(650 / (employeeNames.length + 1)));

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title || 'Work Schedule'} — ${monthName} ${year}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: landscape; margin: 10mm 12mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; color: #111; }

  /* Header */
  .header {
    display: flex; align-items: center; justify-content: space-between;
    background: #0f172a; color: #fff;
    padding: 10px 18px; border-radius: 6px 6px 0 0;
    border-bottom: 3px solid #14b8a6;
  }
  .h-company { font-size: 13px; font-weight: 900; letter-spacing: .4px; }
  .h-dept    { font-size: 8px; color: #94a3b8; margin-top: 2px; text-transform: uppercase; letter-spacing: .6px; }
  .h-title   { font-size: 17px; font-weight: 900; color: #5eead4; letter-spacing: 1px; text-transform: uppercase; text-align: center; }
  .h-month   { font-size: 11px; color: #cbd5e1; text-align: center; margin-top: 3px; font-weight: 600; }
  .h-right   { text-align: right; }
  .h-printed-label { font-size: 8px; color: #64748b; text-transform: uppercase; letter-spacing: .5px; }
  .h-printed-date  { font-size: 10px; color: #94a3b8; font-weight: 700; margin-top: 2px; }

  /* Table */
  table { width: 100%; border-collapse: collapse; font-size: 8.5px; table-layout: fixed; margin-top: 2px; }
  thead tr { background: #1e293b; }
  th {
    color: #e2e8f0; font-weight: 800; font-size: 8px;
    text-transform: uppercase; letter-spacing: .5px;
    padding: 5px 4px; text-align: center;
    border: 1px solid #334155;
    width: ${colWidth}px;
  }
  th:first-child { text-align: left; padding-left: 8px; color: #94a3b8; width: 58px; }

  tr { background: #fff; }
  tr.alt     { background: #f8fafc; }
  tr.today   { background: #ecfdf5 !important; }
  tr.holiday { background: #fff5f5 !important; }

  td { border: 1px solid #e2e8f0; padding: 3px 4px; text-align: center; vertical-align: middle; line-height: 1.35; }

  td.date-col {
    text-align: left; padding-left: 8px; white-space: nowrap;
    border-left: 3px solid #e2e8f0; font-weight: 700;
  }
  tr.today   td.date-col { border-left-color: #14b8a6; }
  tr.holiday td.date-col { border-left-color: #ef4444; }

  .dow    { font-size: 7px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: .4px; display: inline-block; width: 24px; }
  .daynum { font-size: 10px; font-weight: 900; color: #1e293b; }
  tr.today   .dow, tr.today   .daynum { color: #0d9488; }
  tr.holiday .dow, tr.holiday .daynum { color: #ef4444; }

  td.cell        { font-weight: 600; }
  td.shift       { color: #0d9488; background: #f0fdfa; }
  td.vac         { color: #b45309; background: #fffbeb; font-weight: 800; }
  td.off         { color: #94a3b8; background: #f9fafb; }
  td.empty       { color: #e5e7eb; }
  td.holiday-cell{ color: #ef4444; font-weight: 700; background: #fff5f5; font-size: 8px; letter-spacing: .3px; }
  .dash          { color: #e2e8f0; }
  .lunch         { display: block; font-size: 7px; color: #b45309; margin-top: 1px; }

  /* Footer */
  .footer {
    display: flex; justify-content: space-between; align-items: center;
    border-top: 2px solid #0f172a; padding: 5px 6px; margin-top: 3px;
  }
  .legend { display: flex; gap: 14px; }
  .leg    { font-size: 8px; font-weight: 700; }
  .leg-shift { color: #0d9488; }
  .leg-vac   { color: #b45309; }
  .leg-off   { color: #94a3b8; }
  .leg-today { color: #14b8a6; }
  .footer-note { font-size: 7.5px; color: #94a3b8; font-style: italic; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="h-company">Bob Rohrman Hyundai</div>
      <div class="h-dept">Service Department</div>
    </div>
    <div>
      <div class="h-title">${title || 'Work Schedule'}</div>
      <div class="h-month">${monthName} ${year}</div>
    </div>
    <div class="h-right">
      <div class="h-printed-label">Printed</div>
      <div class="h-printed-date">${printedOn}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Date</th>
        ${thCols}
      </tr>
    </thead>
    <tbody>
      ${trRows}
    </tbody>
  </table>

  <div class="footer">
    <div class="legend">
      <span class="leg leg-shift">● Working Shift</span>
      <span class="leg leg-vac">● Vacation</span>
      <span class="leg leg-off">● Off</span>
      <span class="leg leg-today">● Today</span>
    </div>
    <div class="footer-note">Bob Rohrman Hyundai — Confidential</div>
  </div>

  ${forPrint ? '<script>window.onload=function(){window.focus();window.print();}<\/script>' : ''}
</body>
</html>`;
  return html;
}

// Print via hidden iframe — no popup permission needed
function printSchedule(opts) {
  const html = buildScheduleHTML(opts, true);
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-9999px;top:-9999px;';
  document.body.appendChild(iframe);
  iframe.contentDocument.open();
  iframe.contentDocument.write(html);
  iframe.contentDocument.close();
  iframe.contentWindow.focus();
  setTimeout(() => {
    iframe.contentWindow.print();
    setTimeout(() => document.body.removeChild(iframe), 2000);
  }, 500);
}

// Download as .html file — opens beautifully in any browser, save as PDF from there
function downloadSchedule(opts) {
  const html = buildScheduleHTML(opts, false);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const monthName = MONTHS[opts.month];
  a.href     = url;
  a.download = `${opts.title || 'Schedule'}-${monthName}-${opts.year}.html`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 500);
}

function CalendarView({ year, month, schedules, employeeNames, currentUser, onBack, title }) {
  const today = new Date();
  const totalDays = getDaysInMonth(year, month);
  const firstDow = getFirstDayOfWeek(year, month); // 0=Sun,1=Mon,...
  // Mon–Sat grid: skip Sundays entirely
  const leadingEmpties = firstDow === 0 ? 0 : firstDow - 1;
  const cells = [];
  for (let i = 0; i < leadingEmpties; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) {
    if (new Date(year, month, d).getDay() !== 0) cells.push(d);
  }
  while (cells.length % 6 !== 0) cells.push(null);

  const numRows = cells.length / 6;

  // Pre-compute cell data once for both screen and print
  const cellData = cells.map((day) => {
    if (!day) return { day: null };
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
    const isHoliday = schedules['__HOLIDAY__']?.[dateStr] === 'holiday';
    const entries = isHoliday ? [] : employeeNames
      .map(name => ({ name, val: schedules[name]?.[dateStr] }))
      .filter(e => e.val);
    return { day, dateStr, isToday, isHoliday, entries };
  });

  return (
    <div className="ws-print-root" style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0d1117' }}>

      {/* ── Screen toolbar ── */}
      <div className="adv-topbar no-print" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button className="secondary" onClick={onBack}>← Back</button>
        <span style={{ fontWeight: 700, fontSize: 18, color: '#6ee7f9', flex: 1 }}>{monthLabel(year, month)} — {title || 'Work Schedule'}</span>
        <button
          onClick={() => printSchedule({ year, month, employeeNames, schedules, title })}
          style={{ background: 'linear-gradient(135deg,rgba(110,231,249,.25),rgba(61,214,195,.18))', borderColor: 'rgba(110,231,249,.35)' }}
        >🖨 Print</button>
        <button
          onClick={() => downloadSchedule({ year, month, employeeNames, schedules, title })}
          style={{ background: 'linear-gradient(135deg,rgba(167,139,250,.25),rgba(139,92,246,.18))', borderColor: 'rgba(167,139,250,.35)' }}
        >⬇ Download</button>
      </div>

      {/* ── Screen calendar ── */}
      <div className="no-print" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 16px 8px', minHeight: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 4, marginBottom: 4, flexShrink: 0 }}>
          {DAYS.map(d => (
            <div key={d} style={{ textAlign: 'center', color: '#7a92b8', fontWeight: 700, fontSize: 12, padding: '4px 0', textTransform: 'uppercase' }}>{d}</div>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gridTemplateRows: `repeat(${numRows},minmax(min-content,1fr))`, gap: 4, alignContent: 'stretch' }}>
          {cellData.map((c, i) => {
            if (!c.day) return <div key={i} />;
            return (
              <div key={i} style={{
                position: 'relative',
                background: c.isHoliday ? 'rgba(239,68,68,0.1)' : c.isToday ? 'rgba(61,214,195,0.1)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${c.isHoliday ? 'rgba(239,68,68,0.4)' : c.isToday ? 'rgba(61,214,195,0.4)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 8, padding: '24px 6px 6px',
                display: 'flex', flexDirection: 'column', justifyContent: 'center',
              }}>
                <div style={{ position: 'absolute', top: 5, left: 8, fontWeight: 700, fontSize: 12, color: c.isHoliday ? '#ef4444' : c.isToday ? '#3dd6c3' : '#94a3b8' }}>{c.day}</div>
                {c.isHoliday && <div style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', textAlign: 'center' }}>🎉 Holiday</div>}
                {c.entries.map(e => <ShiftBadge key={e.name} name={e.name} val={e.val} isOwn={e.name.toUpperCase() === currentUser} />)}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap', flexShrink: 0 }}>
          {[['#3dd6c3', 'Scheduled Shift'], ['#f59e0b', 'Vacation / Lunch'], ['#64748b', 'Off']].map(([color, label]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
              <span style={{ color: '#7a92b8', fontSize: 12 }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

export default function WorkSchedule({ schedules, employeeNames, currentUser, onBack, backLabel, title }) {
  const today = new Date();
  const months = [
    { year: today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear(), month: (today.getMonth() + 11) % 12 },
    { year: today.getFullYear(), month: today.getMonth() },
    { year: today.getMonth() === 11 ? today.getFullYear() + 1 : today.getFullYear(), month: (today.getMonth() + 1) % 12 },
  ];
  const [selected, setSelected] = useState(null);

  if (selected !== null) {
    const { year, month } = months[selected];
    return (
      <div className="adv-page">
        <CalendarView
          year={year} month={month}
          schedules={schedules} employeeNames={employeeNames}
          currentUser={currentUser}
          title={title}
          onBack={() => setSelected(null)}
        />
      </div>
    );
  }

  return (
    <div className="adv-page">
      <div className="adv-topbar no-print" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="secondary" onClick={onBack}>{backLabel || '← Appointment Prep'}</button>
        <span style={{ fontWeight: 700, fontSize: 18, color: '#6ee7f9' }}>{title || 'Employee Work Schedule'}</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
        <p style={{ color: '#7a92b8', margin: 0 }}>Select a month to view the full schedule.</p>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
          {months.map(({ year, month }, i) => {
            const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();
            const daysInMonth = getDaysInMonth(year, month);
            const totalEntries = employeeNames.reduce((sum, name) => {
              const entries = Object.keys(schedules[name] || {}).filter(d => d.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`));
              return sum + entries.length;
            }, 0);
            return (
              <button
                key={i}
                onClick={() => setSelected(i)}
                style={{
                  width: 200, minHeight: 130, background: isCurrentMonth
                    ? 'linear-gradient(135deg,rgba(61,214,195,.2),rgba(110,231,249,.15))'
                    : 'rgba(255,255,255,0.04)',
                  border: `2px solid ${isCurrentMonth ? 'rgba(61,214,195,.5)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: 16, cursor: 'pointer', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20,
                  transition: 'transform .15s, border-color .15s',
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.04)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
              >
                {isCurrentMonth && <div style={{ fontSize: 10, color: '#3dd6c3', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Current Month</div>}
                <div style={{ fontSize: 26, fontWeight: 900, color: '#e2e8f0' }}>{MONTHS[month].slice(0, 3)}</div>
                <div style={{ fontSize: 14, color: '#7a92b8' }}>{year}</div>
                <div style={{ fontSize: 11, color: '#4fc3f7' }}>{totalEntries} shift{totalEntries !== 1 ? 's' : ''} scheduled</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
