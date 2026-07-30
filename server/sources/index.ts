import type { LoadedRace, SourceRace } from '../../src/domain.js';
import { canonicalizeSourceInput } from './input.js';
import { loadLiveLaps } from './livelaps.js';
import { loadMotoTally } from './mototally.js';

export type SourceResponse = {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
};

export type FetchLike = (url: string) => Promise<SourceResponse>;
export type ParseHtml = (html: string) => Document;

export type SourceDependencies = {
  fetchImpl: FetchLike;
  parseHtml?: ParseHtml;
};

export type MotoTallySourceDependencies = SourceDependencies & {
  parseHtml: ParseHtml;
};

export type SourceLoader = {
  load(input: unknown): Promise<LoadedRace>;
  refresh(sourceRace: SourceRace): Promise<LoadedRace>;
};

export function createSources(deps: SourceDependencies): SourceLoader {
  return {
    load(input: unknown): Promise<LoadedRace> {
      const source = canonicalizeSourceInput(input);
      return source.provider === 'mototally'
        ? loadMotoTally(source, deps as MotoTallySourceDependencies)
        : loadLiveLaps(source, deps);
    },
    refresh(sourceRace: SourceRace): Promise<LoadedRace> {
      return this.load(sourceRace.canonicalUrl);
    }
  };
}
