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
function resultStatusFor(entry) {
  if (entry.provider !== 'mototally') return { status: 'finished', note: null };

  const source = entry.entry ?? {};
  if (source.scoring === 'points') {
    if (source.totalPoints == null) return { status: 'no_result', note: 'No final result' };
    if (Number.isFinite(source.maxChk) && Number.isFinite(source.checkCount) && source.maxChk < source.checkCount) {
      return { status: 'official_dnf', note: `DNF after ${source.maxChk} of ${source.checkCount} checks` };
    }
    return { status: 'finished', note: null };
  }

  if (entry.totalTimeSeconds == null) return { status: 'no_result', note: 'No final result' };
  return { status: 'finished', note: null };
}

export function buildRacerHistory(entries) {
  const races = entries.map((entry) => {
    const resultStatus = resultStatusFor(entry);
    const hasPercentile = resultStatus.status !== 'no_result';
    return {
      sourceRaceId: entry.sourceRaceId,
      raceName: entry.raceName,
      eventDate: entry.eventDate,
      eventDateProvenance: entry.eventDateProvenance,
      provider: entry.provider,
      fullName: entry.fullName,
      overallPosition: entry.overallPosition,
      fieldSize: entry.fieldSize,
      overallPercentile: hasPercentile ? toPercentile(entry.overallPosition, entry.fieldSize) : null,
      classPosition: entry.classPosition,
      classSize: entry.classSize,
      classPercentile: hasPercentile ? toPercentile(entry.classPosition, entry.classSize) : null,
      totalTimeSeconds: entry.totalTimeSeconds,
      totalPoints: entry.entry?.totalPoints ?? null,
      resultStatus: resultStatus.status,
      resultNote: resultStatus.note
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
