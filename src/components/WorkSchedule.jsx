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

function fmtPrintShift(val) {
  if (!val) return null;
  if (val === 'vacation') return { text: 'VACATION', type: 'vac' };
  if (val === 'off')      return { text: 'OFF',      type: 'off' };
  const m = val.match(/(\d+):(\d+)\s*(AM|PM)\s*-\s*(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return { text: val.slice(0, 14), type: 'shift' };
  const fmt = (h, mn, ap) => `${h}${mn !== '00' ? ':' + mn : ''}${ap[0].toLowerCase()}`;
  const lm = val.match(/Lunch\s+(\d+):(\d+)\s*(AM|PM)\s*-\s*(\d+):(\d+)\s*(AM|PM)/i);
  const lunch = lm ? `  🍽 ${fmt(lm[1],lm[2],lm[3])}–${fmt(lm[4],lm[5],lm[6])}` : '';
  return { text: `${fmt(m[1],m[2],m[3])}–${fmt(m[4],m[5],m[6])}`, lunch, type: 'shift' };
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
        <button onClick={() => window.print()} style={{ background: 'linear-gradient(135deg,rgba(110,231,249,.25),rgba(61,214,195,.18))', borderColor: 'rgba(110,231,249,.35)' }}>🖨 Print / Download PDF</button>
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

      {/* ── Print-only table layout (hidden on screen) ── */}
      <div className="ws-pt-page">
        {/* Header bar */}
        <div className="ws-pt-header">
          <div className="ws-pt-header-left">
            <div className="ws-pt-company">Bob Rohrman Hyundai</div>
            <div className="ws-pt-dept">Service Department</div>
          </div>
          <div className="ws-pt-header-center">
            <div className="ws-pt-title-text">{title || 'Work Schedule'}</div>
            <div className="ws-pt-month-text">{monthLabel(year, month)}</div>
          </div>
          <div className="ws-pt-header-right">
            <div className="ws-pt-printed-label">Printed</div>
            <div className="ws-pt-printed-date">{new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div>
          </div>
        </div>

        {/* Schedule table */}
        <table className="ws-pt-table">
          <thead>
            <tr>
              <th className="ws-pt-th ws-pt-th-date">Date</th>
              {employeeNames.map(name => (
                <th key={name} className="ws-pt-th">{name.split(' ')[0]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cellData.filter(c => c.day).map((c, rowIdx) => {
              const dow = new Date(c.dateStr).getDay();
              const isHoliday = c.isHoliday;
              return (
                <tr key={c.dateStr} className={
                  `ws-pt-tr` +
                  (c.isToday   ? ' ws-pt-tr--today'   : '') +
                  (isHoliday   ? ' ws-pt-tr--holiday'  : '') +
                  (rowIdx % 2  ? ' ws-pt-tr--alt'      : '')
                }>
                  <td className="ws-pt-td-date">
                    <span className="ws-pt-dow">{PRINT_DAY_NAMES[dow]}</span>
                    <span className="ws-pt-day">{c.day}</span>
                  </td>
                  {isHoliday ? (
                    <td colSpan={employeeNames.length} className="ws-pt-td ws-pt-td-holiday">
                      🎉 Company Holiday
                    </td>
                  ) : (
                    employeeNames.map(name => {
                      const val = schedules[name]?.[c.dateStr];
                      const fmt = fmtPrintShift(val);
                      const isMe = name.toUpperCase() === currentUser;
                      return (
                        <td key={name} className={`ws-pt-td ws-pt-td--${fmt?.type || 'empty'}${isMe ? ' ws-pt-td--me' : ''}`}>
                          {fmt ? (
                            <>
                              <span className="ws-pt-shift-text">{fmt.text}</span>
                              {fmt.lunch && <span className="ws-pt-lunch-text">{fmt.lunch}</span>}
                            </>
                          ) : (
                            <span className="ws-pt-empty-dash">—</span>
                          )}
                        </td>
                      );
                    })
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Footer legend */}
        <div className="ws-pt-footer">
          <div className="ws-pt-legend">
            <span className="ws-pt-leg-item ws-pt-leg--shift">● Working Shift</span>
            <span className="ws-pt-leg-item ws-pt-leg--vac">● Vacation</span>
            <span className="ws-pt-leg-item ws-pt-leg--off">● Off</span>
            <span className="ws-pt-leg-item ws-pt-leg--today">● Today</span>
          </div>
          <div className="ws-pt-footer-note">Bob Rohrman Hyundai — Confidential</div>
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
