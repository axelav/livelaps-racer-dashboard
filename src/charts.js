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
