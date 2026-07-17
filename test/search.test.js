// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { renderSearch } from '../src/search.js';

const race = {
  raceId: '79103',
  raceMeta: { raceName: 'Test Enduro' },
  allResults: [
    { id: 1, fullName: 'Avery Rider', displayedNumber: '42' },
    { id: 2, fullName: 'Blake Racer', displayedNumber: '8' }
  ]
};

describe('renderSearch with an already loaded race', () => {
  it('keeps race data available for selecting another racer without a new lookup', () => {
    const container = document.createElement('div');
    const onSelect = vi.fn();

    renderSearch(container, { race, onSelect });

    expect(container.querySelector('[data-slot="raceForm"]').hidden).toBe(true);
    expect(container.querySelector('[data-slot="participantSection"]').hidden).toBe(false);

    const participantInput = container.querySelector('[data-slot="participantInput"]');
    participantInput.value = '42';
    participantInput.dispatchEvent(new Event('input'));
    container.querySelector('.participant-list button').click();

    expect(onSelect).toHaveBeenCalledWith('79103', 1, race);
  });

  it('requires an explicit action before showing the race replacement form', () => {
    const container = document.createElement('div');

    renderSearch(container, { race, onSelect: vi.fn() });
    container.querySelector('[data-slot="changeRace"]').click();

    expect(container.querySelector('[data-slot="raceForm"]').hidden).toBe(false);
    expect(container.querySelector('[data-slot="changeRace"]').hidden).toBe(true);
  });
});
