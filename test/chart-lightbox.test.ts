// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createChartLightbox } from '../src/chart-lightbox.js';
import { mustQuery } from './dom-helpers.js';

describe('chart lightbox', () => {
  it('opens a shared dialog and re-renders the selected chart', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <div class="card">
        <h2>Overall position</h2>
        <p class="card-sub">Overall result at each archived event</p>
        <div class="legend">Legend</div>
        <div data-slot="chart"></div>
      </div>
    `;
    const sourceChart = mustQuery<HTMLElement>(container, '[data-slot="chart"]');
    const lightbox = createChartLightbox(container);
    let renders = 0;
    const render = (chart: HTMLElement): void => {
      renders++;
      chart.textContent = `Chart render ${renders}`;
    };

    render(sourceChart);
    lightbox.register(sourceChart, render);

    const expand = mustQuery<HTMLButtonElement>(container, '.chart-expand');
    expect(expand.getAttribute('aria-label')).toBe('Expand Overall position');
    expect(expand.querySelector('svg')).not.toBeNull();

    expand.click();

    const dialog = mustQuery<HTMLDialogElement>(container, '.chart-lightbox');
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(mustQuery<HTMLElement>(dialog, 'h3').textContent).toBe('Overall position');
    expect(mustQuery<HTMLElement>(dialog, '[data-slot="chartLightboxSubtitle"]').textContent).toBe(
      'Overall result at each archived event'
    );
    expect(mustQuery<HTMLElement>(dialog, '[data-slot="chartLightboxLegend"]').textContent).toBe('Legend');
    expect(mustQuery<HTMLElement>(dialog, '[data-slot="chartLightboxChart"]').textContent).toBe('Chart render 2');

    mustQuery<HTMLButtonElement>(dialog, '[data-slot="chartLightboxClose"]').click();
    expect(dialog.hasAttribute('open')).toBe(false);
  });
});
