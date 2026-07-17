import {
  resolveAndLoadRace,
  UnparseableInputError,
  MultiRaceEventError,
  UnsupportedFormatError
} from './raceSource.js';

const TEMPLATE = `
  <div class="viz-root">
    <div class="wrap">
      <div class="masthead">
        <p class="eyebrow">Enduro Breakdown</p>
        <h1>Find your enduro result</h1>
        <p class="subhead">Paste a LiveLaps or Moto-Tally results link, or a bare LiveLaps race ID.</p>
      </div>

      <div class="notice" data-slot="notice" role="alert" hidden>
        <p data-slot="noticeText"></p>
        <button type="button" data-slot="noticeDismiss" aria-label="Dismiss">&times;</button>
      </div>

      <form data-slot="raceForm" class="race-form">
        <input type="text" data-slot="raceInput" placeholder="LiveLaps or Moto-Tally link, or 79103" autocomplete="off" />
        <button type="submit">Look up race</button>
      </form>
      <button type="button" class="change-race" data-slot="changeRace" hidden>Use a different race</button>

      <p class="form-error" data-slot="raceError" role="alert" hidden></p>

      <div data-slot="participantSection" hidden>
        <p class="card-sub" data-slot="raceName"></p>
        <input type="text" data-slot="participantInput" placeholder="Search by name or bib number" autocomplete="off" />
        <p class="form-error" data-slot="participantError" role="alert" hidden></p>
        <ul class="participant-list" data-slot="participantList"></ul>
      </div>
    </div>
  </div>
`;

export function renderSearch(container, { prefillRaceInput, race, notice, onSelect } = {}) {
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
  let currentRaceMeta = null;

  function showLoadedRace({ raceId, raceMeta, allResults: results }) {
    allResults = results;
    currentRaceId = raceId;
    currentRaceMeta = raceMeta;
    slot('raceInput').value = raceId;
    slot('raceName').textContent = raceMeta.raceName;
    slot('participantSection').hidden = false;
    slot('participantInput').value = '';
    slot('participantList').innerHTML = '';
    slot('participantError').hidden = true;
    slot('raceForm').hidden = true;
    slot('changeRace').hidden = false;
    slot('participantInput').focus();
  }

  if (race) {
    showLoadedRace(race);
  } else if (prefillRaceInput) {
    slot('raceInput').value = prefillRaceInput;
  }

  let requestId = 0;

  slot('raceForm').addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const input = slot('raceInput').value;
    const errorEl = slot('raceError');
    const submitButton = slot('raceForm').querySelector('button[type="submit"]');
    errorEl.hidden = true;
    const thisRequest = ++requestId;
    submitButton.disabled = true;
    submitButton.textContent = 'Looking up…';

    try {
      const { raceId, raceMeta, allResults: results } = await resolveAndLoadRace(input);
      if (thisRequest !== requestId) return;
      showLoadedRace({ raceId, raceMeta, allResults: results });
    } catch (err) {
      if (thisRequest !== requestId) return;
      console.error(err);
      if (
        err instanceof UnparseableInputError ||
        err instanceof MultiRaceEventError ||
        err instanceof UnsupportedFormatError
      ) {
        errorEl.textContent = err.message;
      } else {
        errorEl.textContent = "Couldn't load that race — check the link and try again.";
      }
      errorEl.hidden = false;
    } finally {
      if (thisRequest === requestId) {
        submitButton.disabled = false;
        submitButton.textContent = 'Look up race';
      }
    }
  });

  slot('changeRace').addEventListener('click', () => {
    slot('raceForm').hidden = false;
    slot('changeRace').hidden = true;
    slot('raceInput').focus();
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
      (r) => r.fullName.toLowerCase().includes(trimmed) || r.displayedNumber.toLowerCase().includes(trimmed)
    );

    if (matches.length === 0) {
      errorEl.textContent = `No one matches '${query}' in this race.`;
      errorEl.hidden = false;
      return;
    }
    errorEl.hidden = true;

    matches.forEach((r) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${r.fullName} - ${r.displayedNumber}`;
      button.addEventListener('click', () =>
        onSelect(currentRaceId, r.id, { raceId: currentRaceId, raceMeta: currentRaceMeta, allResults })
      );
      li.appendChild(button);
      list.appendChild(li);
    });
  }

  slot('participantInput').addEventListener('input', (evt) => renderMatches(evt.target.value));
}
