import { parseRaceId } from '../../src/livelaps.js';
import { isMotoTallyUrl, parseMotoTallyUrl } from '../../src/mototally.js';

const LIVELAPS_HOSTS = new Set(['livelaps.com', 'www.livelaps.com']);
const MOTOTALLY_HOSTS = new Set(['moto-tally.com', 'www.moto-tally.com']);

function unsupportedInput() {
  throw new Error('Only supported LiveLaps and Moto-Tally race inputs can be archived.');
}

export function canonicalizeSourceInput(input) {
  if (typeof input !== 'string' || !input.trim()) unsupportedInput();

  const trimmed = input.trim();
  let url;

  try {
    url = new URL(trimmed);
  } catch {
    const parsed = parseRaceId(trimmed);
    if (!parsed) unsupportedInput();

    return {
      provider: 'livelaps',
      sourceRaceId: String(parsed.id),
      canonicalUrl: `https://www.livelaps.com/livelaps/race/${parsed.id}`
    };
  }

  if (LIVELAPS_HOSTS.has(url.hostname.toLowerCase())) {
    const parsed = parseRaceId(trimmed);
    if (!parsed) unsupportedInput();

    return {
      provider: 'livelaps',
      sourceRaceId: String(parsed.id),
      canonicalUrl: `https://www.livelaps.com/livelaps/race/${parsed.id}`
    };
  }

  if (MOTOTALLY_HOSTS.has(url.hostname.toLowerCase()) && isMotoTallyUrl(trimmed)) {
    const descriptor = parseMotoTallyUrl(trimmed);
    const { org, discipline, year, round, group, view } = descriptor;

    return {
      provider: 'mototally',
      sourceRaceId: `${org}/${discipline}/${year}/${round}/${group}`,
      canonicalUrl: `https://www.moto-tally.com/${org}/${discipline}/Results.aspx/${year}/${round}/${group}/${view}`,
      descriptor
    };
  }

  unsupportedInput();
}
