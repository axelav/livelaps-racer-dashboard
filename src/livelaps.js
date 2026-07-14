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
