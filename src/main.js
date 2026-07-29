import './style.css';
import { archiveApi, archivedRaceFromResponse } from './api.js';
import { renderSearch } from './search.js';
import { renderDashboard } from './dashboard.js';
import { normalizeRacerName, renderHistory } from './history.js';
import { addComparisonRider, comparisonSetFromParams, writeComparisonSet } from './comparisonSet.js';

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

function dashboardUrl(raceId, participantId, comparisonSet = comparisonSetFromParams(new URLSearchParams(window.location.search))) {
  const params = new URLSearchParams();
  params.set('race', raceId);
  params.set('id', participantId);
  writeComparisonSet(params, comparisonSet);
  return `?${params.toString()}`;
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
      history.pushState({}, '', dashboardUrl(raceId, participantId, []));
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
        history.pushState({}, '', dashboardUrl(race.raceId, racer.id, []));
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
    history.replaceState({}, '', dashboardUrl(race.raceId, participantId));
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

    const renderRacerHistory = async (racerHistory) => {
      let comparisonCandidates = [];
      try {
        comparisonCandidates = (await archiveApi.comparisonCandidates(normalizedName)).riders ?? [];
      } catch (error) {
        console.error(error);
      }
      const comparisonSet = comparisonSetFromParams(new URLSearchParams(window.location.search));
      const comparisonNotices = [];
      const anchorRoundIds = new Set((racerHistory.races ?? []).map((historyRace) => historyRace.sourceRaceId));
      const seenComparisonNames = new Set();
      const comparisonHistories = (
        await Promise.all(
          comparisonSet.map(async (normalizedComparisonName, slot) => {
            if (!normalizedComparisonName) return null;
            if (normalizedComparisonName === normalizedName) {
              comparisonNotices.push(`${normalizedComparisonName} ignored because it is the Anchor Racer.`);
              return null;
            }
            if (seenComparisonNames.has(normalizedComparisonName)) {
              comparisonNotices.push(`${normalizedComparisonName} ignored because it is already in the Comparison Set.`);
              return null;
            }
            seenComparisonNames.add(normalizedComparisonName);
            try {
              const comparisonHistory = await archiveApi.history(normalizedComparisonName);
              const hasSharedRound = (comparisonHistory.races ?? []).some((historyRace) =>
                anchorRoundIds.has(historyRace.sourceRaceId)
              );
              if (!hasSharedRound) {
                comparisonNotices.push(`${normalizedComparisonName} omitted because it has zero Shared Rounds.`);
                return null;
              }
              return { ...comparisonHistory, slot, normalizedName: normalizedComparisonName };
            } catch {
              comparisonNotices.push(`${normalizedComparisonName} could not be found in the Race Archive.`);
              return null;
            }
          })
        )
      ).filter(Boolean);
      renderHistory(historyPanel, {
        history: racerHistory,
        selectedSourceRaceId: race.raceId,
        comparisonCandidates,
        comparisonHistories,
        comparisonNotices,
        onAddComparisonRider: (comparisonRiderName) => {
          const params = new URLSearchParams(window.location.search);
          addComparisonRider(params, comparisonRiderName, normalizedName);
          history.pushState(
            {},
            '',
            dashboardUrl(race.raceId, participantId, comparisonSetFromParams(params))
          );
          renderRacerHistory(racerHistory);
        },
        onSearchComparisonRiders: async (query) =>
          (await archiveApi.comparisonCandidates(normalizedName, query)).riders ?? [],
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
        .then(async (racerHistory) => {
          if (thisRequest === requestId) await renderRacerHistory(racerHistory);
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
