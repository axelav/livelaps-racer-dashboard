export type ChartRenderer = (container: HTMLElement) => void;

export type ChartLightbox = {
  register(chart: HTMLElement, render: ChartRenderer): void;
};

let nextLightboxId = 0;

function requireElement<T extends Element>(value: T | null, label: string): T {
  if (!value) throw new Error(`Missing chart lightbox element: ${label}`);
  return value;
}

function expandIcon(): SVGSVGElement {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('viewBox', '0 0 16 16');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.5');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');

  for (const d of ['M6 2H2v4', 'M2 2l4 4', 'M10 2h4v4', 'M14 2l-4 4', 'M2 10v4h4', 'M2 14l4-4', 'M14 10v4h-4', 'M14 14l-4-4']) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    icon.appendChild(path);
  }

  return icon;
}

export function createChartLightbox(container: HTMLElement): ChartLightbox {
  const titleId = `chart-lightbox-title-${nextLightboxId++}`;
  const dialog = document.createElement('dialog');
  dialog.className = 'chart-lightbox';
  dialog.setAttribute('aria-labelledby', titleId);
  dialog.innerHTML = `
    <div class="chart-lightbox-head">
      <div>
        <h3 id="${titleId}"></h3>
        <p class="card-sub" data-slot="chartLightboxSubtitle"></p>
      </div>
      <button type="button" class="dialog-close chart-lightbox-close" data-slot="chartLightboxClose" aria-label="Close expanded chart">Close</button>
    </div>
    <div class="chart-lightbox-legend" data-slot="chartLightboxLegend"></div>
    <div class="chart-lightbox-chart" data-slot="chartLightboxChart"></div>
  `;
  container.appendChild(dialog);

  const title = requireElement(dialog.querySelector<HTMLHeadingElement>('h3'), 'title');
  const subtitle = requireElement(dialog.querySelector<HTMLParagraphElement>('[data-slot="chartLightboxSubtitle"]'), 'subtitle');
  const legend = requireElement(dialog.querySelector<HTMLElement>('[data-slot="chartLightboxLegend"]'), 'legend');
  const chart = requireElement(dialog.querySelector<HTMLElement>('[data-slot="chartLightboxChart"]'), 'chart');
  const close = requireElement(dialog.querySelector<HTMLButtonElement>('[data-slot="chartLightboxClose"]'), 'close button');

  function closeDialog(): void {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  close.addEventListener('click', closeDialog);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog();
  });

  return {
    register(sourceChart, render): void {
      const card = requireElement(sourceChart.closest<HTMLElement>('.card'), 'chart card');
      const heading = requireElement(card.querySelector<HTMLHeadingElement>('h2, h3'), 'chart title');
      const cardSubtitle = card.querySelector<HTMLParagraphElement>('.card-sub');
      const expand = document.createElement('button');
      expand.type = 'button';
      expand.className = 'chart-expand';
      expand.setAttribute('aria-label', `Expand ${heading.textContent || 'chart'}`);
      expand.title = 'Expand chart';
      card.classList.add('chart-card');
      expand.appendChild(expandIcon());
      card.appendChild(expand);

      expand.addEventListener('click', () => {
        title.textContent = heading.textContent;
        subtitle.textContent = cardSubtitle?.textContent ?? '';
        subtitle.hidden = !subtitle.textContent;
        legend.replaceChildren();
        const sourceLegend = card.querySelector<HTMLElement>('.legend');
        if (sourceLegend) legend.appendChild(sourceLegend.cloneNode(true));
        render(chart);
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
      });
    }
  };
}
