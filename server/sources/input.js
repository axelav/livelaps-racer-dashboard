import { parseRaceId } from '../../src/livelaps.js';
import { isMotoTallyUrl, parseMotoTallyUrl } from '../../src/mototally.js';

const LIVELAPS_HOSTS = new Set(['livelaps.com', 'www.livelaps.com']);
const MOTOTALLY_HOSTS = new Set(['moto-tally.com', 'www.moto-tally.com']);
const LIVELAPS_RACE_PATH =
  /^\/(?:laravel\/public\/api\/v1\/livelaps\/)?race\/(?:results|filters|config)\/\d+\/?$|^\/livelaps\/race\/\d+\/?$/i;
const LIVELAPS_EVENT_PATH = /^\/livelaps\/eventScores\/\d+\/?$/i;
const MOTOTALLY_RESULTS_PATH =
  /^\/[^/]+\/[^/]+\/Results\.aspx\/\d+\/\d+\/[OC]\d+\/[A-Za-z]+\/?$/i;

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
    if (!/^\d+$/.test(trimmed)) unsupportedInput();

    const parsed = parseRaceId(trimmed);
    if (!parsed) unsupportedInput();

    return {
      provider: 'livelaps',
      inputKind: 'race',
      sourceRaceId: String(parsed.id),
      canonicalUrl: `https://www.livelaps.com/livelaps/race/${parsed.id}`
    };
  }

  if (LIVELAPS_HOSTS.has(url.hostname.toLowerCase())) {
    if (!LIVELAPS_RACE_PATH.test(url.pathname) && !LIVELAPS_EVENT_PATH.test(url.pathname)) {
      unsupportedInput();
    }

    const parsed = parseRaceId(url.pathname);
    if (!parsed) unsupportedInput();

    if (parsed.isEvent) {
      return {
        provider: 'livelaps',
        inputKind: 'event',
        eventId: String(parsed.id),
        canonicalUrl: `https://www.livelaps.com/livelaps/eventScores/${parsed.id}`
      };
    }

    return {
      provider: 'livelaps',
      inputKind: 'race',
      sourceRaceId: String(parsed.id),
      canonicalUrl: `https://www.livelaps.com/livelaps/race/${parsed.id}`
    };
  }

  const providerUrl = `${url.origin}${url.pathname}`;
  if (
    MOTOTALLY_HOSTS.has(url.hostname.toLowerCase()) &&
    MOTOTALLY_RESULTS_PATH.test(url.pathname) &&
    isMotoTallyUrl(providerUrl)
  ) {
    const descriptor = parseMotoTallyUrl(providerUrl);
    const { org, discipline, year, round, group, view } = descriptor;

    return {
      provider: 'mototally',
      inputKind: 'race',
      sourceRaceId: `${org}/${discipline}/${year}/${round}/${group}`,
      canonicalUrl: `https://www.moto-tally.com/${org}/${discipline}/Results.aspx/${year}/${round}/${group}/${view}`,
      descriptor
    };
  }

  unsupportedInput();
}
