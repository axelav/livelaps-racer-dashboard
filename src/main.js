import './style.css';
import { archiveApi, archivedRaceFromResponse } from './api.js';
import { renderSearch } from './search.js';
import { renderDashboard } from './dashboard.js';

const app = document.getElementById('app');
let requestId = 0;
let activeRace = null;

function currentParams() {
  const params = new URLSearchParams(window.location.search);
  return { raceId: params.get('race'), participantId: params.get('id') };
}

function deriveTotals(allResults, participantId) {
  const racer = allResults.find((result) => String(result.id) === String(participantId));
  if (!racer) return null;
  const classSize = allResults.filter((result) => result.className === racer.className).length;
  return { racer, fieldSize: allResults.length, classSize };
}

function showSearch(options = {}) {
  renderSearch(app, {
    ...options,
    api: archiveApi,
    onSelect(raceId, participantId, race) {
      activeRace = race;
      history.pushState(
        {},
        '',
        `?race=${encodeURIComponent(raceId)}&id=${encodeURIComponent(participantId)}`
      );
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
      loadedRace && String(loadedRace.raceId) === String(raceId)
        ? loadedRace
        : archivedRaceFromResponse(await archiveApi.sourceRace(raceId));
    if (thisRequest !== requestId) return;
    activeRace = race;
    const totals = deriveTotals(race.allResults, participantId);
    if (!totals) {
      history.replaceState({}, '', window.location.pathname);
      showSearch({ race, notice: "Couldn't find that racer in this race." });
      return;
    }
    renderDashboard(app, {
      raceMeta: race.raceMeta,
      capturedAt: race.capturedAt,
      ...totals,
      onBack: showSearchDefault,
      onRefresh: async () => {
        const refreshedRace = archivedRaceFromResponse(await archiveApi.refresh(raceId));
        activeRace = refreshedRace;
        await showDashboard(raceId, participantId, refreshedRace);
      }
    });
  } catch (error) {
    if (thisRequest !== requestId) return;
    console.error(error);
    history.replaceState({}, '', window.location.pathname);
    showSearch({ notice: error.message || "Couldn't load that archived race." });
  }
}

async function showRaceSearch(raceId) {
  const thisRequest = ++requestId;
  try {
    const race = archivedRaceFromResponse(await archiveApi.sourceRace(raceId));
    if (thisRequest !== requestId) return;
    activeRace = race;
    history.replaceState({}, '', `?race=${encodeURIComponent(race.raceId)}`);
    showSearch({ race });
  } catch (error) {
    if (thisRequest !== requestId) return;
    console.error(error);
    history.replaceState({}, '', window.location.pathname);
    showSearch({ notice: error.message || "Couldn't load that archived race." });
  }
}

function route() {
  const { raceId, participantId } = currentParams();
  if (raceId && participantId) {
    showDashboard(raceId, participantId);
  } else if (raceId) {
    showRaceSearch(raceId);
  } else {
    showSearch({ race: activeRace });
  }
}

window.addEventListener('popstate', route);
route();
