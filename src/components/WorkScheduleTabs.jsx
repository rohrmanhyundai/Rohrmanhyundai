import React, { useState } from 'react';
import WorkSchedule from './WorkSchedule';
import MobileSchedule from './MobileSchedule';

/* One Work Schedule page for both rosters.
 *
 * The advisor and technician schedules used to be two separate tiles on every
 * hub, which meant a tech who wanted to see when an advisor works had to back
 * out and hunt for the other tile. They are the same calendar over a different
 * roster, so they live on one page behind two tabs.
 *
 * Which tab opens first follows WHO is looking: a technician lands on the tech
 * schedule, an advisor on the advisor schedule — whichever list their own name
 * is on. The other is always one click away.
 *
 * The month state lives inside WorkSchedule/MobileSchedule and those are NOT
 * remounted when the tab changes, so switching rosters keeps you on the month
 * you were already reading.
 */
export default function WorkScheduleTabs({
  schedules = {},
  advisorNames = [],
  techNames = [],
  currentUser = '',
  currentRole,
  jobRole,
  isPhone = false,
  initialTab,
  showAdvisor = true,
  showTech = true,
  onBack,
  backLabel,
}) {
  const TABS = [
    showAdvisor && { key: 'advisor', label: 'Advisor Work Schedule',    short: 'Advisor',    title: 'Advisor Schedule', names: advisorNames },
    showTech    && { key: 'tech',    label: 'Technician Work Schedule', short: 'Technician', title: 'Tech Schedule',    names: techNames },
  ].filter(Boolean);

  const me = (currentUser || '').toUpperCase();

  function defaultTab() {
    const keys = TABS.map(t => t.key);
    if (initialTab && keys.includes(initialTab)) return initialTab;
    // Your own roster wins — it is the one you opened this page to read.
    if (keys.includes('tech') && techNames.includes(me)) return 'tech';
    if (keys.includes('advisor') && advisorNames.includes(me)) return 'advisor';
    // Not on either list (a new hire, parts, warranty): fall back to job title.
    if (keys.includes('tech') && jobRole === 'technician') return 'tech';
    return keys[0];
  }

  const [active, setActive] = useState(defaultTab);
  const current = TABS.find(t => t.key === active) || TABS[0];
  if (!current) return null;

  // A single permitted roster needs no tab bar — it would be one dead button.
  const tabs = TABS.length < 2 ? null : (
    <div
      className="adv-advisor-tabs no-print"
      style={isPhone
        ? { padding: '10px 0 2px', justifyContent: 'center', gap: 6, background: 'transparent', border: 'none' }
        : { justifyContent: 'center' }}
    >
      {TABS.map(t => (
        <button
          key={t.key}
          className={`adv-advisor-tab${t.key === active ? ' adv-advisor-tab--active' : ''}`}
          onClick={() => setActive(t.key)}
          style={isPhone ? { padding: '7px 16px', fontSize: 13 } : undefined}
        >
          {isPhone ? t.short : t.label}
        </button>
      ))}
    </div>
  );

  if (isPhone) {
    return (
      <MobileSchedule
        schedules={schedules}
        employeeNames={current.names}
        currentUser={me}
        title={current.title}
        tabs={tabs}
        onBack={onBack}
      />
    );
  }

  return (
    <WorkSchedule
      schedules={schedules}
      employeeNames={current.names}
      currentUser={me}
      currentRole={currentRole}
      title={current.title}
      tabs={tabs}
      onBack={onBack}
      backLabel={backLabel}
    />
  );
}
