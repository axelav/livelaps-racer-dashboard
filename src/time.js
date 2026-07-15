// Parse "M:SS" or "H:MM:SS" to seconds; blank/&nbsp;/garbage -> null.
export function parseClock(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/ /g, " ").trim();
  const match = trimmed.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const [, h, m, s] = match;
  return (h ? Number(h) * 3600 : 0) + Number(m) * 60 + Number(s);
}

// Seconds -> "H:MM:SS" (hours always present, so livelaps parseDuration accepts it).
export function formatHMS(totalSeconds) {
  const rounded = Math.round(totalSeconds);
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(s)}`;
}
