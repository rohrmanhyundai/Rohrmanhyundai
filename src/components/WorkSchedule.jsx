import React, { useState } from 'react';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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

function ShiftBadge({ name, val }) {
  const color = shiftColor(val);
  const parts = val && val !== 'vacation' && val !== 'off' ? val.split(' | ') : null;
  const shiftPart = parts ? parts[0] : null;
  const lunchPart = parts && parts[1] ? parts[1].replace('Lunch ', '') : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 3, width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span className="ws-print-badge-name" style={{ fontSize: 10, color: '#c8d8f0', fontWeight: 700 }}>
          {name.split(' ')[0]}
        </span>
        <span className={`ws-print-badge-shift${val === 'vacation' ? ' ws-print-badge-shift--vac' : val === 'off' ? ' ws-print-badge-shift--off' : ''}`} style={{ fontSize: 9, color: val === 'vacation' ? '#f59e0b' : val === 'off' ? '#94a3b8' : '#3dd6c3' }}>
          {val === 'vacation' ? 'Vacation' : val === 'off' ? 'Off' : shiftPart}
        </span>
      </div>
      {lunchPart && (
        <div className="ws-print-badge-lunch" style={{ fontSize: 9, color: '#f59e0b', textAlign: 'center' }}>
          🍽 {lunchPart}
        </div>
      )}
    </div>
  );
}

function CalendarView({ year, month, schedules, employeeNames, onBack }) {
  const today = new Date();
  const totalDays = getDaysInMonth(year, month);
  const firstDow = getFirstDayOfWeek(year, month);
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const numRows = cells.length / 7;

  return (
    <div className="ws-print-root" style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0d1117' }}>
      <div className="adv-topbar no-print" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button className="secondary" onClick={onBack}>← Back</button>
        <span style={{ fontWeight: 700, fontSize: 18, color: '#6ee7f9', flex: 1 }}>{monthLabel(year, month)} — Work Schedule</span>
        <button onClick={() => window.print()} style={{ background: 'linear-gradient(135deg,rgba(110,231,249,.25),rgba(61,214,195,.18))', borderColor: 'rgba(110,231,249,.35)' }}>🖨 Print</button>
      </div>

      {/* Print-only header */}
      <div className="ws-print-header" style={{ display: 'none' }}>
        <div style={{ textAlign: 'center', fontWeight: 900, fontSize: 22 }}>Bob Rohrman Hyundai</div>
        <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 16, marginTop: 2 }}>{monthLabel(year, month)} — Work Schedule</div>
      </div>

      <div className="ws-print-inner" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 16px 8px', minHeight: 0 }}>
        {/* Day headers */}
        <div className="ws-print-dayheader" style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginBottom: 4, flexShrink: 0 }}>
          {DAYS.map(d => (
            <div key={d} style={{ textAlign: 'center', color: '#7a92b8', fontWeight: 700, fontSize: 12, padding: '4px 0', textTransform: 'uppercase' }}>{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="ws-print-grid" style={{ flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gridTemplateRows: `repeat(${numRows},minmax(min-content,1fr))`, gap: 4, alignContent: 'stretch' }}>
          {cells.map((day, i) => {
            if (!day) return <div key={i} />;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
            const isHoliday = schedules['__HOLIDAY__']?.[dateStr] === 'holiday';
            const entries = isHoliday ? [] : employeeNames
              .map(name => ({ name, val: schedules[name]?.[dateStr] }))
              .filter(e => e.val);
            const cellClass = `ws-print-cell${isToday ? ' ws-print-cell--today' : isHoliday ? ' ws-print-cell--holiday' : ''}`;

            return (
              <div key={i} className={cellClass} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                background: isHoliday ? 'rgba(239,68,68,0.1)' : isToday ? 'rgba(61,214,195,0.1)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${isHoliday ? 'rgba(239,68,68,0.4)' : isToday ? 'rgba(61,214,195,0.4)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 8, padding: '6px 8px',
              }}>
                <div className={`ws-print-daynum${isToday ? ' ws-print-daynum--today' : isHoliday ? ' ws-print-daynum--holiday' : ''}`} style={{ fontWeight: 700, fontSize: 13, color: isHoliday ? '#ef4444' : isToday ? '#3dd6c3' : '#94a3b8', marginBottom: entries.length ? 4 : 0, textAlign: 'center' }}>{day}</div>
                {isHoliday && <div style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', textAlign: 'center' }}>🎉 Holiday</div>}
                {entries.map(e => <ShiftBadge key={e.name} name={e.name} val={e.val} />)}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="ws-print-legend" style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap', flexShrink: 0 }}>
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

export default function WorkSchedule({ schedules, employeeNames, onBack }) {
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
          onBack={() => setSelected(null)}
        />
      </div>
    );
  }

  return (
    <div className="adv-page">
      <div className="adv-topbar no-print" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="secondary" onClick={onBack}>← Appointment Prep</button>
        <span style={{ fontWeight: 700, fontSize: 18, color: '#6ee7f9' }}>Employee Work Schedule</span>
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
