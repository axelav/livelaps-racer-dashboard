import './style.css';
import {
  loadRaceById,
  resolveAndLoadRace,
  deriveTotals,
  parseRaceId,
  UnsupportedFormatError
} from './raceSource.js';
import { renderSearch } from './search.js';
import { renderDashboard } from './dashboard.js';

const app = document.getElementById('app');
let requestId = 0;
let activeRace = null;

function currentParams() {
  const params = new URLSearchParams(window.location.search);
  return { raceId: params.get('race'), participantId: params.get('id') };
}

function showSearch(options = {}) {
  renderSearch(app, {
    ...options,
    onSelect(raceId, participantId, race) {
      activeRace = race;
      history.pushState({}, '', `?race=${raceId}&id=${participantId}`);
      showDashboard(raceId, participantId, race);
    }
  });
}

function showSearchDefault() {
  history.pushState({}, '', window.location.pathname);
  showSearch({ race: activeRace });
}

async function showDashboard(raceId, participantId, loadedRace) {
  const thisRequest = ++requestId;
  try {
    const race =
      loadedRace && String(loadedRace.raceId) === String(raceId) ? loadedRace : await loadRaceById(raceId);
    const { raceMeta, allResults } = race;
    if (thisRequest !== requestId) return;
    activeRace = { raceId, raceMeta, allResults };
    const totals = deriveTotals(allResults, Number(participantId));
    if (!totals) {
      history.replaceState({}, '', window.location.pathname);
      showSearch({ prefillRaceInput: raceId, notice: "Couldn't find that racer in this race." });
      return;
    }
    renderDashboard(app, { raceMeta, ...totals, onBack: showSearchDefault });
  } catch (err) {
    if (thisRequest !== requestId) return;
    console.error(err);
    const message =
      err instanceof UnsupportedFormatError ? err.message : "Couldn't load that race — check the link and try again.";
    history.replaceState({}, '', window.location.pathname);
    showSearch({ notice: message });
  }
}

async function showRaceSearch(input) {
  const thisRequest = ++requestId;
  try {
    const race = await resolveAndLoadRace(input);
    if (thisRequest !== requestId) return;
    activeRace = race;
    history.replaceState({}, '', `?race=${encodeURIComponent(race.raceId)}`);
    showSearch({ race });
  } catch (err) {
    if (thisRequest !== requestId) return;
    console.error(err);
    showSearch({ notice: "Couldn't load that race — check the link and try again." });
  }
}

function route() {
  const { raceId, participantId } = currentParams();
  if (raceId && participantId) {
    showDashboard(raceId, participantId);
  } else if (raceId) {
    showRaceSearch(raceId);
  } else if (parseRaceId(window.location.pathname)) {
    showRaceSearch(window.location.href);
  } else {
    showSearch({ race: activeRace });
  }
}

window.addEventListener('popstate', route);
route();
