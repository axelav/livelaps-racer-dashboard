export type Provider = 'livelaps' | 'mototally';
export type ResultStatus = 'finished' | 'official_dnf' | 'no_result';
export type ScoringMode = 'timed' | 'points';

export type RaceMeta = {
  raceName: string;
  modeName: string;
};

export type SourceRace = {
  id?: string;
  provider: Provider;
  sourceRaceId: string;
  canonicalUrl: string;
  raceName: string;
  modeName: string;
  eventDate: string | null;
  location: string | null;
  organizer: string | null;
};

export type TimedSection = {
  sectionName: string;
  totalCumulatedTime: string | null;
  overallPosition: number | null;
  classPosition: number | null;
  sectionOverallPosition: number | null;
  sectionClassPosition: number | null;
  avgSpeed: string | number | null;
  overallBehindBy: string | null;
};

export type PointsCheck = {
  sectionName: string;
  points: number | null;
  emergencySeconds: number | null;
  checkOverallPosition: number | null;
  checkClassPosition: number | null;
};

export type PointsSection = {
  sectionName: string;
  timed: boolean;
  points: number | null;
  seconds: number | null;
  publishedPlace: number | null;
  sectionOverallPosition: number | null;
  sectionClassPosition: number | null;
  cumPoints: number;
  cumSeconds: number;
  overallPosition: number | null;
  classPosition: number | null;
};

export type RaceSection = TimedSection | PointsSection;

export type RaceEntry = {
  id: string | number | null;
  fullName: string;
  displayedNumber: string | number | null;
  brand: string | null;
  className: string | null;
  overallPosition: number | null;
  classPosition: number | null;
  scoring?: ScoringMode;
  totalTimeSeconds?: number | null;
  totalPoints?: number | null;
  totalEmergencySeconds?: number | null;
  maxChk?: number | null;
  checkCount?: number | null;
  timedCheckCount?: number | null;
  pointsBehindOverallLeader?: number | null;
  pointsBehindClassLeader?: number | null;
  overallBehindByLeader?: string | null;
  classBehindByLeader?: string | null;
  avgSpeedTotal?: number | null;
  sections?: RaceSection[];
  checks?: PointsCheck[];
};

export type NormalizedRace = {
  raceMeta: RaceMeta;
  allResults: RaceEntry[];
};

export type SourceArtifact = {
  mimeType: 'application/json' | 'text/html' | string;
  text: string;
};

export type LoadedRace = {
  sourceRace: SourceRace;
  normalized: NormalizedRace;
  artifact: SourceArtifact;
};

export type Snapshot = {
  id: number | string;
  capturedAt: string;
  sourceRace: SourceRace & { id: string };
  normalized: NormalizedRace;
  artifact: SourceArtifact;
};

export type ArchiveSnapshotResponse = NormalizedRace & {
  id: number | string;
  capturedAt: string;
};

export type SourceRaceResponse = {
  sourceRace: SourceRace & { id: string };
  snapshot: ArchiveSnapshotResponse;
  refreshed?: boolean;
};

export type ArchivedRace = {
  raceId: string;
  sourceRace: SourceRace & { id: string };
  capturedAt: string;
  snapshotId: number | string;
  raceMeta: RaceMeta;
  allResults: RaceEntry[];
};

export type ArchiveCatalogRace = SourceRace & {
  id: string;
  currentSnapshotId?: number | string | null;
  capturedAt?: string | null;
};

export type ArchiveSearchResponse = {
  races: ArchiveCatalogRace[];
};

export type RacerSearchResult = {
  normalizedName: string;
  fullName: string;
  raceCount: number;
};

export type RacerSearchResponse = {
  racers: RacerSearchResult[];
};

export type HistoryEntry = {
  sourceRaceId: string;
  provider: Provider;
  providerSourceRaceId: string;
  raceName: string;
  eventDate: string | null;
  eventDateProvenance: 'source' | 'unavailable';
  capturedAt: string;
  fullName: string;
  normalizedName: string;
  displayedNumber: string | number | null;
  brand: string | null;
  className: string | null;
  overallPosition: number | null;
  classPosition: number | null;
  fieldSize: number | null;
  classSize: number | null;
  totalTimeSeconds: number | null;
  entry: RaceEntry;
};

export type HistoryRace = {
  sourceRaceId: string;
  raceName: string;
  eventDate: string | null;
  eventDateProvenance: 'source' | 'unavailable';
  provider: Provider;
  fullName: string;
  overallPosition: number | null;
  fieldSize: number | null;
  overallPercentile: number | null;
  classPosition: number | null;
  classSize: number | null;
  classPercentile: number | null;
  totalTimeSeconds: number | null;
  totalPoints: number | null;
  resultStatus: ResultStatus;
  resultNote: string | null;
};

export type RacerHistory = {
  racerName: string | null;
  races: HistoryRace[];
  trends: {
    overallPercentiles?: (number | null)[];
    classPercentiles?: (number | null)[];
  };
};
