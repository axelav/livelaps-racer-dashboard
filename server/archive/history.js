export function normalizeRacerName(name) {
  return name
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLocaleLowerCase();
}

export const toPercentile = (position, size) =>
  size ? Math.round((1 - (position - 1) / size) * 100) : null;
