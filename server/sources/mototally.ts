import type { LoadedRace, RaceEntry, RaceMeta, SourceRace } from '../../src/domain.js';
import {
  deriveStandings,
  parseAmaSet,
  parseCalendarMetadata,
  parseOverallOptions,
  parseResults,
  pickContainingGroup,
  raceDisplayName,
  sanitizeHtml
} from '../../src/mototally.js';
import type { MotoTallySourceDependencies, SourceResponse } from './index.js';
import type { MotoTallyDescriptor, MotoTallyRaceInput } from './input.js';

const BASE_URL = 'https://www.moto-tally.com/';

type MotoTallyPage = {
  text: string;
  doc: Document;
};

type ResolvedMotoTallyPage = MotoTallyPage & {
  descriptor: MotoTallyDescriptor;
};

type OverallPageSummary = {
  group: string;
  amaSet: Set<string>;
  page: MotoTallyPage;
};

type CalendarMetadata = Pick<SourceRace, 'eventDate' | 'location' | 'organizer'>;

function resultsPath({ org, discipline, year, round, group }: MotoTallyDescriptor, view = 'CS'): string {
  return `${org}/${discipline}/Results.aspx/${year}/${round}/${group}/${view}`;
}

function resultsUrl(descriptor: MotoTallyDescriptor): string {
  return `${BASE_URL}${resultsPath(descriptor)}`;
}

async function responseText(response: SourceResponse): Promise<string> {
  if (typeof response.text !== 'function') throw new TypeError('Moto-Tally response is not text-readable.');
  return response.text();
}

async function fetchPage(url: string, { fetchImpl, parseHtml }: MotoTallySourceDependencies): Promise<MotoTallyPage> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Moto-Tally request failed: ${response.status} ${url}`);
  const text = await responseText(response);
  return { text, doc: parseHtml(sanitizeHtml(text)) };
}

async function resolveOverall(source: MotoTallyRaceInput, deps: MotoTallySourceDependencies): Promise<ResolvedMotoTallyPage> {
  const initial = await fetchPage(source.canonicalUrl, deps);
  if (source.descriptor.group.startsWith('O')) return { descriptor: source.descriptor, ...initial };

  const classAmas = parseAmaSet(initial.doc) as Set<string>;
  const overallGroups = parseOverallOptions(initial.doc) as string[];
  const overallPages: OverallPageSummary[] = await Promise.all(
    overallGroups.map(async (group: string) => {
      const page = await fetchPage(resultsUrl({ ...source.descriptor, group }), deps);
      return { group, amaSet: parseAmaSet(page.doc) as Set<string>, page };
    })
  );
  const selected = pickContainingGroup(overallPages, classAmas) as OverallPageSummary | null | undefined;
  return selected
    ? { descriptor: { ...source.descriptor, group: selected.group }, ...selected.page }
    : { descriptor: source.descriptor, ...initial };
}

async function calendarMetadata(
  descriptor: MotoTallyDescriptor,
  deps: MotoTallySourceDependencies
): Promise<CalendarMetadata> {
  try {
    const calendarUrl = `${BASE_URL}${descriptor.org}/${descriptor.discipline}/Results.aspx`;
    const { doc } = await fetchPage(calendarUrl, deps);
    return parseCalendarMetadata(doc, descriptor) as CalendarMetadata;
  } catch {
    return { eventDate: null, location: null, organizer: null };
  }
}

export async function loadMotoTally(source: MotoTallyRaceInput, deps: MotoTallySourceDependencies): Promise<LoadedRace> {
  const overall = await resolveOverall(source, deps);
  const raceMeta: RaceMeta = {
    raceName: raceDisplayName(overall.doc, overall.descriptor.group) as string,
    modeName: 'Enduro'
  };
  const metadata = await calendarMetadata(overall.descriptor, deps);
  const allResults = deriveStandings(parseResults(overall.doc)) as RaceEntry[];

  return {
    sourceRace: {
      provider: 'mototally',
      sourceRaceId: `${overall.descriptor.org}/${overall.descriptor.discipline}/${overall.descriptor.year}/${overall.descriptor.round}/${overall.descriptor.group}`,
      canonicalUrl: resultsUrl(overall.descriptor),
      raceName: raceMeta.raceName,
      modeName: raceMeta.modeName,
      ...metadata
    },
    normalized: { raceMeta, allResults },
    artifact: { mimeType: 'text/html', text: overall.text }
  };
}
