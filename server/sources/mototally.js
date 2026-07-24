import {
  deriveStandings,
  parseAmaSet,
  parseCalendarMetadata,
  parseOverallOptions,
  parseRaceName,
  parseResults,
  pickContainingGroup,
  sanitizeHtml
} from '../../src/mototally.js';

const BASE_URL = 'https://www.moto-tally.com/';

function resultsPath({ org, discipline, year, round, group }, view = 'CS') {
  return `${org}/${discipline}/Results.aspx/${year}/${round}/${group}/${view}`;
}

function resultsUrl(descriptor) {
  return `${BASE_URL}${resultsPath(descriptor)}`;
}

async function fetchPage(url, { fetchImpl, parseHtml }) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Moto-Tally request failed: ${response.status} ${url}`);
  const text = await response.text();
  return { text, doc: parseHtml(sanitizeHtml(text)) };
}

async function resolveOverall(source, deps) {
  const initial = await fetchPage(source.canonicalUrl, deps);
  if (source.descriptor.group.startsWith('O')) return { descriptor: source.descriptor, ...initial };

  const classAmas = parseAmaSet(initial.doc);
  const overallPages = await Promise.all(
    parseOverallOptions(initial.doc).map(async (group) => {
      const page = await fetchPage(resultsUrl({ ...source.descriptor, group }), deps);
      return { group, amaSet: parseAmaSet(page.doc), page };
    })
  );
  const selected = pickContainingGroup(overallPages, classAmas);
  return selected
    ? { descriptor: { ...source.descriptor, group: selected.group }, ...selected.page }
    : { descriptor: source.descriptor, ...initial };
}

async function calendarMetadata(descriptor, deps) {
  try {
    const calendarUrl = `${BASE_URL}${descriptor.org}/${descriptor.discipline}/Results.aspx`;
    const { doc } = await fetchPage(calendarUrl, deps);
    return parseCalendarMetadata(doc, descriptor);
  } catch {
    return { eventDate: null, location: null, organizer: null };
  }
}

export async function loadMotoTally(source, deps) {
  const overall = await resolveOverall(source, deps);
  const raceMeta = { raceName: parseRaceName(overall.doc), modeName: 'Enduro' };
  const metadata = await calendarMetadata(overall.descriptor, deps);

  return {
    sourceRace: {
      provider: 'mototally',
      sourceRaceId: `${overall.descriptor.org}/${overall.descriptor.discipline}/${overall.descriptor.year}/${overall.descriptor.round}/${overall.descriptor.group}`,
      canonicalUrl: resultsUrl(overall.descriptor),
      raceName: raceMeta.raceName,
      modeName: raceMeta.modeName,
      ...metadata
    },
    normalized: { raceMeta, allResults: deriveStandings(parseResults(overall.doc)) },
    artifact: { mimeType: 'text/html', text: overall.text }
  };
}
