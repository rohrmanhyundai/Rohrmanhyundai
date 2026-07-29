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
