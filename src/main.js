import './style.css';
import { archiveApi, archivedRaceFromResponse } from './api.js';
import { renderSearch } from './search.js';
import { renderDashboard } from './dashboard.js';
import { clearSavedRacerName, normalizeRacerName, renderHistory, saveRacerName } from './history.js';

const app = document.getElementById('app');
let requestId = 0;
let activeRace = null;

function currentParams() {
  const params = new URLSearchParams(window.location.search);
  const requestedRaceId = params.get('race');
  const legacyPathRaceId = window.location.pathname.match(
    /\/race\/(?:results|filters|config)\/(\d+)(?:\/|$)/
  )?.[1];
  const legacyRaceId = /^\d+$/.test(requestedRaceId ?? '')
    ? requestedRaceId
    : legacyPathRaceId;

  return {
    raceId: legacyRaceId ? `livelaps:${legacyRaceId}` : requestedRaceId,
    participantId: params.get('id'),
    ingestInput: legacyRaceId
  };
}

async function loadArchivedRace(raceId, ingestInput) {
  try {
    return archivedRaceFromResponse(await archiveApi.sourceRace(raceId));
  } catch (error) {
    if (!ingestInput || error.status !== 404) throw error;
    return archivedRaceFromResponse(await archiveApi.ingest(ingestInput));
  }
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

async function showDashboard(raceId, participantId, loadedRace, ingestInput, knownHistory) {
  const thisRequest = ++requestId;
  try {
    const race =
      loadedRace && String(loadedRace.raceId) === String(raceId)
        ? loadedRace
        : await loadArchivedRace(raceId, ingestInput);
    if (thisRequest !== requestId) return;
    activeRace = race;
    history.replaceState(
      {},
      '',
      `?race=${encodeURIComponent(race.raceId)}&id=${encodeURIComponent(participantId)}`
    );
    const totals = deriveTotals(race.allResults, participantId);
    if (!totals) {
      history.replaceState({}, '', window.location.pathname);
      showSearch({ race, notice: "Couldn't find that racer in this race." });
      return;
    }
    const normalizedName = normalizeRacerName(totals.racer.fullName);
    const racerHistory = knownHistory ?? (await archiveApi.history(normalizedName));
    if (thisRequest !== requestId) return;
    saveRacerName(normalizedName);
    app.innerHTML = `
      <div class="dashboard-layout">
        <aside class="dashboard-history" data-slot="historyPanel"></aside>
        <main class="dashboard-detail" data-slot="detailPanel"></main>
      </div>
    `;
    const historyPanel = app.querySelector('[data-slot="historyPanel"]');
    const detailPanel = app.querySelector('[data-slot="detailPanel"]');
    renderHistory(historyPanel, {
      history: racerHistory,
      selectedSourceRaceId: race.raceId,
      onSelectRace: async (selectedRaceId) => {
        if (selectedRaceId === race.raceId) return;
        try {
          const selectedRace = await loadArchivedRace(selectedRaceId);
          const selectedRacer = selectedRace.allResults.find(
            (entry) => normalizeRacerName(entry.fullName) === normalizedName
          );
          if (!selectedRacer) throw new Error("Couldn't find that racer in this archived race.");
          await showDashboard(selectedRaceId, selectedRacer.id, selectedRace, undefined, racerHistory);
        } catch (error) {
          console.error(error);
          window.alert(error.message || "Couldn't load that archived race.");
        }
      },
      onClear: () => clearSavedRacerName()
    });
    renderDashboard(detailPanel, {
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

async function showRaceSearch(raceId, ingestInput) {
  const thisRequest = ++requestId;
  try {
    const race = await loadArchivedRace(raceId, ingestInput);
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
  const { raceId, participantId, ingestInput } = currentParams();
  if (raceId && participantId) {
    showDashboard(raceId, participantId, undefined, ingestInput);
  } else if (raceId) {
    showRaceSearch(raceId, ingestInput);
  } else {
    showSearch({ race: activeRace });
  }
}

window.addEventListener('popstate', route);
route();
