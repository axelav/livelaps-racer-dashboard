const FALLBACK_SERIES_COLORS = {
  overall: '#2a78d6',
  class: '#1baf7a',
  section: '#4a3aa7',
  speed: '#eda100',
  gap: '#eb6834',
  comparisons: ['#2a78d6', '#1baf7a', '#4a3aa7', '#eda100', '#eb6834']
};

const SERIES_COLOR_VARS = {
  overall: '--series-overall',
  class: '--series-class',
  section: '--series-section',
  speed: '--series-speed',
  gap: '--series-gap',
  comparisons: [
    '--series-comparison-1',
    '--series-comparison-2',
    '--series-comparison-3',
    '--series-comparison-4',
    '--series-comparison-5'
  ]
};

function styleRoot(container) {
  return container.closest?.('.viz-root') ?? container;
}

function readColor(root, styles, name, fallback) {
  return root.style?.getPropertyValue(name).trim() || styles.getPropertyValue(name).trim() || fallback;
}

export function historySeriesColors(container) {
  const root = styleRoot(container);
  const styles = getComputedStyle(root);
  return {
    overall: readColor(root, styles, SERIES_COLOR_VARS.overall, FALLBACK_SERIES_COLORS.overall),
    class: readColor(root, styles, SERIES_COLOR_VARS.class, FALLBACK_SERIES_COLORS.class),
    section: readColor(root, styles, SERIES_COLOR_VARS.section, FALLBACK_SERIES_COLORS.section),
    speed: readColor(root, styles, SERIES_COLOR_VARS.speed, FALLBACK_SERIES_COLORS.speed),
    gap: readColor(root, styles, SERIES_COLOR_VARS.gap, FALLBACK_SERIES_COLORS.gap),
    comparisons: SERIES_COLOR_VARS.comparisons.map((name, i) =>
      readColor(root, styles, name, FALLBACK_SERIES_COLORS.comparisons[i])
    )
  };
}
