// Part-day time off — someone coming in late, leaving early, or out for an
// appointment. Entered on the Vacation list as a row with kind: 'partial'.
//
//   { kind: 'partial', name, status, partialDate: 'YYYY-MM-DD',
//     timeFrom: 'HH:MM', timeTo: 'HH:MM', reason, note, dates }
//
// It is a heads-up only: a partial row has no dateStart/dateEnd, so nothing
// that counts vacation days (schedule sync, tech PTO hours, weekly snapshots,
// advisor pacing) ever sees it — no hours, no pay, no reporting change.
// It shows on the Work Schedule, the Vacation ticker and The Daily Wrench.

export const PARTIAL_REASONS = ['Coming in late', 'Leaving early', 'Appointment', 'Other'];

export const isPartial = (v) => !!v && v.kind === 'partial';

// "08:00" → "8am", "13:30" → "1:30pm"
export function fmtTime(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return '';
  const h = Number(m[1]), mm = m[2];
  const ap = h >= 12 ? 'pm' : 'am';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}${mm !== '00' ? ':' + mm : ''}${ap}`;
}

export function fmtTimeRange(from, to) {
  const a = fmtTime(from), b = fmtTime(to);
  if (a && b) return `${a}–${b}`;
  return a ? `from ${a}` : b ? `until ${b}` : '';
}

// The line shown on the ticker / phone list, e.g. "Oct 14 · In late 8am–10am".
export function partialLabel(v) {
  if (!v) return '';
  let day = '';
  if (v.partialDate) {
    const d = new Date(v.partialDate + 'T00:00:00');
    day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  const short = { 'Coming in late': 'In late', 'Leaving early': 'Leaving early', Appointment: 'Appointment', Other: 'Out' }[v.reason] || 'Out';
  return [day, [short, fmtTimeRange(v.timeFrom, v.timeTo)].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
}

const first = (s) => String(s || '').trim().split(/\s+/)[0].toUpperCase();

// Approved part-day rows for one person on one date.
export function partialOutFor(vacations, name, dateStr) {
  const f = first(name);
  return (vacations || []).filter(v => isPartial(v) && v.partialDate === dateStr && first(v.name) === f
    && String(v.status || 'APPROVED').toUpperCase() === 'APPROVED');
}

// Everyone with an approved part-day on this date.
export function partialOutOn(vacations, dateStr) {
  return (vacations || []).filter(v => isPartial(v) && v.partialDate === dateStr && v.name && v.name !== '—'
    && String(v.status || 'APPROVED').toUpperCase() === 'APPROVED');
}
