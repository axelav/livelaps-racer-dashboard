import { parseRaceId } from '../../src/livelaps.js';
import { isMotoTallyUrl, parseMotoTallyUrl } from '../../src/mototally.js';

const LIVELAPS_HOSTS: Record<string, true> = { 'livelaps.com': true, 'www.livelaps.com': true };
const MOTOTALLY_HOSTS: Record<string, true> = { 'moto-tally.com': true, 'www.moto-tally.com': true };
const LIVELAPS_RACE_PATH =
  /^\/(?:laravel\/public\/api\/v1\/livelaps\/)?race\/(?:results|filters|config)\/\d+\/?$|^\/livelaps\/race\/\d+\/?$/i;
const LIVELAPS_EVENT_PATH = /^\/livelaps\/eventScores\/\d+\/?$/i;
const MOTOTALLY_RESULTS_PATH =
  /^\/[^/]+\/[^/]+\/Results\.aspx\/\d+\/\d+\/[OC]\d+\/[A-Za-z]+\/?$/i;

export type MotoTallyDescriptor = {
  org: string;
  discipline: string;
  year: string;
  round: string;
  group: string;
  view: string;
};

export type LiveLapsRaceInput = {
  provider: 'livelaps';
  inputKind: 'race';
  sourceRaceId: string;
  canonicalUrl: string;
};

export type LiveLapsEventInput = {
  provider: 'livelaps';
  inputKind: 'event';
  eventId: string;
  canonicalUrl: string;
};

export type MotoTallyRaceInput = {
  provider: 'mototally';
  inputKind: 'race';
  sourceRaceId: string;
  canonicalUrl: string;
  descriptor: MotoTallyDescriptor;
};

export type LiveLapsSourceInput = LiveLapsRaceInput | LiveLapsEventInput;
export type CanonicalSourceInput = LiveLapsSourceInput | MotoTallyRaceInput;

type ParsedRaceId = {
  id: string | number;
  isEvent: boolean;
};

function unsupportedInput(): never {
  throw new Error('Only supported LiveLaps and Moto-Tally race inputs can be archived.');
}

function parsedRaceId(value: unknown): ParsedRaceId | null {
  if (typeof value !== 'object' || value == null) return null;
  const candidate = value as { id?: unknown; isEvent?: unknown };
  if ((typeof candidate.id !== 'string' && typeof candidate.id !== 'number') || typeof candidate.isEvent !== 'boolean') {
    return null;
  }
  return { id: candidate.id, isEvent: candidate.isEvent };
}

function motoTallyDescriptor(value: unknown): MotoTallyDescriptor {
  if (typeof value !== 'object' || value == null) unsupportedInput();
  const candidate = value as Partial<Record<keyof MotoTallyDescriptor, unknown>>;
  const { org, discipline, year, round, group, view } = candidate;
  if (
    typeof org !== 'string' ||
    typeof discipline !== 'string' ||
    typeof year !== 'string' ||
    typeof round !== 'string' ||
    typeof group !== 'string' ||
    typeof view !== 'string'
  ) {
    unsupportedInput();
  }
  return { org, discipline, year, round, group, view };
}

export function canonicalizeSourceInput(input: unknown): CanonicalSourceInput {
  if (typeof input !== 'string' || !input.trim()) unsupportedInput();

  const trimmed = input.trim();
  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    if (!/^\d+$/.test(trimmed)) unsupportedInput();

    const parsed = parsedRaceId(parseRaceId(trimmed));
    if (!parsed) unsupportedInput();

    return {
      provider: 'livelaps',
      inputKind: 'race',
      sourceRaceId: String(parsed.id),
      canonicalUrl: `https://www.livelaps.com/livelaps/race/${parsed.id}`
    };
  }

  if (LIVELAPS_HOSTS[url.hostname.toLowerCase()]) {
    if (!LIVELAPS_RACE_PATH.test(url.pathname) && !LIVELAPS_EVENT_PATH.test(url.pathname)) {
      unsupportedInput();
    }

    const parsed = parsedRaceId(parseRaceId(url.pathname));
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
    MOTOTALLY_HOSTS[url.hostname.toLowerCase()] &&
    MOTOTALLY_RESULTS_PATH.test(url.pathname) &&
    isMotoTallyUrl(providerUrl)
  ) {
    const descriptor = motoTallyDescriptor(parseMotoTallyUrl(providerUrl));
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
