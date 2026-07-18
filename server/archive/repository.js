import { compressArtifact, decompressArtifact } from '../compression.js';
import { normalizeRacerName } from './history.js';

function sourceRaceKey(provider, sourceRaceId) {
  return `${provider}:${sourceRaceId}`;
}

function secondsFromClock(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split(':').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function totalTimeSeconds(entry) {
  if (Number.isFinite(entry.totalTimeSeconds)) return entry.totalTimeSeconds;
  const finalSection = entry.sections?.at(-1);
  return secondsFromClock(finalSection?.totalCumulatedTime);
}

function mapSourceRace(row) {
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

export function createArchive(db) {
  const insertSourceRace = db.prepare(`
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
  const findSourceRace = db.prepare(
    'SELECT id FROM source_races WHERE provider = ? AND source_race_id = ?'
  );
  const updateSourceRaceMetadata = db.prepare(`
    UPDATE source_races
    SET canonical_url = @canonicalUrl,
        race_name = @raceName,
        mode_name = @modeName,
        event_date = @eventDate,
        location = @location,
        organizer = @organizer
    WHERE id = @id
  `);
  const insertSnapshot = db.prepare(`
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
  const setCurrentSnapshot = db.prepare(
    `UPDATE source_races
     SET current_snapshot_id = ?
     WHERE id = ?
       AND (
         current_snapshot_id IS NULL
         OR (SELECT captured_at FROM race_snapshots WHERE id = current_snapshot_id) < ?
       )`
  );

  const persistSnapshot = db.transaction((loaded, capturedAt, normalizedJson, artifactBlob) => {
    const { sourceRace, normalized, artifact } = loaded;
    const sourceRaceValues = {
      provider: sourceRace.provider,
      sourceRaceId: String(sourceRace.sourceRaceId),
      canonicalUrl: sourceRace.canonicalUrl,
      raceName: sourceRace.raceName,
      modeName: sourceRace.modeName,
      eventDate: sourceRace.eventDate ?? null,
      location: sourceRace.location ?? null,
      organizer: sourceRace.organizer ?? null
    };
    const sourceId =
      insertSourceRace.get(sourceRaceValues)?.id ??
      findSourceRace.get(sourceRaceValues.provider, sourceRaceValues.sourceRaceId).id;
    const snapshotId = insertSnapshot.run(
      sourceId,
      capturedAt,
      artifact.mimeType,
      artifactBlob,
      normalizedJson
    ).lastInsertRowid;
    const results = normalized.allResults;
    const fieldSize = results.length;
    const classSizes = new Map();
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
        insertSection.run(
          entryId,
          index,
          section.sectionName ?? null,
          section.totalCumulatedTime ?? null,
          section.overallPosition ?? null,
          section.classPosition ?? null,
          section.sectionOverallPosition ?? null,
          section.sectionClassPosition ?? null,
          section.avgSpeed == null ? null : Number(section.avgSpeed),
          section.overallBehindBy ?? null,
          JSON.stringify(section)
        );
      }
    }

    if (setCurrentSnapshot.run(snapshotId, sourceId, capturedAt).changes) {
      updateSourceRaceMetadata.run({ ...sourceRaceValues, id: sourceId });
    }
    return sourceRaceKey(sourceRace.provider, sourceRace.sourceRaceId);
  });

  function getCurrentSnapshot(key) {
    const row = db
      .prepare(`
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
      normalized: JSON.parse(row.normalized_json),
      artifact: {
        mimeType: row.artifact_mime_type,
        text: decompressArtifact(row.artifact_blob)
      }
    };
  }

  return {
    saveSnapshot(loaded, capturedAt) {
      const normalizedJson = JSON.stringify(loaded.normalized);
      const artifactBlob = compressArtifact(loaded.artifact.text);
      const key = persistSnapshot(loaded, capturedAt, normalizedJson, artifactBlob);
      return getCurrentSnapshot(key);
    },

    getCurrentSnapshot,

    findCatalog({ query = '', limit = 20 } = {}) {
      const boundedLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
      const term = `%${query.trim()}%`;
      return db
        .prepare(`
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

    findHistory(normalizedName) {
      return db
        .prepare(`
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
          entry: JSON.parse(row.entry_json)
        }));
    }
  };
}
