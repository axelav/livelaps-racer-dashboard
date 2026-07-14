const RACE_ID_PATTERNS = [/race\/results\/(\d+)/, /race\/filters\/(\d+)/, /race\/config\/(\d+)/, /race\/(\d+)/];
const EVENT_ID_PATTERN = /eventScores\/(\d+)/;

export function parseRaceId(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const eventMatch = trimmed.match(EVENT_ID_PATTERN);
  if (eventMatch) return { id: Number(eventMatch[1]), isEvent: true };

  for (const pattern of RACE_ID_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) return { id: Number(match[1]), isEvent: false };
  }

  if (/^\d+$/.test(trimmed)) return { id: Number(trimmed), isEvent: false };

  return null;
}

export function parseDuration(value) {
  if (!value) return 0;
  const match = value.match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!match) return 0;
  const [, hours, minutes, seconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

export function formatDuration(totalSeconds) {
  const rounded = Math.round(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
