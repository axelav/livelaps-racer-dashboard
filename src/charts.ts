import type { ResultStatus } from './domain.js';

type SvgAttrs = Record<string, string | number>;
type TooltipBuilder = (parent: HTMLDivElement) => void;
type Tooltip = {
  show(build: TooltipBuilder, x: number, y: number): void;
  hide(): void;
};

type NiceTicks = {
  min: number;
  max: number;
  ticks: number[];
};

export type LineChartSeries = {
  name: string;
  color: string;
  values: readonly (number | null)[];
  tooltipValues?: readonly (string | null | undefined)[];
  statuses?: readonly (ResultStatus | null | undefined)[];
  statusLabels?: readonly (string | null | undefined)[];
};

export type LineChartOptions = {
  ariaLabel?: string;
  labels: readonly string[];
  series: readonly LineChartSeries[];
  clampMin?: number;
  clampMax?: number;
  invert?: boolean;
  maxXTicks?: number;
  suffix?: string;
  xTick?: (index: number) => string;
};

export type BarChartOptions = {
  ariaLabel?: string;
  labels: readonly string[];
  values: readonly number[];
  color: string;
  label: string;
  format(value: number): string;
  xTick?: (index: number) => string;
};

function niceNum(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log(range) / Math.LN10);
  const fraction = range / Math.pow(10, exponent);
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * Math.pow(10, exponent);
}

export function niceTicks(min: number, max: number, count: number): NiceTicks {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  // Pick the step from the data span itself. Rounding the span before deriving
  // its step can expand a 550-place history to a 1,000-place axis.
  const step = niceNum((max - min) / (count - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + 1e-9; v += step) {
    ticks.push(Math.round(v * 1000) / 1000);
  }
  return { min: niceMin, max: niceMax, ticks };
}

export function scaleY(v: number, dMin: number, dMax: number, pxTop: number, pxBottom: number, invert: boolean): number {
  const t = (v - dMin) / (dMax - dMin);
  return invert ? pxTop + t * (pxBottom - pxTop) : pxBottom - t * (pxBottom - pxTop);
}

const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: SvgAttrs): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function cssVar(container: Element, name: string): string {
  return getComputedStyle(container).getPropertyValue(name).trim();
}

function makeTooltip(container: HTMLElement): Tooltip {
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  container.style.position = 'relative';
  container.appendChild(tip);
  return {
    show(build: TooltipBuilder, x: number, y: number): void {
      tip.innerHTML = '';
      build(tip);
      tip.classList.add('show');
      const cw = container.clientWidth;
      const tw = tip.offsetWidth;
      let left = x + 14;
      if (left + tw > cw) left = x - tw - 14;
      tip.style.left = Math.max(4, left) + 'px';
      tip.style.top = Math.max(4, y - 10) + 'px';
    },
    hide(): void {
      tip.classList.remove('show');
    }
  };
}

function ttRow(parent: HTMLElement, color: string | null | undefined, label: string, value: string): void {
  const row = document.createElement('div');
  row.className = 'tt-row';
  if (color) {
    const key = document.createElement('span');
    key.className = 'tt-key';
    key.style.background = color;
    row.appendChild(key);
  }
  const lab = document.createElement('span');
  lab.textContent = label;
  row.appendChild(lab);
  const val = document.createElement('span');
  val.className = 'tt-val';
  val.textContent = value;
  row.appendChild(val);
  parent.appendChild(row);
}

export function roundedTopRectPath(x: number, y: number, w: number, h: number, r: number): string {
  r = Math.min(r, w / 2, h);
  return [
    'M', x, y + h,
    'L', x, y + r,
    'Q', x, y, x + r, y,
    'L', x + w - r, y,
    'Q', x + w, y, x + w, y + r,
    'L', x + w, y + h,
    'Z'
  ].join(' ');
}

const MAX_X_TICKS = 6;

function clampedValue(v: number, min?: number, max?: number): number {
  let next = v;
  if (min != null) next = Math.max(min, next);
  if (max != null) next = Math.min(max, next);
  return next;
}

function sparseTickIndexes(count: number, maxTicks: number): Set<number> {
  if (count <= maxTicks) return new Set(Array.from({ length: count }, (_, i) => i));
  return new Set(Array.from({ length: maxTicks }, (_, i) => Math.round((i * (count - 1)) / (maxTicks - 1))));
}

export function lineChart(container: HTMLElement, opts: LineChartOptions): void {
  const W = 520, H = 220;
  const padL = 34, padR = 44, padT = 16, padB = 32;
  const plotL = padL, plotR = W - padR, plotT = padT, plotB = H - padB;
  const labels = opts.labels;
  const n = labels.length;

  // null values = no data at that x (e.g. a rider who missed a check); the
  // line breaks there instead of plotting a fake point.
  const allVals: number[] = [];
  opts.series.forEach((s) => s.values.forEach((v) => v != null && allVals.push(v)));
  const dMin = Math.min(...allVals);
  const dMax = Math.max(...allVals);
  const pad = Math.max((dMax - dMin) * 0.25, 2);
  // clampMin/clampMax keep the padded domain inside the value space (positions
  // can't go below 1, percentiles beyond 0..100).
  let lo = dMin - pad;
  let hi = dMax + pad;
  if (opts.clampMin != null) lo = Math.max(opts.clampMin, lo);
  if (opts.clampMax != null) hi = Math.min(opts.clampMax, hi);
  const domain = niceTicks(lo, hi, 4);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.ariaLabel || '' });
  function xAt(i: number): number {
    return n <= 1 ? (plotL + plotR) / 2 : plotL + (i / (n - 1)) * (plotR - plotL);
  }
  function yAt(v: number): number {
    // invert defaults on: these charts mostly plot positions, where lower is
    // better and belongs at the top. Pass invert: false for higher-is-better
    // series (percentiles).
    return scaleY(clampedValue(v, opts.clampMin, opts.clampMax), domain.min, domain.max, plotT, plotB, opts.invert !== false);
  }

  domain.ticks.forEach((t) => {
    const y = yAt(t);
    if (y < plotT - 1 || y > plotB + 1) return;
    svg.appendChild(el('line', { class: 'grid-line', x1: plotL, x2: plotR, y1: y, y2: y }));
    const lbl = el('text', { class: 'tick-label', x: plotL - 8, y: y + 3, 'text-anchor': 'end' });
    lbl.textContent = String(Math.round(t));
    svg.appendChild(lbl);
  });
  svg.appendChild(el('line', { class: 'axis-line', x1: plotL, x2: plotL, y1: plotT, y2: plotB }));

  const xTickIndexes = sparseTickIndexes(n, opts.maxXTicks ?? n);
  labels.forEach((_, i) => {
    if (!xTickIndexes.has(i)) return;
    const lbl = el('text', { class: 'tick-label', x: xAt(i), y: H - 8, 'text-anchor': 'middle' });
    lbl.textContent = opts.xTick ? opts.xTick(i) : `S${i + 1}`;
    svg.appendChild(lbl);
  });

  const crosshair = el('line', { class: 'crosshair', x1: 0, x2: 0, y1: plotT, y2: plotB, opacity: 0 });

  opts.series.forEach((s) => {
    let d = '';
    let pen = false;
    s.values.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      d += (pen ? ' L' : ' M') + xAt(i) + ',' + yAt(v);
      pen = true;
    });
    svg.appendChild(
      el('path', { d: d.trim(), fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })
    );
    s.values.forEach((v, i) => {
      if (v == null) return;
      const status = s.statuses?.[i];
      svg.appendChild(
        el('circle', {
          class: status === 'official_dnf' ? 'pt pt-dnf' : 'pt',
          cx: xAt(i),
          cy: yAt(v),
          r: 4,
          fill: status === 'official_dnf' ? 'transparent' : s.color,
          stroke: status === 'official_dnf' ? s.color : cssVar(container, '--surface-1'),
          'stroke-width': status === 'official_dnf' ? 2.5 : 2
        })
      );
    });
    s.values.forEach((v, i) => {
      if (v != null || s.statuses?.[i] !== 'no_result') return;
      svg.appendChild(
        el('circle', { class: 'pt-no-result', cx: xAt(i), cy: plotB, r: 3, fill: cssVar(container, '--text-muted') })
      );
    });
    let lastI = s.values.length - 1;
    while (lastI >= 0 && s.values[lastI] == null) lastI--;
    const lastValue = s.values[lastI];
    if (lastI < 0 || lastValue == null) return;
    const endValue = clampedValue(lastValue, opts.clampMin, opts.clampMax);
    const endLabel = el('text', { class: 'end-label', x: xAt(lastI) + 8, y: yAt(endValue) - 8, 'text-anchor': 'start' });
    endLabel.textContent = Math.round(endValue) + (opts.suffix || '');
    svg.appendChild(endLabel);
  });

  svg.appendChild(crosshair);
  const overlay = el('rect', { class: 'hit', x: plotL, y: plotT, width: plotR - plotL, height: plotB - plotT });
  svg.appendChild(overlay);

  container.innerHTML = '';
  container.appendChild(svg);
  const tooltip = makeTooltip(container);

  function pointerToIndex(evt: PointerEvent): number {
    const rect = svg.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - plotL) / (plotR - plotL)) * (n - 1));
    return Math.max(0, Math.min(n - 1, i));
  }

  function showAt(i: number): void {
    const x = xAt(i);
    crosshair.setAttribute('x1', String(x));
    crosshair.setAttribute('x2', String(x));
    crosshair.setAttribute('opacity', '1');
    const contRect = container.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const localX = (x / W) * svgRect.width + (svgRect.left - contRect.left);
    const localY = svgRect.top - contRect.top;
    tooltip.show((tip) => {
      const title = document.createElement('div');
      title.className = 'tt-title';
      title.textContent = labels[i] ?? '';
      tip.appendChild(title);
      opts.series.forEach((s) => {
        const v = s.values[i];
        const status = s.statuses?.[i];
        const note = s.statusLabels?.[i];
        let value = s.tooltipValues?.[i];
        if (value == null) value = v == null ? '—' : Math.round(v) + (opts.suffix || '');
        if (status === 'official_dnf' && note && !String(value).includes(note)) value += ` · ${note}`;
        if (status === 'no_result') value = note || 'No final result';
        ttRow(tip, s.color, s.name, value);
      });
    }, localX, localY);
  }

  overlay.addEventListener('pointermove', (evt) => showAt(pointerToIndex(evt)));
  overlay.addEventListener('pointerleave', () => {
    crosshair.setAttribute('opacity', '0');
    tooltip.hide();
  });
}

export function barChart(container: HTMLElement, opts: BarChartOptions): void {
  const W = 520, H = 220;
  const padL = 34, padR = 16, padT = 20, padB = 26;
  const plotL = padL, plotR = W - padR, plotT = padT, plotB = H - padB;
  const values = opts.values;
  const labels = opts.labels;
  const n = values.length;
  const dMax = Math.max(...values);
  const domain = niceTicks(0, dMax * 1.15, 4);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.ariaLabel || '' });
  const bandW = (plotR - plotL) / n;
  const barW = Math.min(28, bandW * 0.5);

  domain.ticks.forEach((t) => {
    const y = scaleY(t, domain.min, domain.max, plotT, plotB, false);
    svg.appendChild(el('line', { class: 'grid-line', x1: plotL, x2: plotR, y1: y, y2: y }));
    const lbl = el('text', { class: 'tick-label', x: plotL - 8, y: y + 3, 'text-anchor': 'end' });
    lbl.textContent = String(Math.round(t * 10) / 10);
    svg.appendChild(lbl);
  });
  svg.appendChild(el('line', { class: 'axis-line', x1: plotL, x2: plotR, y1: plotB, y2: plotB }));

  container.innerHTML = '';
  container.appendChild(svg);
  const tooltip = makeTooltip(container);

  values.forEach((v, i) => {
    const cx = plotL + bandW * (i + 0.5);
    const y = scaleY(v, domain.min, domain.max, plotT, plotB, false);
    const h = plotB - y;
    const path = el('path', {
      class: 'bar',
      d: roundedTopRectPath(cx - barW / 2, y, barW, h, 4),
      fill: opts.color,
      tabindex: '0',
      role: 'img',
      'aria-label': `${labels[i] ?? ''}: ${opts.format(v)}`
    });
    svg.appendChild(path);

    const cap = el('text', { class: 'tick-label', x: cx, y: y - 6, 'text-anchor': 'middle' });
    cap.textContent = opts.format(v);
    cap.setAttribute('fill', cssVar(container, '--text-secondary'));
    svg.appendChild(cap);

    const xl = el('text', { class: 'tick-label', x: cx, y: H - 8, 'text-anchor': 'middle' });
    xl.textContent = opts.xTick ? opts.xTick(i) : `S${i + 1}`;
    svg.appendChild(xl);

    function show(): void {
      const contRect = container.getBoundingClientRect();
      const pathRect = path.getBoundingClientRect();
      tooltip.show((tip) => {
        const title = document.createElement('div');
        title.className = 'tt-title';
        title.textContent = labels[i] ?? '';
        tip.appendChild(title);
        ttRow(tip, opts.color, opts.label, opts.format(v));
      }, pathRect.left - contRect.left, pathRect.top - contRect.top);
    }
    path.addEventListener('pointerenter', show);
    path.addEventListener('pointermove', show);
    path.addEventListener('focus', show);
    path.addEventListener('pointerleave', tooltip.hide);
    path.addEventListener('blur', tooltip.hide);
  });
}
