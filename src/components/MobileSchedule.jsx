import React, { useState, useEffect, useRef } from 'react';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function shiftColor(val) {
  if (val === 'vacation') return '#f59e0b';
  if (val === 'off') return '#64748b';
  return '#3dd6c3';
}

export default function MobileSchedule({ schedules, employeeNames, currentUser, title, onBack }) {
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const todayRef = useRef(null);

  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  function prevMonth() { if (month === 0) { setMonth(11); setYear(y => y-1); } else setMonth(m => m-1); }
  function nextMonth() { if (month === 11) { setMonth(0); setYear(y => y+1); } else setMonth(m => m+1); }

  // Jump to today
  function goToday() {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setTimeout(() => todayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Build day objects, grouped into weeks (Mon-Sat, skip Sunday)
  const weeks = [];
  let currentWeek = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dow = new Date(year, month, d).getDay();
    if (dow === 0) continue; // skip Sunday
    const isToday = dateStr === todayStr;
    const isHoliday = schedules['__HOLIDAY__']?.[dateStr] === 'holiday';
    const entries = isHoliday ? [] : employeeNames
      .map(name => ({ name, val: schedules[name]?.[dateStr] }))
      .filter(e => e.val);
    const myEntry = entries.find(e => e.name.toUpperCase() === currentUser);
    currentWeek.push({ d, dateStr, dow, isToday, isHoliday, entries, myEntry });
    // New week starts on Monday (dow === 1), flush previous week
    if (dow === 6 || d === daysInMonth) {
      weeks.push([...currentWeek]);
      currentWeek = [];
    } else if (dow === 1 && currentWeek.length > 1) {
      // Monday means we just closed prev week — handled by flush on Saturday above; skip
    }
  }

  // Simpler grouping: collect into 6-day chunks (Mon–Sat)
  const allDays = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month, d).getDay();
    if (dow === 0) continue;
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = dateStr === todayStr;
    const isHoliday = schedules['__HOLIDAY__']?.[dateStr] === 'holiday';
    const entries = isHoliday ? [] : employeeNames
      .map(name => ({ name, val: schedules[name]?.[dateStr] }))
      .filter(e => e.val);
    const myEntry = entries.find(e => e.name.toUpperCase() === currentUser);
    allDays.push({ d, dateStr, dow, isToday, isHoliday, entries, myEntry });
  }

  // Group into weeks by Monday boundaries
  const weekGroups = [];
  let wk = [];
  allDays.forEach(day => {
    if (day.dow === 1 && wk.length) { weekGroups.push(wk); wk = []; }
    wk.push(day);
  });
  if (wk.length) weekGroups.push(wk);

  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();

  return (
    <div style={{ minHeight: '100vh', background: '#0b1120', color: '#e2e8f0', fontFamily: 'Inter, -apple-system, sans-serif', display: 'flex', flexDirection: 'column' }}>

      {/* Sticky header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'rgba(11,17,32,0.97)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '12px 16px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: '#94a3b8', borderRadius: 10, padding: '7px 13px', fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>← Back</button>
          <span style={{ fontWeight: 800, fontSize: 15, color: '#6ee7f9', flex: 1, textAlign: 'center' }}>{title || 'Work Schedule'}</span>
          {isCurrentMonth
            ? <div style={{ width: 60 }} />
            : <button onClick={goToday} style={{ background: 'rgba(61,214,195,0.12)', border: '1px solid rgba(61,214,195,0.3)', color: '#3dd6c3', borderRadius: 10, padding: '7px 10px', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>Today</button>
          }
        </div>

        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={prevMonth} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', borderRadius: 10, width: 38, height: 38, fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 900, fontSize: 22, color: '#f1f5f9' }}>{MONTHS[month]}</div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: -2 }}>{year}</div>
          </div>
          <button onClick={nextMonth} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', borderRadius: 10, width: 38, height: 38, fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
        </div>
      </div>

      {/* Schedule list */}
      <div style={{ flex: 1, padding: '12px 14px 40px', overflowY: 'auto' }}>
        {weekGroups.map((week, wi) => {
          const hasAnyEntry = week.some(d => d.isHoliday || d.entries.length > 0);
          return (
            <div key={wi} style={{ marginBottom: 16 }}>
              {/* Week label */}
              <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, paddingLeft: 2 }}>
                {DAY_NAMES[week[0].dow]} {week[0].d} — {DAY_NAMES[week[week.length-1].dow]} {week[week.length-1].d}
              </div>

              {week.map(({ d, dateStr, dow, isToday, isHoliday, entries, myEntry }) => {
                const hasContent = isHoliday || entries.length > 0;
                return (
                  <div
                    key={d}
                    ref={isToday ? todayRef : null}
                    style={{
                      marginBottom: 6,
                      borderRadius: 14,
                      overflow: 'hidden',
                      border: `1px solid ${isToday ? 'rgba(61,214,195,0.45)' : isHoliday ? 'rgba(239,68,68,0.3)' : myEntry ? 'rgba(61,214,195,0.15)' : 'rgba(255,255,255,0.06)'}`,
                      background: isToday ? 'rgba(61,214,195,0.07)' : isHoliday ? 'rgba(239,68,68,0.07)' : myEntry ? 'rgba(61,214,195,0.04)' : 'rgba(255,255,255,0.025)',
                    }}
                  >
                    {/* Day header row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: hasContent ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                      {/* Day badge */}
                      <div style={{
                        width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                        background: isToday ? 'linear-gradient(135deg,rgba(61,214,195,0.35),rgba(110,231,249,0.25))' : 'rgba(255,255,255,0.06)',
                        border: isToday ? '1.5px solid rgba(61,214,195,0.5)' : '1px solid rgba(255,255,255,0.08)',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: isToday ? '#3dd6c3' : '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>{DAY_NAMES[dow]}</span>
                        <span style={{ fontSize: 18, fontWeight: 900, color: isToday ? '#3dd6c3' : isHoliday ? '#ef4444' : '#e2e8f0', lineHeight: 1.1 }}>{d}</span>
                      </div>
                      <div>
                        {isToday && <div style={{ fontSize: 10, fontWeight: 700, color: '#3dd6c3', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 1 }}>Today</div>}
                        {isHoliday && <div style={{ fontSize: 13, fontWeight: 700, color: '#ef4444' }}>🎉 Company Holiday</div>}
                        {!hasContent && <div style={{ fontSize: 12, color: '#334155' }}>No shifts scheduled</div>}
                        {!isHoliday && entries.length > 0 && (
                          <div style={{ fontSize: 11, color: '#64748b' }}>{entries.length} {entries.length === 1 ? 'shift' : 'shifts'} scheduled</div>
                        )}
                      </div>
                    </div>

                    {/* Shift entries */}
                    {!isHoliday && entries.length > 0 && (
                      <div style={{ padding: '6px 10px 8px' }}>
                        {entries.map(e => {
                          const isMe = e.name.toUpperCase() === currentUser;
                          const parts = e.val !== 'vacation' && e.val !== 'off' ? e.val.split(' | ') : null;
                          const shift = parts ? parts[0] : (e.val === 'vacation' ? '🌴 Vacation' : 'Off');
                          const lunch = parts?.[1]?.replace('Lunch ', '');
                          const dot = shiftColor(e.val);
                          return (
                            <div key={e.name} style={{
                              borderRadius: 10,
                              marginBottom: 5,
                              padding: '8px 12px',
                              background: isMe
                                ? 'linear-gradient(135deg,rgba(61,214,195,0.18),rgba(110,231,249,0.1))'
                                : 'rgba(255,255,255,0.05)',
                              border: `1px solid ${isMe ? 'rgba(61,214,195,0.3)' : 'rgba(255,255,255,0.08)'}`,
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                                <span style={{ fontWeight: 800, fontSize: 13, color: isMe ? '#6ee7f9' : '#cbd5e1' }}>{e.name.split(' ')[0]}</span>
                                {isMe && <span style={{ fontSize: 9, fontWeight: 700, color: '#3dd6c3', background: 'rgba(61,214,195,0.15)', borderRadius: 4, padding: '1px 5px', textTransform: 'uppercase', letterSpacing: 0.5 }}>Me</span>}
                              </div>
                              <div style={{ marginTop: 4, paddingLeft: 16 }}>
                                <div style={{ fontSize: 13, color: e.val === 'vacation' ? '#f59e0b' : e.val === 'off' ? '#94a3b8' : '#e2e8f0', fontWeight: 600 }}>{shift}</div>
                                {lunch && (
                                  <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 2 }}>🍽 Lunch {lunch}</div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
