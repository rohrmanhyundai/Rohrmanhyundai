// Certified YES/NO + Training count beside a name on the TV dashboard — what
// the old Training Center ticker showed, now on each person's own box.
import React from 'react';
import { badgeCls } from '../utils/formatters';

export default function TrainingBadge({ p }) {
  if (!p) return null;
  const cert = p.certified || '\u2014';
  const due = p.trainings_due || '\u2014';
  return (
    <span className="tvd-train">
      <span className={`badge ${badgeCls(cert)}`}>{cert}</span>
      <span className="lbl">Training</span>
      <span className="badge neutral">{due}</span>
    </span>
  );
}
