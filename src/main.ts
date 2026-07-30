import './style.css';
import { ArchiveRequestError, archiveApi, archivedRaceFromResponse } from './api.js';
import { renderSearch, type RenderSearchOptions } from './search.js';
import { renderDashboard, type DashboardRacer } from './dashboard.js';
import { normalizeRacerName, renderHistory } from './history.js';
import type { ArchivedRace, RaceEntry, RacerHistory } from './domain.js';

const appRoot = document.getElementById('app');
if (!appRoot) throw new Error('Missing app root.');
const app: HTMLElement = appRoot;

let requestId = 0;
let activeRace: ArchivedRace | null = null;

type RouteParams = {
  raceId: string | null;
  participantId: string | null;
  ingestInput: string | undefined;
};

type DashboardTotals = {
  racer: DashboardRacer;
  fieldSize: number;
  classSize: number;
};

function currentParams(): RouteParams {
  const params = new URLSearchParams(window.location.search);
  const requestedRaceId = params.get('race');
  const legacyPathRaceId = window.location.pathname.match(
    /\/race\/(?:results|filters|config)\/(\d+)(?:\/|$)/
  )?.[1];
  const legacyRaceId = /^\d+$/.test(requestedRaceId ?? '')
    ? requestedRaceId ?? undefined
    : legacyPathRaceId;

  return {
    raceId: legacyRaceId ? `livelaps:${legacyRaceId}` : requestedRaceId,
    participantId: params.get('id'),
    ingestInput: legacyRaceId
  };
}

async function loadArchivedRace(raceId: string, ingestInput?: string): Promise<ArchivedRace> {
  try {
    return archivedRaceFromResponse(await archiveApi.sourceRace(raceId));
  } catch (error) {
    if (!ingestInput || !(error instanceof ArchiveRequestError) || error.status !== 404) throw error;
    return archivedRaceFromResponse(await archiveApi.ingest(ingestInput));
  }
}

function isDashboardRacer(entry: RaceEntry): entry is DashboardRacer {
  if (
    entry.id == null ||
    entry.displayedNumber == null ||
    entry.brand == null ||
    entry.className == null ||
    entry.overallPosition == null ||
    entry.classPosition == null ||
    !Array.isArray(entry.sections)
  ) {
    return false;
  }

  if (entry.scoring === 'points') {
    return (
      entry.maxChk != null &&
      entry.checkCount != null &&
      entry.timedCheckCount != null &&
      entry.pointsBehindOverallLeader != null &&
      entry.pointsBehindClassLeader != null &&
      entry.sections.every((section) => 'cumPoints' in section)
    );
  }

  return entry.sections.every((section) => 'totalCumulatedTime' in section);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function requireElement<T extends Element>(value: T | null, label: string): T {
  if (!value) throw new Error(`Missing app element: ${label}`);
  return value;
}

function deriveTotals(allResults: readonly RaceEntry[], participantId: string | number | null): DashboardTotals | null {
  const racer = allResults.find((result) => String(result.id) === String(participantId));
  if (!racer || !isDashboardRacer(racer)) return null;
  const classSize = allResults.filter((result) => result.className === racer.className).length;
  return { racer, fieldSize: allResults.length, classSize };
}

function showSearch(options: RenderSearchOptions = {}): void {
  renderSearch(app, {
    ...options,
    api: archiveApi,
    onSelect(raceId, participantId, race) {
      activeRace = race;
      history.pushState(
        {},
        '',
        `?race=${encodeURIComponent(raceId)}&id=${encodeURIComponent(String(participantId))}`
      );
      void showDashboard(raceId, participantId, race);
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
          `?race=${encodeURIComponent(race.raceId)}&id=${encodeURIComponent(String(racer.id))}`
        );
        await showDashboard(race.raceId, racer.id, race, undefined, racerHistory);
      } catch (error) {
        if (thisRequest !== requestId) return;
        console.error(error);
        showSearch({ notice: errorMessage(error, "Couldn't load that rider's history.") });
      }
    }
  });
}

// Home always means the clean search page — never a leftover loaded race.
function showSearchDefault(): void {
  ++requestId;
  activeRace = null;
  history.pushState({}, '', window.location.pathname);
  showSearch();
}

async function showDashboard(
  raceId: string,
  participantId: string | number | null,
  loadedRace?: ArchivedRace,
  ingestInput?: string,
  knownHistory?: RacerHistory
): Promise<void> {
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
      `?race=${encodeURIComponent(race.raceId)}&id=${encodeURIComponent(String(participantId))}`
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
    requireElement(app.querySelector<HTMLButtonElement>('[data-slot="home"]'), 'home').addEventListener('click', showSearchDefault);
    const historyPanel = requireElement(app.querySelector<HTMLElement>('[data-slot="historyPanel"]'), 'historyPanel');
    const detailPanel = requireElement(app.querySelector<HTMLElement>('[data-slot="detailPanel"]'), 'detailPanel');
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

    const renderRacerHistory = (racerHistory: RacerHistory): void => {
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
            window.alert(errorMessage(error, "Couldn't load that archived race."));
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
        .catch((error: unknown) => {
          if (thisRequest !== requestId) return;
          console.error(error);
          historyPanel.textContent = 'History is unavailable. Race detail remains available.';
        });
    }
  } catch (error) {
    if (thisRequest !== requestId) return;
    console.error(error);
    history.replaceState({}, '', window.location.pathname);
    showSearch({ notice: errorMessage(error, "Couldn't load that archived race.") });
  }
}

async function showRaceSearch(raceId: string, ingestInput?: string): Promise<void> {
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
    showSearch({ notice: errorMessage(error, "Couldn't load that archived race.") });
  }
}

function route(): void {
  const { raceId, participantId, ingestInput } = currentParams();
  if (raceId && participantId) {
    void showDashboard(raceId, participantId, undefined, ingestInput);
  } else if (raceId) {
    void showRaceSearch(raceId, ingestInput);
  } else {
    showSearch();
  }
}

window.addEventListener('popstate', route);
route();
