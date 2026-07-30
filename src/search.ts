import { archiveApi, archivedRaceFromResponse, type ArchiveApi } from './api.js';
import type { ArchiveCatalogRace, ArchivedRace, RaceEntry, RacerSearchResult } from './domain.js';

const TEMPLATE = `
  <div class="viz-root">
    <div class="wrap">
      <div class="masthead">
        <p class="eyebrow">Enduro Breakdown</p>
        <h1>Find your enduro result</h1>
        <p class="subhead">Search the shared race archive, or add a supported race link.</p>
      </div>

      <div class="notice" data-slot="notice" role="alert" hidden>
        <p data-slot="noticeText"></p>
        <button type="button" data-slot="noticeDismiss" aria-label="Dismiss">&times;</button>
      </div>

      <div data-slot="archiveSection">
        <form data-slot="racerForm" class="race-form">
          <input
            type="search"
            data-slot="racerSearchInput"
            placeholder="Search riders across all archived races"
            autocomplete="off"
          />
        </form>
        <p class="form-error" data-slot="racerSearchError" role="alert" hidden></p>
        <ul class="participant-list" data-slot="racerSearchList"></ul>

        <h2 class="section-heading">Archived races</h2>
        <form data-slot="raceForm" class="race-form">
          <input type="search" data-slot="raceInput" placeholder="Filter archived races" autocomplete="off" />
        </form>
        <p class="form-error" data-slot="raceError" role="alert" hidden></p>
        <ul class="archive-list" data-slot="archiveList"></ul>

        <button type="button" class="change-race" data-slot="showIngest">Paste a new race link</button>
        <form data-slot="ingestForm" class="race-form ingest-form" hidden>
          <input
            type="text"
            data-slot="ingestInput"
            placeholder="LiveLaps or Moto-Tally link, or LiveLaps race ID"
            autocomplete="off"
          />
          <button type="submit">Add race</button>
        </form>
        <p class="form-error" data-slot="ingestError" role="alert" hidden></p>
      </div>

      <button type="button" class="change-race" data-slot="changeRace" hidden>Choose a different race</button>

      <div data-slot="participantSection" hidden>
        <p class="card-sub" data-slot="raceName"></p>
        <input type="text" data-slot="participantInput" placeholder="Search by name or bib number" autocomplete="off" />
        <p class="form-error" data-slot="participantError" role="alert" hidden></p>
        <ul class="participant-list" data-slot="participantList"></ul>
      </div>
    </div>
  </div>
`;

export type RenderSearchOptions = {
  prefillRaceInput?: string;
  race?: ArchivedRace;
  notice?: string;
  onSelect?: (raceId: string, participantId: string | number | null, race: ArchivedRace) => void | Promise<void>;
  onSelectRacer?: (normalizedName: string, fullName: string) => void | Promise<void>;
  api?: Partial<ArchiveApi>;
  debounceMs?: number;
};

function requireElement<T extends Element>(value: T | null, label: string): T {
  if (!value) throw new Error(`Missing search element: ${label}`);
  return value;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function renderSearch(
  container: HTMLElement,
  { prefillRaceInput, race, notice, onSelect, onSelectRacer, api = archiveApi, debounceMs = 200 }: RenderSearchOptions = {}
): void {
  container.innerHTML = TEMPLATE;
  const slot = <T extends HTMLElement = HTMLElement>(name: string): T =>
    requireElement(container.querySelector<T>(`[data-slot="${name}"]`), name);

  const resolvedApi: ArchiveApi = { ...archiveApi, ...api };

  if (notice) {
    slot('noticeText').textContent = notice;
    slot('notice').hidden = false;
  }
  slot<HTMLButtonElement>('noticeDismiss').addEventListener('click', () => {
    slot('notice').hidden = true;
  });

  let allResults: RaceEntry[] = [];
  let currentRaceId: string | null = null;
  let currentRace: ArchivedRace | null = null;
  let requestId = 0;

  function showLoadedRace(loadedRace: ArchivedRace): void {
    const { raceId, raceMeta, allResults: results } = loadedRace;
    currentRace = loadedRace;
    allResults = results;
    currentRaceId = raceId;
    slot<HTMLInputElement>('raceInput').value = raceId;
    slot('raceName').textContent = raceMeta.raceName;
    slot('participantSection').hidden = false;
    slot<HTMLInputElement>('participantInput').value = '';
    slot('participantList').innerHTML = '';
    slot('participantError').hidden = true;
    slot('archiveSection').hidden = true;
    slot<HTMLFormElement>('raceForm').hidden = true;
    slot<HTMLButtonElement>('changeRace').hidden = false;
    slot<HTMLInputElement>('participantInput').focus();
  }

  function renderCatalog(races: readonly ArchiveCatalogRace[]): void {
    const list = slot<HTMLUListElement>('archiveList');
    list.innerHTML = '';
    if (races.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'archive-empty';
      empty.textContent = 'No archived races match that search.';
      list.appendChild(empty);
      return;
    }

    races.forEach((catalogRace) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      const title = document.createElement('span');
      const meta = document.createElement('span');
      button.type = 'button';
      title.className = 'archive-race-name';
      title.textContent = catalogRace.raceName;
      meta.className = 'archive-race-meta';
      meta.textContent = [catalogRace.eventDate, catalogRace.provider, catalogRace.location]
        .filter(Boolean)
        .join(' · ');
      button.append(title, meta);
      button.addEventListener('click', async () => {
        const thisRequest = ++requestId;
        slot('raceError').hidden = true;
        button.disabled = true;
        try {
          const response = await resolvedApi.sourceRace(catalogRace.id);
          if (thisRequest !== requestId) return;
          showLoadedRace(archivedRaceFromResponse(response));
        } catch (error) {
          if (thisRequest !== requestId) return;
          console.error(error);
          slot('raceError').textContent = errorMessage(error, "Couldn't load that archived race.");
          slot('raceError').hidden = false;
        } finally {
          if (thisRequest === requestId) button.disabled = false;
        }
      });
      item.appendChild(button);
      list.appendChild(item);
    });
  }

  // Search-as-you-type: catalog queries are cheap, but debounce keystrokes and
  // let requestId drop any response that arrives out of order.
  function debounced<T extends unknown[]>(fn: (...args: T) => void | Promise<void>): (...args: T) => void {
    let timer: NodeJS.Timeout | undefined;
    return (...args: T): void => {
      clearTimeout(timer);
      timer = setTimeout(() => void fn(...args), debounceMs);
    };
  }

  async function searchCatalog(query: string): Promise<void> {
    const thisRequest = ++requestId;
    const errorEl = slot('raceError');
    errorEl.hidden = true;
    try {
      const { races } = await resolvedApi.search(query);
      if (thisRequest !== requestId) return;
      renderCatalog(races);
    } catch (error) {
      if (thisRequest !== requestId) return;
      console.error(error);
      errorEl.textContent = errorMessage(error, "Couldn't search the race archive.");
      errorEl.hidden = false;
    }
  }

  const searchCatalogDebounced = debounced(searchCatalog);
  slot<HTMLInputElement>('raceInput').addEventListener('input', (event) => searchCatalogDebounced((event.currentTarget as HTMLInputElement).value));
  slot<HTMLFormElement>('raceForm').addEventListener('submit', (event) => {
    event.preventDefault();
    searchCatalog(slot<HTMLInputElement>('raceInput').value);
  });

  function renderRacerMatches(racers: readonly RacerSearchResult[]): void {
    const list = slot<HTMLUListElement>('racerSearchList');
    list.innerHTML = '';
    racers.forEach((racer) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${racer.fullName} · ${racer.raceCount} ${racer.raceCount === 1 ? 'race' : 'races'}`;
      button.addEventListener('click', () => onSelectRacer?.(racer.normalizedName, racer.fullName));
      item.appendChild(button);
      list.appendChild(item);
    });
  }

  async function searchRacers(query: string): Promise<void> {
    const thisRequest = ++requestId;
    const errorEl = slot('racerSearchError');
    errorEl.hidden = true;
    if (!query.trim()) {
      slot('racerSearchList').innerHTML = '';
      return;
    }
    try {
      const { racers } = await resolvedApi.racers(query);
      if (thisRequest !== requestId) return;
      if (racers.length === 0) {
        errorEl.textContent = `No riders match '${query}' in the archive.`;
        errorEl.hidden = false;
        slot('racerSearchList').innerHTML = '';
        return;
      }
      renderRacerMatches(racers);
    } catch (error) {
      if (thisRequest !== requestId) return;
      console.error(error);
      errorEl.textContent = errorMessage(error, "Couldn't search riders.");
      errorEl.hidden = false;
    }
  }

  const searchRacersDebounced = debounced(searchRacers);
  slot<HTMLInputElement>('racerSearchInput').addEventListener('input', (event) =>
    searchRacersDebounced((event.currentTarget as HTMLInputElement).value)
  );
  slot<HTMLFormElement>('racerForm').addEventListener('submit', (event) => {
    event.preventDefault();
    searchRacers(slot<HTMLInputElement>('racerSearchInput').value);
  });

  slot<HTMLButtonElement>('showIngest').addEventListener('click', () => {
    slot<HTMLFormElement>('ingestForm').hidden = false;
    slot<HTMLButtonElement>('showIngest').hidden = true;
    slot<HTMLInputElement>('ingestInput').focus();
  });

  slot<HTMLFormElement>('ingestForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = slot<HTMLInputElement>('ingestInput').value;
    const errorEl = slot('ingestError');
    const submitButton = requireElement(slot<HTMLFormElement>('ingestForm').querySelector<HTMLButtonElement>('button[type="submit"]'), 'ingest submit');
    const thisRequest = ++requestId;
    errorEl.hidden = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Adding…';
    try {
      const response = await resolvedApi.ingest(input);
      if (thisRequest !== requestId) return;
      showLoadedRace(archivedRaceFromResponse(response));
    } catch (error) {
      if (thisRequest !== requestId) return;
      console.error(error);
      errorEl.textContent = errorMessage(error, "Couldn't add that race — check the link and try again.");
      errorEl.hidden = false;
    } finally {
      if (thisRequest === requestId) {
        submitButton.disabled = false;
        submitButton.textContent = 'Add race';
      }
    }
  });

  slot<HTMLButtonElement>('changeRace').addEventListener('click', () => {
    currentRace = null;
    slot('archiveSection').hidden = false;
    slot('participantSection').hidden = true;
    slot<HTMLButtonElement>('changeRace').hidden = true;
    slot<HTMLFormElement>('raceForm').hidden = false;
    slot<HTMLInputElement>('raceInput').value = '';
    slot<HTMLInputElement>('raceInput').focus();
    searchCatalog('');
  });

  function renderMatches(query: string): void {
    const list = slot<HTMLUListElement>('participantList');
    list.innerHTML = '';
    const errorEl = slot('participantError');
    const trimmed = query.trim().toLowerCase();

    if (!trimmed) {
      errorEl.hidden = true;
      return;
    }

    const matches = allResults.filter(
      (result) =>
        result.fullName.toLowerCase().includes(trimmed) ||
        String(result.displayedNumber ?? '').toLowerCase().includes(trimmed)
    );

    if (matches.length === 0) {
      errorEl.textContent = `No one matches '${query}' in this race.`;
      errorEl.hidden = false;
      return;
    }
    errorEl.hidden = true;

    matches.forEach((result) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${result.fullName} - ${result.displayedNumber}`;
      button.addEventListener('click', () => {
        if (currentRaceId !== null && currentRace !== null) onSelect?.(currentRaceId, result.id, currentRace);
      });
      item.appendChild(button);
      list.appendChild(item);
    });
  }

  slot<HTMLInputElement>('participantInput').addEventListener('input', (event) => renderMatches((event.currentTarget as HTMLInputElement).value));

  if (race) {
    showLoadedRace(race);
  } else {
    if (prefillRaceInput) slot<HTMLInputElement>('raceInput').value = prefillRaceInput;
    searchCatalog(prefillRaceInput ?? '');
  }
}
