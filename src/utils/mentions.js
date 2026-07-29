// Detect an @mention of a specific user inside a chat message.
// Matches "@jordan" (case-insensitive) as a whole token: it must start at the
// beginning or after a non-word char, and not run straight into more word
// characters — so "@jordan", "@jordan!", "@jordan, update" all match, but
// "@jordans" and "email@jordan" do not.
export function isMentioned(text, username) {
  if (!text || !username) return false;
  const esc = String(username).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!esc) return false;
  try {
    return new RegExp(`(^|[^\\w@])@${esc}(?![\\w])`, 'i').test(String(text));
  } catch {
    return false;
  }
}

// True if the message @-mentions this user by name OR by their role group.
// Group tags: @tech → technicians, @advisor → advisors (incl. lead advisor),
// @part / @parts → parts. Each recipient checks against their own role.
export function mentionsUser(text, username, role) {
  if (isMentioned(text, username)) return true;
  const r = (role || '').toLowerCase();
  const tags = [];
  if (r.includes('technician')) tags.push('tech', 'techs', 'technician', 'technicians');
  if (r.includes('advisor'))    tags.push('advisor', 'advisors');
  if (r.includes('part'))       tags.push('part', 'parts');
  return tags.some(t => isMentioned(text, t));
}
