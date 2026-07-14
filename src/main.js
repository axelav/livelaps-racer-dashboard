import './style.css';
import { loadRaceById, deriveTotals, UnsupportedFormatError } from './livelaps.js';
import { renderSearch } from './search.js';
import { renderDashboard } from './dashboard.js';

const app = document.getElementById('app');

function currentParams() {
  const params = new URLSearchParams(window.location.search);
  return { raceId: params.get('race'), participantId: params.get('id') };
}

function showSearch(options = {}) {
  renderSearch(app, {
    ...options,
    onSelect(raceId, participantId) {
      history.pushState({}, '', `?race=${raceId}&id=${participantId}`);
      showDashboard(raceId, participantId);
    }
  });
}

function showSearchDefault() {
  history.pushState({}, '', window.location.pathname);
  showSearch();
}

async function showDashboard(raceId, participantId) {
  try {
    const { raceMeta, allResults } = await loadRaceById(raceId);
    const totals = deriveTotals(allResults, Number(participantId));
    if (!totals) {
      showSearch({ prefillRaceInput: raceId, notice: "Couldn't find that racer in this race." });
      return;
    }
    renderDashboard(app, { raceMeta, ...totals, onBack: showSearchDefault });
  } catch (err) {
    console.error(err);
    const message = err instanceof UnsupportedFormatError ? err.message : "Couldn't load that race.";
    showSearch({ prefillRaceInput: raceId, notice: message });
  }
}

function route() {
  const { raceId, participantId } = currentParams();
  if (raceId && participantId) {
    showDashboard(raceId, participantId);
  } else {
    showSearch();
  }
}

window.addEventListener('popstate', route);
route();
