import { canonicalizeSourceInput } from './input.js';
import { loadLiveLaps } from './livelaps.js';
import { loadMotoTally } from './mototally.js';

export function createSources(deps) {
  return {
    load(input) {
      const source = canonicalizeSourceInput(input);
      return source.provider === 'mototally'
        ? loadMotoTally(source, deps)
        : loadLiveLaps(source, deps);
    },
    refresh(sourceRace) {
      return this.load(sourceRace.canonicalUrl);
    }
  };
}
