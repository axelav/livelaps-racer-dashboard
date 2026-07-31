// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { renderDashboard } from '../src/dashboard.js';
import { mustQuery } from './dom-helpers.js';

describe('renderDashboard for a timed DNF', () => {
  function render(): HTMLDivElement {
    const container = document.createElement('div');
    renderDashboard(container, {
      raceMeta: { raceName: '2025 Moonshine Enduro — Long Course', modeName: 'Enduro' },
      fieldSize: 120,
      classSize: 7,
      capturedAt: '2026-07-28T20:03:25.000Z',
      onRefresh: vi.fn(),
      racer: {
        id: 3279244,
        fullName: 'AXEL ANDERSON',
        displayedNumber: '11C',
        brand: 'HUS',
        className: 'A SR 40+',
        overallPosition: 115,
        classPosition: 7,
        avgSpeedTotal: null,
        overallBehindByLeader: null,
        classBehindByLeader: null,
        sections: [
          {
            sectionName: 'Test 1',
            totalCumulatedTime: '0:06:41',
            overallPosition: 66,
            classPosition: 6,
            sectionOverallPosition: 66,
            sectionClassPosition: 6,
            avgSpeed: null,
            overallBehindBy: '0:00:02'
          },
          {
            sectionName: 'Test 2',
            totalCumulatedTime: '0:12:24',
            overallPosition: 60,
            classPosition: 4,
            sectionOverallPosition: 55,
            sectionClassPosition: 4,
            avgSpeed: null,
            overallBehindBy: '0:00:02'
          },
          { sectionName: 'Test 3', totalCumulatedTime: null, overallPosition: null, classPosition: null, sectionOverallPosition: null, sectionClassPosition: null, avgSpeed: null, overallBehindBy: null },
          { sectionName: 'Test 4', totalCumulatedTime: null, overallPosition: null, classPosition: null, sectionOverallPosition: null, sectionClassPosition: null, avgSpeed: null, overallBehindBy: null },
          { sectionName: 'Test 5', totalCumulatedTime: null, overallPosition: null, classPosition: null, sectionOverallPosition: null, sectionClassPosition: null, avgSpeed: null, overallBehindBy: null }
        ]
      }
    });
    return container;
  }

  it('describes the DNF instead of printing null as a finish time', () => {
    const c = render();
    const subhead = mustQuery<HTMLElement>(c, '[data-slot="subhead"]').textContent;
    expect(subhead).toContain('DNF after 2 of 5 timed sections');
    expect(subhead).not.toContain('finished in null');
    expect(mustQuery<HTMLElement>(c, '[data-slot="statClass"]').textContent.replace(/\s+/g, ' ')).toContain('7 / 7');
    expect(mustQuery<HTMLElement>(c, '[data-slot="statGapLeader"]').textContent).toBe('—');
    expect(mustQuery<HTMLElement>(c, '[data-slot="statGapLeaderSub"]').textContent).toBe('behind class leader by —');
    expect(mustQuery<HTMLElement>(c, '[data-slot="chartOverall"]').closest('.card')?.textContent).toContain(
      'Estimated from cumulative section times; final point is the official result'
    );
  });
  it('renders partial Sprint Enduro data without a final classification', () => {
    const container = document.createElement('div');
    renderDashboard(container, {
      raceMeta: { raceName: '2026 Pine Glen Farm Sprint Enduro', modeName: 'Enduro' },
      fieldSize: 52,
      classSize: 7,
      capturedAt: '2026-07-30T12:00:00.000Z',
      onRefresh: vi.fn(),
      racer: {
        id: 7487410,
        fullName: 'LOGAN MORLEY',
        displayedNumber: '172',
        brand: 'KTM',
        className: 'AA',
        overallPosition: null,
        classPosition: null,
        avgSpeedTotal: null,
        overallBehindByLeader: null,
        classBehindByLeader: null,
        sections: [
          { sectionName: 'T1 1', totalCumulatedTime: '0:04:38.000', overallPosition: 2, classPosition: 2, sectionOverallPosition: null, sectionClassPosition: 2, avgSpeed: null, overallBehindBy: '0:00:09.000' },
          { sectionName: 'T1 2', totalCumulatedTime: null, overallPosition: null, classPosition: null, sectionOverallPosition: null, sectionClassPosition: null, avgSpeed: null, overallBehindBy: null },
          { sectionName: 'T2 1', totalCumulatedTime: '0:19:30.000', overallPosition: 2, classPosition: 2, sectionOverallPosition: null, sectionClassPosition: 2, avgSpeed: null, overallBehindBy: '0:00:21.000' },
          { sectionName: 'T3 1', totalCumulatedTime: '0:29:19.000', overallPosition: 2, classPosition: 2, sectionOverallPosition: null, sectionClassPosition: 2, avgSpeed: null, overallBehindBy: '0:00:30.000' }
        ]
      }
    });

    expect(mustQuery<HTMLElement>(container, '[data-slot="subhead"]').textContent).toContain(
      'DNF after 3 of 4 timed sections'
    );
    expect(mustQuery<HTMLElement>(container, '[data-slot="statOverall"]').textContent.replace(/\s+/g, ' ')).toContain('— / 52');
    expect(mustQuery<HTMLElement>(container, '[data-slot="statOverallSub"]').textContent).toBe('unclassified (DNF)');
    expect(mustQuery<HTMLElement>(container, '[data-slot="statClass"]').textContent.replace(/\s+/g, ' ')).toContain('— / 7');
    expect(mustQuery<HTMLElement>(container, '[data-slot="statClassSub"]').textContent).toContain('unclassified (DNF)');
  });
});
