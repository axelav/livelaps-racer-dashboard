export function normalizeRacerName(name) {
  return name
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLocaleLowerCase();
}

export const toPercentile = (position, size) => {
  if (!Number.isFinite(position) || !Number.isFinite(size) || size <= 0) return null;
  const percentile = Math.round((1 - (position - 1) / size) * 100);
  return Math.max(0, Math.min(100, percentile));
};
export function buildRacerHistory(entries) {
  const races = entries.map((entry) => {
    const timedDnf = entry.provider === 'mototally' && entry.totalTimeSeconds == null && entry.entry?.scoring !== 'points';
    const pointsDnf =
      entry.provider === 'mototally' &&
      entry.entry?.scoring === 'points' &&
      entry.entry.maxChk < entry.entry.checkCount;
    const dnf = timedDnf || pointsDnf;
    return {
      sourceRaceId: entry.sourceRaceId,
      raceName: entry.raceName,
      eventDate: entry.eventDate,
      eventDateProvenance: entry.eventDateProvenance,
      provider: entry.provider,
      fullName: entry.fullName,
      overallPosition: entry.overallPosition,
      fieldSize: entry.fieldSize,
      overallPercentile: dnf ? null : toPercentile(entry.overallPosition, entry.fieldSize),
      classPosition: entry.classPosition,
      classSize: entry.classSize,
      classPercentile: dnf ? null : toPercentile(entry.classPosition, entry.classSize),
      totalTimeSeconds: entry.totalTimeSeconds,
      totalPoints: entry.entry?.totalPoints ?? null
    };
  });

  return {
    racerName: entries[0]?.fullName ?? null,
    races,
    trends: {
      overallPercentiles: races.map(({ overallPercentile }) => overallPercentile),
      classPercentiles: races.map(({ classPercentile }) => classPercentile)
    }
  };
}
