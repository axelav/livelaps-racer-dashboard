import { describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { createArchive } from '../../server/archive/repository.js';
import { openDatabase } from '../../server/archive/database.js';
import {
  ECEA_ENDURO_CALENDAR_URL,
  backfillMotoTallyArchive,
  createCachedMotoTallyFetch,
  discoverMotoTallyCalendarEvents,
  parseBackfillArgs
} from '../../server/backfill/mototally.js';

const O1_URL = 'https://www.moto-tally.com/ECEA/Enduro/Results.aspx/2024/1/O1/CS';
const O5_URL = 'https://www.moto-tally.com/ECEA/Enduro/Results.aspx/2024/1/O5/CS';
const ROUND2_O1_URL = 'https://www.moto-tally.com/ECEA/Enduro/Results.aspx/2024/2/O1/CS';

type FetchInput = Parameters<typeof fetch>[0];
type OverallGroup = string | { value: string; label: string };
type MotoTallyBackfillArgs = {
  sinceYear: number;
  dbPath: string;
  delayMs: number;
};

function inputUrl(input: FetchInput): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
}

function responseText(text: string, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => text } as Response;
}

function calendarHtml() {
  return `
<h2>2025 Race Results</h2>
<table><tr><th>Race#</th><th>Event Name</th><th>Location</th><th>Sponsors/Club</th><th>Date</th><th>Results</th></tr>
<tr><td>1</td><td>Future Enduro</td><td>NJ</td><td>TCSMC</td><td>03/09/2025</td><td><a href="javascript:selectEvent(2025,1);">RESULTS</a></td></tr>
</table>
<h2>2024 Race Results</h2>
<table><tr><th>Race#</th><th>Event Name</th><th>Location</th><th>Sponsors/Club</th><th>Date</th><th>Results</th></tr>
<tr><td>1</td><td>Greenbrier Enduro</td><td>Port Elizabeth, NJ</td><td>TCSMC</td><td>03/10/2024</td><td><a href="javascript:selectEvent(2024,1);">RESULTS</a></td></tr>
<tr><td>2</td><td>Cancelled Enduro</td><td>Shamong, NJ</td><td>SJER</td><td>03/17/2024</td><td></td></tr>
</table>
<h2>2023 Race Results</h2>
<table><tr><th>Race#</th><th>Event Name</th><th>Location</th><th>Sponsors/Club</th><th>Date</th><th>Results</th></tr>
<tr><td>9</td><td>Old Enduro</td><td>PA</td><td>BER</td><td>07/23/2023</td><td><a href="javascript:selectEvent(2023,9);">RESULTS</a></td></tr>
</table>`;
}

function resultHtml({
  name = '2024 Greenbrier Enduro',
  groups = [{ value: 'O1', label: 'OVERALL Long Course' }],
  ama = 111
}: { name?: string; groups?: OverallGroup[]; ama?: number } = {}) {
  const options = groups
    .map((group) => {
      const value = typeof group === 'string' ? group : group.value;
      const label = typeof group === 'string' ? `OVERALL ${group}` : group.label;
      return `<option value="${value}">${label}</option>`;
    })
    .join('');
  return `
<h1 id="mtR_h1RREventName">${name}</h1>
<select id="mtR_ddlSelectClass">${options}<option value="C1">AA</option></select>
<table id="mtR_gvResults" cellspacing="1" border="0">
<tr><td colspan="13">Check-by-Check Score by Place</td></tr>
<tr><td>EventPlace</td><td>AMA#</td><td>Row</td><td>Rider Name</td><td>Club</td><td>Sponsors</td><td>Brand</td><td>Class</td><td>1</td><td>2</td><td>3</td><td>MaxChk</td><td>TotalTime</td></tr>
<tr class="gvR"><td>1</td><td>${ama}</td><td>1A</td><td><a href="javascript:getRiderDetail(1);">RIDER ${ama}</a></td><td>&nbsp;</td><td>&nbsp;</td><td><span class='bb KTM'>KTM</span></td><td>AA</td><td>1:00<span style='font-size:6pt'> (1)</span></td><td>0</td><td>1:00<span style='font-size:6pt'> (1)</span></td><td>2</td><td>6:00</td></tr>
</table>`;
}

describe('parseBackfillArgs', () => {
  it('treats a positional year as the inclusive since-year cutoff', () => {
    expect(parseBackfillArgs(['2024'], { ENDURO_DB_PATH: '/tmp/enduro.db' }) as MotoTallyBackfillArgs).toEqual({
      sinceYear: 2024,
      dbPath: '/tmp/enduro.db',
      delayMs: 2000
    });
  });

  it('ignores the npm argument separator before named flags', () => {
    expect(parseBackfillArgs(['--', '--since-year', '2027', '--db', ':memory:'], {}) as MotoTallyBackfillArgs).toEqual({
      sinceYear: 2027,
      dbPath: ':memory:',
      delayMs: 2000
    });
  });
});

describe('discoverMotoTallyCalendarEvents', () => {
  it('discovers only result-bearing ECEA Enduro calendar rows at or after the cutoff', () => {
    const doc = parseHTML(calendarHtml()).document;

    expect(discoverMotoTallyCalendarEvents(doc, { sinceYear: 2024, currentYear: 2024 })).toEqual([
      { org: 'ECEA', discipline: 'Enduro', year: '2024', round: '1' }
    ]);
  });
});

describe('createCachedMotoTallyFetch', () => {
  it('serializes uncached requests with delay and reuses cached responses without waiting', async () => {
    let now = 1_000;
    const waits: number[] = [];
    const upstream = vi.fn(async (url: FetchInput): Promise<Response> => responseText(`body:${inputUrl(url)}`));
    const fetchImpl = createCachedMotoTallyFetch({
      fetchImpl: upstream,
      delayMs: 2000,
      now: () => now,
      wait: async (ms: number): Promise<void> => {
        waits.push(ms);
        now += ms;
      }
    });

    await expect(fetchImpl('https://example.test/a', undefined).then((r) => r.text())).resolves.toBe(
      'body:https://example.test/a'
    );
    await expect(fetchImpl('https://example.test/a', undefined).then((r) => r.text())).resolves.toBe(
      'body:https://example.test/a'
    );
    await expect(fetchImpl('https://example.test/b', undefined).then((r) => r.text())).resolves.toBe(
      'body:https://example.test/b'
    );

    expect(upstream).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([2000]);
  });
});

describe('backfillMotoTallyArchive', () => {
  it('archives course overall groups and skips A B C category overall pages', async () => {
    const db = openDatabase(':memory:');
    const archive = createArchive(db);
    const groups = [
      { value: 'O1', label: 'OVERALL Long Course' },
      { value: 'O2', label: 'OVERALL A' },
      { value: 'O3', label: 'OVERALL B' },
      { value: 'O4', label: 'OVERALL C' },
      { value: 'O5', label: 'Overall Short' }
    ];
    const upstream = vi.fn(async (url: FetchInput): Promise<Response> => {
      const href = inputUrl(url);
      if (href === ECEA_ENDURO_CALENDAR_URL) return responseText(calendarHtml());
      if (href === O1_URL) return responseText(resultHtml({ groups, ama: 111 }));
      if (href === O5_URL) return responseText(resultHtml({ groups, ama: 555 }));
      throw new Error(`Unexpected URL: ${href}`);
    });

    const summary = await backfillMotoTallyArchive({
      archive,
      fetchImpl: upstream,
      parseHtml: (html: string) => parseHTML(html).document,
      sinceYear: 2024,
      currentYear: 2024,
      delayMs: 0,
      capturedAt: () => '2024-03-12T00:00:00.000Z'
    });

    expect(summary).toMatchObject({
      discoveredEvents: 1,
      discoveredSourceRaces: 2,
      saved: 2,
      skipped: 0,
      failures: []
    });
    expect(archive.getCurrentSnapshot('mototally:ECEA/Enduro/2024/1/O1')).not.toBeNull();
    expect(archive.getCurrentSnapshot('mototally:ECEA/Enduro/2024/1/O2')).toBeNull();
    expect(archive.getCurrentSnapshot('mototally:ECEA/Enduro/2024/1/O3')).toBeNull();
    expect(archive.getCurrentSnapshot('mototally:ECEA/Enduro/2024/1/O4')).toBeNull();
    expect(archive.getCurrentSnapshot('mototally:ECEA/Enduro/2024/1/O5')).not.toBeNull();
    db.close();
  });

  it('skips existing source races without refetching them and archives missing O groups', async () => {
    const db = openDatabase(':memory:');
    const archive = createArchive(db);
    archive.saveSnapshot(
      {
        sourceRace: {
          provider: 'mototally',
          sourceRaceId: 'ECEA/Enduro/2024/1/O1',
          canonicalUrl: O1_URL,
          raceName: '2024 Greenbrier Enduro — O1',
          modeName: 'Enduro',
          eventDate: '2024-03-10',
          location: 'Port Elizabeth, NJ',
          organizer: 'TCSMC'
        },
        normalized: { raceMeta: { raceName: '2024 Greenbrier Enduro — O1', modeName: 'Enduro' }, allResults: [] },
        artifact: { mimeType: 'text/html', text: resultHtml({ groups: ['O1', 'O5'], ama: 111 }) }
      },
      '2024-03-11T00:00:00.000Z'
    );
    const upstream = vi.fn(async (url: FetchInput): Promise<Response> => {
      const href = inputUrl(url);
      if (href === ECEA_ENDURO_CALENDAR_URL) return responseText(calendarHtml());
      if (href === O1_URL) throw new Error('existing O1 should not be fetched');
      if (href === O5_URL) return responseText(resultHtml({ groups: ['O1', 'O5'], ama: 555 }));
      throw new Error(`Unexpected URL: ${href}`);
    });

    const summary = await backfillMotoTallyArchive({
      archive,
      fetchImpl: upstream,
      parseHtml: (html: string) => parseHTML(html).document,
      sinceYear: 2024,
      currentYear: 2024,
      delayMs: 0,
      capturedAt: () => '2024-03-12T00:00:00.000Z'
    });

    expect(summary).toMatchObject({ discoveredEvents: 1, saved: 1, skipped: 1, failures: [] });
    expect(archive.getCurrentSnapshot('mototally:ECEA/Enduro/2024/1/O1')?.capturedAt).toBe(
      '2024-03-11T00:00:00.000Z'
    );
    expect(archive.getCurrentSnapshot('mototally:ECEA/Enduro/2024/1/O5')).toMatchObject({
      capturedAt: '2024-03-12T00:00:00.000Z',
      sourceRace: { sourceRaceId: 'ECEA/Enduro/2024/1/O5' }
    });
    expect(upstream).not.toHaveBeenCalledWith(O1_URL);
    db.close();
  });

  it('continues after a failed source race and reports a non-empty failure summary', async () => {
    const db = openDatabase(':memory:');
    const archive = createArchive(db);
    const upstream = vi.fn(async (url: FetchInput): Promise<Response> => {
      const href = inputUrl(url);
      if (href === ECEA_ENDURO_CALENDAR_URL) {
        return responseText(calendarHtml().replace('</table>', '<tr><td>2</td><td>Bad Enduro</td><td>PA</td><td>BAD</td><td>04/10/2024</td><td><a href="javascript:selectEvent(2024,2);">RESULTS</a></td></tr></table>'));
      }
      if (href === O1_URL) return responseText(resultHtml({ groups: ['O1'], ama: 111 }));
      if (href === ROUND2_O1_URL) return responseText('missing table', 500);
      throw new Error(`Unexpected URL: ${href}`);
    });

    const summary = await backfillMotoTallyArchive({
      archive,
      fetchImpl: upstream,
      parseHtml: (html: string) => parseHTML(html).document,
      sinceYear: 2024,
      currentYear: 2024,
      delayMs: 0,
      capturedAt: () => '2024-03-12T00:00:00.000Z'
    });

    expect(summary.saved).toBe(1);
    expect(summary.failures).toEqual([
      expect.objectContaining({ sourceRaceId: 'ECEA/Enduro/2024/2/O1' })
    ]);
    expect(archive.getCurrentSnapshot('mototally:ECEA/Enduro/2024/1/O1')).not.toBeNull();
    db.close();
  });
});
