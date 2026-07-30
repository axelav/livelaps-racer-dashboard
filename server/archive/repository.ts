import Database from 'better-sqlite3';
import type {
  HistoryEntry,
  LoadedRace,
  NormalizedRace,
  Provider,
  RaceEntry,
  RaceSection,
  Snapshot,
  SourceRace
} from '../../src/domain.js';
import { compressArtifact, decompressArtifact } from '../compression.js';
import { normalizeRacerName } from './history.js';

type SqliteDatabase = Database.Database;
type SqliteId = number | bigint;

type ArchiveRaceEntry = Omit<
  RaceEntry,
  'id' | 'displayedNumber' | 'brand' | 'className' | 'overallPosition' | 'classPosition' | 'sections'
> & {
  id?: string | number | null;
  displayedNumber?: string | number | null;
  brand?: string | null;
  className?: string | null;
  overallPosition?: number | null;
  classPosition?: number | null;
  sections?: RaceSection[];
};

type ArchiveLoadedRace = Omit<LoadedRace, 'normalized'> & {
  normalized: Omit<NormalizedRace, 'allResults'> & { allResults: ArchiveRaceEntry[] };
};

type SourceRaceValues = {
  provider: Provider;
  sourceRaceId: string;
  canonicalUrl: string;
  raceName: string;
  modeName: string;
  eventDate: string | null;
  location: string | null;
  organizer: string | null;
};

type SourceRaceIdRow = { id: number };
type SourceRaceRow = {
  id: number;
  provider: Provider;
  source_race_id: string;
  canonical_url: string;
  race_name: string;
  mode_name: string;
  event_date: string | null;
  location: string | null;
  organizer: string | null;
};

type SnapshotRow = SourceRaceRow & {
  snapshot_id: number;
  captured_at: string;
  artifact_mime_type: string;
  artifact_blob: Buffer;
  normalized_json: string;
};

type CatalogRow = SourceRaceRow & { captured_at: string };

type RacerRow = {
  normalized_name: string;
  full_name: string;
  race_count: number;
};

type HistoryRow = {
  provider: Provider;
  source_race_id: string;
  race_name: string;
  event_date: string | null;
  captured_at: string;
  full_name: string;
  normalized_name: string;
  displayed_number: string | number | null;
  brand: string | null;
  class_name: string | null;
  overall_position: number | null;
  class_position: number | null;
  field_size: number | null;
  class_size: number | null;
  total_time_seconds: number | null;
  entry_json: string;
};

export type CatalogRace = SourceRace & { id: string; capturedAt: string };

export type RacerSearchResult = {
  normalizedName: string;
  fullName: string;
  raceCount: number;
};

export type ArchiveRepository = {
  saveSnapshot(loaded: ArchiveLoadedRace, capturedAt: string): Snapshot;
  getCurrentSnapshot(key: string): Snapshot | null;
  findCatalog(options?: { query?: string; limit?: number }): CatalogRace[];
  findRacers(query: unknown, limit?: number): RacerSearchResult[];
  findHistory(normalizedName: string): HistoryEntry[];
};

function sourceRaceKey(provider: Provider, sourceRaceId: string): string {
  return `${provider}:${sourceRaceId}`;
}

function secondsFromClock(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parts = value.split(':').map(Number);
  const [hours, minutes, seconds] = parts;
  if (
    parts.length !== 3 ||
    hours == null ||
    minutes == null ||
    seconds == null ||
    parts.some((part) => !Number.isFinite(part))
  ) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
}


function timedSectionStorage(section: RaceSection): {
  totalCumulatedTime: string | null;
  avgSpeed: string | number | null;
  overallBehindBy: string | null;
} {
  if (!('totalCumulatedTime' in section)) {
    return { totalCumulatedTime: null, avgSpeed: null, overallBehindBy: null };
  }
  return {
    totalCumulatedTime: section.totalCumulatedTime,
    avgSpeed: section.avgSpeed,
    overallBehindBy: section.overallBehindBy
  };
}
function totalTimeSeconds(entry: ArchiveRaceEntry): number | null {
  const explicitTotal = entry.totalTimeSeconds;
  if (typeof explicitTotal === 'number' && Number.isFinite(explicitTotal)) return explicitTotal;
  const finalSection = entry.sections?.at(-1);
  return finalSection && 'totalCumulatedTime' in finalSection
    ? secondsFromClock(finalSection.totalCumulatedTime)
    : null;
}

function mapSourceRace(row: SourceRaceRow): SourceRace & { id: string } {
  return {
    id: sourceRaceKey(row.provider, row.source_race_id),
    provider: row.provider,
    sourceRaceId: row.source_race_id,
    canonicalUrl: row.canonical_url,
    raceName: row.race_name,
    modeName: row.mode_name,
    eventDate: row.event_date,
    location: row.location,
    organizer: row.organizer
  };
}

function parseNormalizedRace(json: string): NormalizedRace {
  return JSON.parse(json) as NormalizedRace;
}

function parseRaceEntry(json: string): RaceEntry {
  return JSON.parse(json) as RaceEntry;
}

export function createArchive(db: SqliteDatabase): ArchiveRepository {
  const insertSourceRace = db.prepare<SourceRaceValues, SourceRaceIdRow>(`
    INSERT INTO source_races (
      provider, source_race_id, canonical_url, race_name, mode_name,
      event_date, location, organizer
    ) VALUES (
      @provider, @sourceRaceId, @canonicalUrl, @raceName, @modeName,
      @eventDate, @location, @organizer
    )
    ON CONFLICT(provider, source_race_id) DO NOTHING
    RETURNING id
  `);
  const findSourceRace = db.prepare<[Provider, string], SourceRaceIdRow>(
    'SELECT id FROM source_races WHERE provider = ? AND source_race_id = ?'
  );
  const updateSourceRaceMetadata = db.prepare<SourceRaceValues & { id: number }>(`
    UPDATE source_races
    SET canonical_url = @canonicalUrl,
        race_name = @raceName,
        mode_name = @modeName,
        event_date = @eventDate,
        location = @location,
        organizer = @organizer
    WHERE id = @id
  `);
  const insertSnapshot = db.prepare<[number, string, string, Buffer, string]>(`
    INSERT INTO race_snapshots (
      source_race_id, captured_at, artifact_mime_type, artifact_blob, normalized_json
    ) VALUES (?, ?, ?, ?, ?)
  `);
  const insertEntry = db.prepare(`
    INSERT INTO race_entries (
      snapshot_id, source_entry_id, normalized_name, full_name, displayed_number,
      brand, class_name, overall_position, class_position, field_size, class_size,
      total_time_seconds, entry_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSection = db.prepare(`
    INSERT INTO race_sections (
      race_entry_id, section_index, section_name, total_cumulated_time,
      overall_position, class_position, section_overall_position,
      section_class_position, avg_speed, overall_behind_by, section_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const setCurrentSnapshot = db.prepare<[SqliteId, number, string]>(
    `UPDATE source_races
     SET current_snapshot_id = ?
     WHERE id = ?
       AND (
         current_snapshot_id IS NULL
         OR (SELECT captured_at FROM race_snapshots WHERE id = current_snapshot_id) < ?
       )`
  );

  const persistSnapshot = db.transaction(
    (loaded: ArchiveLoadedRace, capturedAt: string, normalizedJson: string, artifactBlob: Buffer): string => {
      const { sourceRace, normalized, artifact } = loaded;
      const sourceRaceValues: SourceRaceValues = {
        provider: sourceRace.provider,
        sourceRaceId: String(sourceRace.sourceRaceId),
        canonicalUrl: sourceRace.canonicalUrl,
        raceName: sourceRace.raceName,
        modeName: sourceRace.modeName,
        eventDate: sourceRace.eventDate ?? null,
        location: sourceRace.location ?? null,
        organizer: sourceRace.organizer ?? null
      };
      const insertedSourceRace = insertSourceRace.get(sourceRaceValues);
      const existingSourceRace = findSourceRace.get(sourceRaceValues.provider, sourceRaceValues.sourceRaceId);
      const sourceId = insertedSourceRace?.id ?? existingSourceRace?.id;
      if (sourceId == null) throw new Error('Unable to load archived source race id.');

      const snapshotId = insertSnapshot.run(
        sourceId,
        capturedAt,
        artifact.mimeType,
        artifactBlob,
        normalizedJson
      ).lastInsertRowid;
      const results = normalized.allResults;
      const fieldSize = results.length;
      const classSizes = new Map<string | null | undefined, number>();
      for (const entry of results) {
        classSizes.set(entry.className, (classSizes.get(entry.className) ?? 0) + 1);
      }

      for (const entry of results) {
        const entryId = insertEntry.run(
          snapshotId,
          entry.id == null ? null : String(entry.id),
          normalizeRacerName(entry.fullName),
          entry.fullName,
          entry.displayedNumber ?? null,
          entry.brand ?? null,
          entry.className ?? null,
          entry.overallPosition ?? null,
          entry.classPosition ?? null,
          fieldSize,
          classSizes.get(entry.className) ?? 0,
          totalTimeSeconds(entry),
          JSON.stringify(entry)
        ).lastInsertRowid;

        for (const [index, section] of (entry.sections ?? []).entries()) {
          const timedStorage = timedSectionStorage(section);
          insertSection.run(
            entryId,
            index,
            section.sectionName ?? null,
            timedStorage.totalCumulatedTime,
            section.overallPosition ?? null,
            section.classPosition ?? null,
            section.sectionOverallPosition ?? null,
            section.sectionClassPosition ?? null,
            timedStorage.avgSpeed == null ? null : Number(timedStorage.avgSpeed),
            timedStorage.overallBehindBy,
            JSON.stringify(section)
          );
        }
      }

      if (setCurrentSnapshot.run(snapshotId, sourceId, capturedAt).changes) {
        updateSourceRaceMetadata.run({ ...sourceRaceValues, id: sourceId });
      }
      return sourceRaceKey(sourceRace.provider, sourceRace.sourceRaceId);
    }
  );

  function getCurrentSnapshot(key: string): Snapshot | null {
    const row = db
      .prepare<[string], SnapshotRow>(`
        SELECT sr.*, rs.id AS snapshot_id, rs.captured_at, rs.artifact_mime_type,
               rs.artifact_blob, rs.normalized_json
        FROM source_races sr
        JOIN race_snapshots rs ON rs.id = sr.current_snapshot_id
        WHERE sr.provider || ':' || sr.source_race_id = ?
      `)
      .get(key);
    if (!row) return null;
    return {
      id: row.snapshot_id,
      capturedAt: row.captured_at,
      sourceRace: mapSourceRace(row),
      normalized: parseNormalizedRace(row.normalized_json),
      artifact: {
        mimeType: row.artifact_mime_type,
        text: decompressArtifact(row.artifact_blob)
      }
    };
  }

  return {
    saveSnapshot(loaded: ArchiveLoadedRace, capturedAt: string): Snapshot {
      const normalizedJson = JSON.stringify(loaded.normalized);
      const artifactBlob = compressArtifact(loaded.artifact.text);
      const key = persistSnapshot(loaded, capturedAt, normalizedJson, artifactBlob);
      const current = getCurrentSnapshot(key);
      if (!current) throw new Error('Unable to load archived snapshot.');
      return current;
    },

    getCurrentSnapshot,

    findCatalog({ query = '', limit = 20 }: { query?: string; limit?: number } = {}): CatalogRace[] {
      const boundedLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
      const term = `%${query.trim()}%`;
      return db
        .prepare<[string, string, string, string, string, number], CatalogRow>(`
          SELECT sr.*, rs.captured_at
          FROM source_races sr
          JOIN race_snapshots rs ON rs.id = sr.current_snapshot_id
          WHERE ? = '%%'
             OR sr.race_name LIKE ?
             OR sr.source_race_id LIKE ?
             OR COALESCE(sr.location, '') LIKE ?
             OR COALESCE(sr.organizer, '') LIKE ?
          ORDER BY sr.event_date DESC, sr.race_name COLLATE NOCASE, sr.provider DESC
          LIMIT ?
        `)
        .all(term, term, term, term, term, boundedLimit)
        .map((row) => ({ ...mapSourceRace(row), capturedAt: row.captured_at }));
    },

    findRacers(query: unknown, limit = 20): RacerSearchResult[] {
      const normalized = normalizeRacerName(String(query ?? ''));
      if (!normalized) return [];
      return db
        .prepare<[string, number], RacerRow>(`
          SELECT re.normalized_name, MAX(re.full_name) AS full_name, COUNT(*) AS race_count
          FROM race_entries re
          JOIN race_snapshots rs ON rs.id = re.snapshot_id
          JOIN source_races sr
            ON sr.id = rs.source_race_id
           AND sr.current_snapshot_id = rs.id
          WHERE re.normalized_name LIKE ?
          GROUP BY re.normalized_name
          ORDER BY race_count DESC, re.normalized_name
          LIMIT ?
        `)
        .all(`%${normalized}%`, limit)
        .map((row) => ({
          normalizedName: row.normalized_name,
          fullName: row.full_name,
          raceCount: row.race_count
        }));
    },

    findHistory(normalizedName: string): HistoryEntry[] {
      return db
        .prepare<[string], HistoryRow>(`
          SELECT sr.provider, sr.source_race_id, sr.race_name, sr.event_date,
                 rs.captured_at, re.*
          FROM race_entries re
          JOIN race_snapshots rs ON rs.id = re.snapshot_id
          JOIN source_races sr
            ON sr.id = rs.source_race_id
           AND sr.current_snapshot_id = rs.id
          WHERE re.normalized_name = ?
          ORDER BY sr.event_date IS NULL, sr.event_date, rs.captured_at, re.id
        `)
        .all(normalizedName)
        .map((row) => ({
          sourceRaceId: sourceRaceKey(row.provider, row.source_race_id),
          provider: row.provider,
          providerSourceRaceId: row.source_race_id,
          raceName: row.race_name,
          eventDate: row.event_date,
          eventDateProvenance: row.event_date ? 'source' : 'unavailable',
          capturedAt: row.captured_at,
          fullName: row.full_name,
          normalizedName: row.normalized_name,
          displayedNumber: row.displayed_number,
          brand: row.brand,
          className: row.class_name,
          overallPosition: row.overall_position,
          classPosition: row.class_position,
          fieldSize: row.field_size,
          classSize: row.class_size,
          totalTimeSeconds: row.total_time_seconds,
          entry: parseRaceEntry(row.entry_json)
        }));
    }
  };
}
