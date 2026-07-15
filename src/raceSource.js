import * as livelaps from './livelaps.js';
import * as mototally from './mototally.js';

export {
  deriveTotals,
  UnparseableInputError,
  MultiRaceEventError,
  UnsupportedFormatError
} from './livelaps.js';

export function resolveAndLoadRace(input) {
  if (mototally.isMotoTallyUrl(input)) return mototally.resolveAndLoadRace(input);
  return livelaps.resolveAndLoadRace(input);
}

export function loadRaceById(raceId) {
  if (typeof raceId === 'string' && raceId.startsWith('mototally:')) {
    return mototally.loadRaceById(raceId);
  }
  return livelaps.loadRaceById(raceId);
}
