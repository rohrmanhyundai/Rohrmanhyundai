import React, { useState } from 'react';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

export default function MobileSchedule({ schedules, employeeNames, currentUser, onBack }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  function prevMonth() { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); }
  function nextMonth() { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); }

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const dow = new Date(year, month, day).getDay();
    const isToday = dateStr === todayStr;
    const isHoliday = schedules['__HOLIDAY__']?.[dateStr] === 'holiday';
    const entries = isHoliday ? [] : employeeNames
      .map(name => ({ name, val: schedules[name]?.[dateStr] }))
      .filter(e => e.val);
    const myEntry = entries.find(e => e.name.toUpperCase() === currentUser);
    return { day, dateStr, dow, isToday, isHoliday, entries, myEntry };
  });

  return (
    <div style={{ minHeight: '100vh', background: '#0d1627', color: '#e2e8f0', fontFamily: 'Inter, sans-serif', paddingBottom: 40 }}>

      {/* Header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#0d1627', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#e2e8f0', borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}>← Back</button>
        <span style={{ fontWeight: 700, fontSize: 16, color: '#6ee7f9', flex: 1 }}>Work Schedule</span>
      </div>

      {/* Month nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px 8px' }}>
        <button onClick={prevMonth} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#e2e8f0', borderRadius: 8, padding: '6px 14px', fontSize: 18, cursor: 'pointer' }}>‹</button>
        <span style={{ fontWeight: 800, fontSize: 20, color: '#e2e8f0' }}>{MONTHS[month]} {year}</span>
        <button onClick={nextMonth} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#e2e8f0', borderRadius: 8, padding: '6px 14px', fontSize: 18, cursor: 'pointer' }}>›</button>
      </div>

      {/* Day list */}
      <div style={{ padding: '4px 12px 0' }}>
        {days.map(({ day, dateStr, dow, isToday, isHoliday, entries, myEntry }) => {
          const hasContent = isHoliday || entries.length > 0;
          return (
            <div key={day} style={{
              marginBottom: 6,
              borderRadius: 12,
              background: isHoliday ? 'rgba(239,68,68,0.1)' : isToday ? 'rgba(61,214,195,0.1)' : myEntry ? 'rgba(61,214,195,0.05)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${isHoliday ? 'rgba(239,68,68,0.35)' : isToday ? 'rgba(61,214,195,0.45)' : myEntry ? 'rgba(61,214,195,0.2)' : 'rgba(255,255,255,0.07)'}`,
              padding: '8px 12px',
              display: 'flex',
              alignItems: hasContent ? 'flex-start' : 'center',
              gap: 10,
            }}>
              {/* Date badge */}
              <div style={{
                width: 42, flexShrink: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                background: isToday ? 'rgba(61,214,195,0.2)' : 'rgba(255,255,255,0.06)',
                borderRadius: 8, padding: '4px 0',
              }}>
                <span style={{ fontSize: 9, color: '#7a92b8', textTransform: 'uppercase', fontWeight: 600 }}>{DAY_NAMES[dow]}</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: isHoliday ? '#ef4444' : isToday ? '#3dd6c3' : '#e2e8f0', lineHeight: 1.1 }}>{day}</span>
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {isHoliday && (
                  <div style={{ fontSize: 13, color: '#ef4444', fontWeight: 700, paddingTop: 4 }}>🎉 Holiday</div>
                )}
                {!hasContent && (
                  <span style={{ fontSize: 12, color: '#374151' }}>—</span>
                )}
                {entries.map(e => {
                  const isMe = e.name.toUpperCase() === currentUser;
                  const parts = e.val !== 'vacation' && e.val !== 'off' ? e.val.split(' | ') : null;
                  const shift = parts ? parts[0] : (e.val === 'vacation' ? 'Vacation' : 'Off');
                  const lunch = parts?.[1]?.replace('Lunch ', '');
                  return (
                    <div key={e.name} style={{
                      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5,
                      background: isMe ? 'rgba(61,214,195,0.14)' : 'rgba(255,255,255,0.06)',
                      border: `1px solid ${isMe ? 'rgba(61,214,195,0.3)' : 'rgba(255,255,255,0.08)'}`,
                      borderRadius: 7, padding: '4px 8px', marginBottom: 4,
                    }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: isMe ? '#6ee7f9' : '#c8d8f0', whiteSpace: 'nowrap' }}>{e.name.split(' ')[0]}</span>
                      <span style={{ fontSize: 11, color: e.val === 'vacation' ? '#f59e0b' : e.val === 'off' ? '#94a3b8' : '#3dd6c3', whiteSpace: 'nowrap' }}>{shift}</span>
                      {lunch && <span style={{ fontSize: 10, color: '#f59e0b', whiteSpace: 'nowrap' }}>🍽 {lunch}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
