function niceNum(range, round) {
  const exponent = Math.floor(Math.log(range) / Math.LN10);
  const fraction = range / Math.pow(10, exponent);
  let niceFraction;
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

export function niceTicks(min, max, count) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const range = niceNum(max - min, false);
  const step = niceNum(range / (count - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + 1e-9; v += step) {
    ticks.push(Math.round(v * 1000) / 1000);
  }
  return { min: niceMin, max: niceMax, ticks };
}

export function scaleY(v, dMin, dMax, pxTop, pxBottom, invert) {
  const t = (v - dMin) / (dMax - dMin);
  return invert ? pxTop + t * (pxBottom - pxTop) : pxBottom - t * (pxBottom - pxTop);
}

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs) {
  const node = document.createElementNS(NS, tag);
  for (const key in attrs) node.setAttribute(key, attrs[key]);
  return node;
}

function cssVar(container, name) {
  return getComputedStyle(container).getPropertyValue(name).trim();
}

function makeTooltip(container) {
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  container.style.position = 'relative';
  container.appendChild(tip);
  return {
    show(build, x, y) {
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
    hide() {
      tip.classList.remove('show');
    }
  };
}

function ttRow(parent, color, label, value) {
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

export function roundedTopRectPath(x, y, w, h, r) {
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

export function lineChart(container, opts) {
  const W = 520, H = 220;
  const padL = 34, padR = 16, padT = 16, padB = 26;
  const plotL = padL, plotR = W - padR, plotT = padT, plotB = H - padB;
  const labels = opts.labels;
  const n = labels.length;

  const allVals = [];
  opts.series.forEach((s) => s.values.forEach((v) => allVals.push(v)));
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
  function xAt(i) {
    return plotL + (i / (n - 1)) * (plotR - plotL);
  }
  function yAt(v) {
    // invert defaults on: these charts mostly plot positions, where lower is
    // better and belongs at the top. Pass invert: false for higher-is-better
    // series (percentiles).
    return scaleY(v, domain.min, domain.max, plotT, plotB, opts.invert !== false);
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

  labels.forEach((_, i) => {
    const lbl = el('text', { class: 'tick-label', x: xAt(i), y: H - 8, 'text-anchor': 'middle' });
    lbl.textContent = opts.xTick ? opts.xTick(i) : `S${i + 1}`;
    svg.appendChild(lbl);
  });

  const crosshair = el('line', { class: 'crosshair', x1: 0, x2: 0, y1: plotT, y2: plotB, opacity: 0 });

  opts.series.forEach((s) => {
    const d = s.values.map((v, i) => (i === 0 ? 'M' : 'L') + xAt(i) + ',' + yAt(v)).join(' ');
    svg.appendChild(
      el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })
    );
    s.values.forEach((v, i) => {
      svg.appendChild(
        el('circle', { class: 'pt', cx: xAt(i), cy: yAt(v), r: 4, fill: s.color, stroke: cssVar(container, '--surface-1'), 'stroke-width': 2 })
      );
    });
    const lastI = s.values.length - 1;
    const endLabel = el('text', { class: 'end-label', x: xAt(lastI) + 8, y: yAt(s.values[lastI]) - 8, 'text-anchor': 'start' });
    endLabel.textContent = Math.round(s.values[lastI]) + (opts.suffix || '');
    svg.appendChild(endLabel);
  });

  svg.appendChild(crosshair);
  const overlay = el('rect', { class: 'hit', x: plotL, y: plotT, width: plotR - plotL, height: plotB - plotT });
  svg.appendChild(overlay);

  container.innerHTML = '';
  container.appendChild(svg);
  const tooltip = makeTooltip(container);

  function pointerToIndex(evt) {
    const rect = svg.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - plotL) / (plotR - plotL)) * (n - 1));
    return Math.max(0, Math.min(n - 1, i));
  }

  function showAt(i) {
    const x = xAt(i);
    crosshair.setAttribute('x1', x);
    crosshair.setAttribute('x2', x);
    crosshair.setAttribute('opacity', 1);
    const contRect = container.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const localX = (x / W) * svgRect.width + (svgRect.left - contRect.left);
    const localY = svgRect.top - contRect.top;
    tooltip.show((tip) => {
      const title = document.createElement('div');
      title.className = 'tt-title';
      title.textContent = labels[i];
      tip.appendChild(title);
      opts.series.forEach((s) => {
        ttRow(tip, s.color, s.name, Math.round(s.values[i]) + (opts.suffix || ''));
      });
    }, localX, localY);
  }

  overlay.addEventListener('pointermove', (evt) => showAt(pointerToIndex(evt)));
  overlay.addEventListener('pointerleave', () => {
    crosshair.setAttribute('opacity', 0);
    tooltip.hide();
  });
}

export function barChart(container, opts) {
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
      'aria-label': `${labels[i]}: ${opts.format(v)}`
    });
    svg.appendChild(path);

    const cap = el('text', { class: 'tick-label', x: cx, y: y - 6, 'text-anchor': 'middle' });
    cap.textContent = opts.format(v);
    cap.setAttribute('fill', cssVar(container, '--text-secondary'));
    svg.appendChild(cap);

    const xl = el('text', { class: 'tick-label', x: cx, y: H - 8, 'text-anchor': 'middle' });
    xl.textContent = opts.xTick ? opts.xTick(i) : `S${i + 1}`;
    svg.appendChild(xl);

    function show() {
      const contRect = container.getBoundingClientRect();
      const pathRect = path.getBoundingClientRect();
      tooltip.show((tip) => {
        const title = document.createElement('div');
        title.className = 'tt-title';
        title.textContent = labels[i];
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
