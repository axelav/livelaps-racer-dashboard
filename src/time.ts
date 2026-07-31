// Parse "M:SS", "M:SS.s", or "H:MM:SS.s" to seconds; blank/&nbsp;/garbage -> null.
export function parseClock(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/ /g, ' ').trim();
  const match = trimmed.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d+))?$/);
  if (!match) return null;
  const [, h, m, s, fraction] = match;
  const fractionalSeconds = fraction ? Number(`0.${fraction}`) : 0;
  return (h ? Number(h) * 3600 : 0) + Number(m) * 60 + Number(s) + fractionalSeconds;
}

// Seconds -> "H:MM:SS", retaining requested source precision when applicable.
export function formatHMS(totalSeconds: number, fractionDigits = 0): string {
  const scale = 10 ** fractionDigits;
  const roundedUnits = Math.round((totalSeconds + Number.EPSILON) * scale);
  const hourUnits = 3600 * scale;
  const minuteUnits = 60 * scale;
  const h = Math.floor(roundedUnits / hourUnits);
  const afterHours = roundedUnits - h * hourUnits;
  const m = Math.floor(afterHours / minuteUnits);
  const secondUnits = afterHours - m * minuteUnits;
  const s = Math.floor(secondUnits / scale);
  const fraction = secondUnits - s * scale;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(s)}${fractionDigits ? `.${String(fraction).padStart(fractionDigits, '0')}` : ''}`;
}
