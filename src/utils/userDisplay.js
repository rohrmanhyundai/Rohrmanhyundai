// Returns a friendly display name like "Gaven L" — first name + last initial.
// Falls back to the username alone when the user has no lastName configured.
export function userDisplayName(username, users) {
  if (!username) return '';
  const u = (users || []).find(x => (x.username || '').toLowerCase() === username.toLowerCase());
  const last = (u?.lastName || '').trim();
  if (!last) return username;
  return `${username} ${last.charAt(0).toUpperCase()}`;
}
