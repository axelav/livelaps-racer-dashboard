export function normalizeRacerName(name) {
  return name
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLocaleLowerCase();
}

export const toPercentile = (position, size) =>
  Number.isFinite(position) && Number.isFinite(size) && size > 0
    ? Math.round((1 - (position - 1) / size) * 100)
    : null;

export function buildRacerHistory(entries) {
  const races = entries.map((entry) => ({
    sourceRaceId: entry.sourceRaceId,
    raceName: entry.raceName,
    eventDate: entry.eventDate,
    eventDateProvenance: entry.eventDateProvenance,
    provider: entry.provider,
    fullName: entry.fullName,
    overallPosition: entry.overallPosition,
    fieldSize: entry.fieldSize,
    overallPercentile: toPercentile(entry.overallPosition, entry.fieldSize),
    classPosition: entry.classPosition,
    classSize: entry.classSize,
    classPercentile: toPercentile(entry.classPosition, entry.classSize),
    totalTimeSeconds: entry.totalTimeSeconds
  }));

  return {
    racerName: entries[0]?.fullName ?? null,
    races,
    trends: {
      overallPercentiles: races.map(({ overallPercentile }) => overallPercentile),
      classPercentiles: races.map(({ classPercentile }) => classPercentile)
    }
  };
}
