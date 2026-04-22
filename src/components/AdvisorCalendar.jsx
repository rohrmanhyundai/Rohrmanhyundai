import React, { useState, useEffect } from 'react';
import { loadAdvisorNoteIndex } from '../utils/github';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function AdvisorCalendar({ ownAdvisor, viewingAdvisor, advisorList, onViewingChange, onSelectDay, onBack, onDocumentLibrary, refreshKey }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [noteDates, setNoteDates] = useState(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    loadAdvisorNoteIndex(viewingAdvisor).then(dates => {
      setNoteDates(new Set(dates));
      setLoading(false);
    });
  }, [viewingAdvisor, refreshKey]);

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const isViewingOwn = viewingAdvisor === ownAdvisor;

  return (
    <div className="adv-page">
      <div className="adv-topbar">
        <div>
          <div className="adv-title">Appointment Prep Calendar</div>
          <div className="adv-sub">
            {isViewingOwn ? `${viewingAdvisor} (My Calendar)` : `Viewing: ${viewingAdvisor}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onDocumentLibrary} style={{ background: 'linear-gradient(180deg,rgba(110,231,249,.25),rgba(61,214,195,.18))', borderColor: 'rgba(110,231,249,.35)' }}>
            📁 Document Library
          </button>
          <button
            onClick={() => window.open('https://dealerplateguy.github.io/Advisor-Rank-Board/', '_blank')}
            style={{ background: 'linear-gradient(180deg,rgba(251,191,36,.25),rgba(245,158,11,.18))', borderColor: 'rgba(251,191,36,.35)' }}
          >
            🏆 Advisor Rank Board
          </button>
          <button className="secondary" onClick={onBack}>← Service Operations Dashboard</button>
        </div>
      </div>

      {/* Advisor switcher tabs */}
      {advisorList.length > 0 && (
        <div className="adv-advisor-tabs">
          {advisorList.map(name => (
            <button
              key={name}
              className={`adv-advisor-tab${viewingAdvisor === name ? ' adv-advisor-tab--active' : ''}${name === ownAdvisor ? ' adv-advisor-tab--own' : ''}`}
              onClick={() => onViewingChange(name)}
            >
              {name}
              {name === ownAdvisor && <span className="adv-tab-mine"> (Mine)</span>}
            </button>
          ))}
        </div>
      )}

      <div className="adv-cal-wrap">
        <div className="adv-cal-nav">
          <button className="secondary adv-nav-btn" onClick={prevMonth}>‹</button>
          <span className="adv-cal-month">{MONTH_NAMES[month]} {year}</span>
          <button className="secondary adv-nav-btn" onClick={nextMonth}>›</button>
        </div>

        <div className="adv-cal-grid">
          {DAY_NAMES.map(d => (
            <div key={d} className="adv-cal-dayname">{d}</div>
          ))}
          {cells.map((d, i) => {
            if (!d) return <div key={`empty-${i}`} className="adv-cal-day adv-cal-empty" />;
            const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const isToday = dateStr === todayStr;
            const hasNotes = noteDates.has(dateStr);
            return (
              <div
                key={dateStr}
                className={`adv-cal-day${isToday ? ' adv-today' : ''}${hasNotes ? ' adv-has-notes' : ''}`}
                onClick={() => onSelectDay(dateStr)}
              >
                <span className="adv-day-num">{d}</span>
                {hasNotes && <span className="adv-note-dot" title="Notes saved" />}
              </div>
            );
          })}
        </div>

        {loading && <div className="adv-loading">Loading saved notes...</div>}
      </div>
    </div>
  );
}
