import { normalizeRacerName } from './history.js';

export const COMPARISON_SLOT_COUNT = 5;

function slotParamName(slot) {
  return `compare${slot + 1}`;
}

function normalizeSlotValue(value) {
  if (value == null) return null;
  const normalized = normalizeRacerName(value);
  return normalized || null;
}

export function comparisonSetFromParams(params) {
  return Array.from({ length: COMPARISON_SLOT_COUNT }, (_, slot) =>
    normalizeSlotValue(params.get(slotParamName(slot)))
  );
}

export function writeComparisonSet(params, comparisonSet) {
  for (let slot = 0; slot < COMPARISON_SLOT_COUNT; slot += 1) {
    const param = slotParamName(slot);
    const value = normalizeSlotValue(comparisonSet[slot]);
    if (value) params.set(param, value);
    else params.delete(param);
  }
  return params;
}

export function removeComparisonSlot(params, slot) {
  if (slot < 0 || slot >= COMPARISON_SLOT_COUNT) return params;
  params.delete(slotParamName(slot));
  return params;
}

export function addComparisonRider(params, riderName, anchorName) {
  const rider = normalizeSlotValue(riderName);
  const anchor = normalizeSlotValue(anchorName);
  if (!rider) return { added: false, slot: null, reason: 'empty' };
  if (rider === anchor) return { added: false, slot: null, reason: 'self' };

  const comparisonSet = comparisonSetFromParams(params);
  if (comparisonSet.includes(rider)) return { added: false, slot: null, reason: 'duplicate' };

  const slot = comparisonSet.findIndex((value) => value == null);
  if (slot === -1) return { added: false, slot: null, reason: 'full' };

  params.set(slotParamName(slot), rider);
  return { added: true, slot, reason: null };
}
