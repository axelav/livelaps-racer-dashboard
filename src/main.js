import './style.css';
import { archiveApi, archivedRaceFromResponse } from './api.js';
import { renderSearch } from './search.js';
import { renderDashboard } from './dashboard.js';
import { normalizeRacerName, renderHistory } from './history.js';

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
    },
    async onSelectRacer(normalizedName) {
      const thisRequest = ++requestId;
      try {
        const racerHistory = await archiveApi.history(normalizedName);
        const latest = racerHistory.races?.at(-1);
        if (!latest) throw new Error('No archived races for that rider yet.');
        const race = await loadArchivedRace(latest.sourceRaceId);
        if (thisRequest !== requestId) return;
        const racer = race.allResults.find(
          (entry) => normalizeRacerName(entry.fullName) === normalizedName
        );
        if (!racer) throw new Error("Couldn't find that rider in their latest archived race.");
        history.pushState(
          {},
          '',
          `?race=${encodeURIComponent(race.raceId)}&id=${encodeURIComponent(racer.id)}`
        );
        await showDashboard(race.raceId, racer.id, race, undefined, racerHistory);
      } catch (error) {
        if (thisRequest !== requestId) return;
        console.error(error);
        showSearch({ notice: error.message || "Couldn't load that rider's history." });
      }
    }
  });
}

// Home always means the clean search page — never a leftover loaded race.
function showSearchDefault() {
  ++requestId;
  activeRace = null;
  history.pushState({}, '', window.location.pathname);
  showSearch();
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
    app.innerHTML = `
      <div class="viz-root">
        <div class="page-topbar">
          <button type="button" class="back-link" data-slot="home">&larr; Home</button>
        </div>
        <div class="dashboard-layout">
          <aside class="dashboard-history" data-slot="historyPanel"></aside>
          <main class="dashboard-detail" data-slot="detailPanel"></main>
        </div>
      </div>
    `;
    app.querySelector('[data-slot="home"]').addEventListener('click', showSearchDefault);
    const historyPanel = app.querySelector('[data-slot="historyPanel"]');
    const detailPanel = app.querySelector('[data-slot="detailPanel"]');
    renderDashboard(detailPanel, {
      raceMeta: race.raceMeta,
      capturedAt: race.capturedAt,
      ...totals,
      onRefresh: async () => {
        const refreshedRace = archivedRaceFromResponse(await archiveApi.refresh(raceId));
        activeRace = refreshedRace;
        await showDashboard(raceId, participantId, refreshedRace);
      }
    });

    const renderRacerHistory = (racerHistory) => {
      renderHistory(historyPanel, {
        history: racerHistory,
        selectedSourceRaceId: race.raceId,
        onSelectRace: async (selectedRaceId) => {
          if (selectedRaceId === race.raceId) return;
          const pickerRequest = ++requestId;
          try {
            const selectedRace = await loadArchivedRace(selectedRaceId);
            if (pickerRequest !== requestId) return;
            const selectedRacer = selectedRace.allResults.find(
              (entry) => normalizeRacerName(entry.fullName) === normalizedName
            );
            if (!selectedRacer) throw new Error("Couldn't find that racer in this archived race.");
            await showDashboard(selectedRaceId, selectedRacer.id, selectedRace, undefined, racerHistory);
          } catch (error) {
            if (pickerRequest !== requestId) return;
            console.error(error);
            window.alert(error.message || "Couldn't load that archived race.");
          }
        }
      });
    };

    if (knownHistory) {
      renderRacerHistory(knownHistory);
    } else {
      historyPanel.textContent = 'Loading history…';
      archiveApi
        .history(normalizedName)
        .then((racerHistory) => {
          if (thisRequest === requestId) renderRacerHistory(racerHistory);
        })
        .catch((error) => {
          if (thisRequest !== requestId) return;
          console.error(error);
          historyPanel.textContent = 'History is unavailable. Race detail remains available.';
        });
    }
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
    showSearch();
  }
}

window.addEventListener('popstate', route);
route();
