import * as livelaps from './livelaps.js';
import * as mototally from './mototally.js';
import type { NormalizedRace } from './domain.js';

export {
  deriveTotals,
  parseRaceId,
  UnparseableInputError,
  MultiRaceEventError,
  UnsupportedFormatError
} from './livelaps.js';

type LoadedProviderRace = NormalizedRace & {
  raceId: string | number;
};

export function resolveAndLoadRace(input: unknown): Promise<LoadedProviderRace> {
  if (mototally.isMotoTallyUrl(input)) return mototally.resolveAndLoadRace(input);
  return livelaps.resolveAndLoadRace(input);
}

export function loadRaceById(raceId: string | number): Promise<LoadedProviderRace> {
  if (typeof raceId === 'string' && raceId.startsWith('mototally:')) {
    return mototally.loadRaceById(raceId);
  }
  return livelaps.loadRaceById(raceId);
}
