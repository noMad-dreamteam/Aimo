/** Russian number agreement shared by the rule coach, UI and model prompts. */
export function pluralize(n, forms) {
  const value = Math.abs(Math.round(n));
  const mod10 = value % 10, mod100 = value % 100;
  const index = mod10 === 1 && mod100 !== 11 ? 0 : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 1 : 2;
  return `${n} ${forms[index]}`;
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).map(part => part[0].toUpperCase()).join('') : '?';
}
