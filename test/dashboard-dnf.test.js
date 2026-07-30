// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { renderDashboard } from '../src/dashboard.js';

describe('renderDashboard for a timed DNF', () => {
  function render() {
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
    const subhead = c.querySelector('[data-slot="subhead"]').textContent;
    expect(subhead).toContain('DNF after 2 of 5 timed sections');
    expect(subhead).not.toContain('finished in null');
    expect(c.querySelector('[data-slot="statClass"]').textContent.replace(/\s+/g, ' ')).toContain('7 / 7');
    expect(c.querySelector('[data-slot="statGapLeader"]').textContent).toBe('—');
    expect(c.querySelector('[data-slot="statGapLeaderSub"]').textContent).toBe('behind class leader by —');
    expect(c.querySelector('[data-slot="chartOverall"]').closest('.card').textContent).toContain(
      'Estimated from cumulative section times; final point is the official result'
    );
  });
});
