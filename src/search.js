import { archiveApi, archivedRaceFromResponse } from './api.js';

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
        <form data-slot="raceForm" class="race-form">
          <input type="search" data-slot="raceInput" placeholder="Search archived races" autocomplete="off" />
          <button type="submit">Search archive</button>
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

function errorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function renderSearch(
  container,
  { prefillRaceInput, race, notice, onSelect, api = archiveApi } = {}
) {
  container.innerHTML = TEMPLATE;
  const slot = (name) => container.querySelector(`[data-slot="${name}"]`);

  if (notice) {
    slot('noticeText').textContent = notice;
    slot('notice').hidden = false;
  }
  slot('noticeDismiss').addEventListener('click', () => {
    slot('notice').hidden = true;
  });

  let allResults = [];
  let currentRaceId = null;
  let currentRace = null;
  let requestId = 0;

  function showLoadedRace(loadedRace) {
    const { raceId, raceMeta, allResults: results } = loadedRace;
    currentRace = loadedRace;
    allResults = results;
    currentRaceId = raceId;
    slot('raceInput').value = raceId;
    slot('raceName').textContent = raceMeta.raceName;
    slot('participantSection').hidden = false;
    slot('participantInput').value = '';
    slot('participantList').innerHTML = '';
    slot('participantError').hidden = true;
    slot('archiveSection').hidden = true;
    slot('raceForm').hidden = true;
    slot('changeRace').hidden = false;
    slot('participantInput').focus();
  }

  function renderCatalog(races) {
    const list = slot('archiveList');
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
          const response = await api.sourceRace(catalogRace.id);
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

  async function searchCatalog(query) {
    const thisRequest = ++requestId;
    const errorEl = slot('raceError');
    const submitButton = slot('raceForm').querySelector('button[type="submit"]');
    errorEl.hidden = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Searching…';
    try {
      const { races } = await api.search(query);
      if (thisRequest !== requestId) return;
      renderCatalog(races);
    } catch (error) {
      if (thisRequest !== requestId) return;
      console.error(error);
      errorEl.textContent = errorMessage(error, "Couldn't search the race archive.");
      errorEl.hidden = false;
    } finally {
      if (thisRequest === requestId) {
        submitButton.disabled = false;
        submitButton.textContent = 'Search archive';
      }
    }
  }

  slot('raceForm').addEventListener('submit', (event) => {
    event.preventDefault();
    searchCatalog(slot('raceInput').value);
  });

  slot('showIngest').addEventListener('click', () => {
    slot('ingestForm').hidden = false;
    slot('showIngest').hidden = true;
    slot('ingestInput').focus();
  });

  slot('ingestForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = slot('ingestInput').value;
    const errorEl = slot('ingestError');
    const submitButton = slot('ingestForm').querySelector('button[type="submit"]');
    const thisRequest = ++requestId;
    errorEl.hidden = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Adding…';
    try {
      const response = await api.ingest(input);
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

  slot('changeRace').addEventListener('click', () => {
    currentRace = null;
    slot('archiveSection').hidden = false;
    slot('participantSection').hidden = true;
    slot('changeRace').hidden = true;
    slot('raceForm').hidden = false;
    slot('raceInput').value = '';
    slot('raceInput').focus();
    searchCatalog('');
  });

  function renderMatches(query) {
    const list = slot('participantList');
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
      button.addEventListener('click', () => onSelect(currentRaceId, result.id, currentRace));
      item.appendChild(button);
      list.appendChild(item);
    });
  }

  slot('participantInput').addEventListener('input', (event) => renderMatches(event.target.value));

  if (race) {
    showLoadedRace(race);
  } else {
    if (prefillRaceInput) slot('raceInput').value = prefillRaceInput;
    searchCatalog(prefillRaceInput ?? '');
  }
}
