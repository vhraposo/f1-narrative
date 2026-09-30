import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { env } from "../../config/env.js";
import { parseCsv, type CsvRow } from "./f1db.csv.js";

export type F1dbCircuit = {
  id: string;
  name: string;
  fullName: string;
  type: string;
  direction: string;
  placeName: string;
  countryId: string;
  latitude: number | null;
  longitude: number | null;
  lengthKm: number | null;
  turns: number | null;
  totalRacesHeld: number | null;
};

export type F1dbCircuitLayout = {
  id: string;
  circuitId: string;
  effective: boolean;
  lengthKm: number | null;
  turns: number | null;
};

export type F1dbDriver = {
  id: string;
  name: string;
  fullName: string;
  abbreviation: string;
  permanentNumber: string | null;
  dateOfBirth: string | null;
  placeOfBirth: string | null;
  nationalityCountryId: string | null;
  totalChampionshipWins: number | null;
  totalRaceWins: number | null;
  totalPodiums: number | null;
  totalPolePositions: number | null;
  totalFastestLaps: number | null;
  totalRaceStarts: number | null;
};

export type F1dbRace = {
  id: string;
  year: number;
  round: number;
  date: string | null;
  grandPrixId: string | null;
  officialName: string | null;
  circuitId: string;
  circuitLayoutId: string | null;
  courseLengthKm: number | null;
  turns: number | null;
  laps: number | null;
};

export type F1dbResult = {
  raceId: string;
  year: number;
  round: number;
  driverId: string;
  positionNumber: number | null;
  positionText: string;
  points: number | null;
  polePosition: boolean;
  gridPositionNumber: number | null;
  fastestLap: boolean;
  reasonRetired: string | null;
};

export type F1dbChampion = {
  year: number;
  driverId: string;
  positionNumber: number | null;
};

export type F1dbDataset = {
  readonly dataDir: string;
  readonly sourceVersion: string;
  readonly circuits: readonly F1dbCircuit[];
  readonly circuitsById: ReadonlyMap<string, F1dbCircuit>;
  readonly layoutsByCircuitId: ReadonlyMap<string, readonly F1dbCircuitLayout[]>;
  readonly drivers: readonly F1dbDriver[];
  readonly driversById: ReadonlyMap<string, F1dbDriver>;
  readonly races: readonly F1dbRace[];
  readonly racesById: ReadonlyMap<string, F1dbRace>;
  readonly resultsByDriverId: ReadonlyMap<string, readonly F1dbResult[]>;
  readonly championsByYear: ReadonlyMap<number, F1dbChampion>;
};

const REQUIRED_FILES = [
  "f1db-circuits.csv",
  "f1db-circuits-layouts.csv",
  "f1db-drivers.csv",
  "f1db-races.csv",
  "f1db-races-race-results.csv",
  "f1db-seasons-driver-standings.csv",
];

function firstExistingDir(candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    if (
      existsSync(path.join(candidate, REQUIRED_FILES[0] as string)) &&
      existsSync(path.join(candidate, REQUIRED_FILES[2] as string))
    ) {
      return candidate;
    }
  }
  return null;
}

export function resolveF1dbDataDir(): string | null {
  const candidates = [
    ...(env.F1DB_DATA_DIR ? [path.resolve(env.F1DB_DATA_DIR)] : []),
    path.resolve(process.cwd(), "..", "..", "data", "external", "f1db"),
    path.resolve(process.cwd(), "data", "external", "f1db"),
  ];
  return firstExistingDir(candidates);
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBoolean(value: string | undefined): boolean {
  return value === "true";
}

function readRows(dataDir: string, file: string): CsvRow[] {
  return parseCsv(readFileSync(path.join(dataDir, file), "utf8"));
}

let cached: F1dbDataset | null | undefined;

export function getF1dbDataset(): F1dbDataset | null {
  if (cached !== undefined) return cached;
  cached = loadF1dbDataset();
  return cached;
}

export function resetF1dbDatasetCache(): void {
  cached = undefined;
}

export function loadF1dbDataset(): F1dbDataset | null {
  const dataDir = resolveF1dbDataDir();
  if (!dataDir) return null;

  const circuits: F1dbCircuit[] = readRows(dataDir, "f1db-circuits.csv").map((row) => ({
    id: row.id ?? "",
    name: row.name ?? "",
    fullName: row.fullName ?? row.name ?? "",
    type: row.type ?? "",
    direction: row.direction ?? "",
    placeName: row.placeName ?? "",
    countryId: row.countryId ?? "",
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
    lengthKm: toNumber(row.length),
    turns: toNumber(row.turns),
    totalRacesHeld: toNumber(row.totalRacesHeld),
  }));

  const layoutsByCircuitId = new Map<string, F1dbCircuitLayout[]>();
  for (const row of readRows(dataDir, "f1db-circuits-layouts.csv")) {
    const layout: F1dbCircuitLayout = {
      id: row.id ?? "",
      circuitId: row.circuitId ?? "",
      effective: toBoolean(row.effective),
      lengthKm: toNumber(row.length),
      turns: toNumber(row.turns),
    };
    const list = layoutsByCircuitId.get(layout.circuitId) ?? [];
    list.push(layout);
    layoutsByCircuitId.set(layout.circuitId, list);
  }

  const drivers: F1dbDriver[] = readRows(dataDir, "f1db-drivers.csv").map((row) => ({
    id: row.id ?? "",
    name: row.name ?? row.fullName ?? "",
    fullName: row.fullName ?? row.name ?? "",
    abbreviation: row.abbreviation ?? "",
    permanentNumber: row.permanentNumber?.length ? row.permanentNumber : null,
    dateOfBirth: row.dateOfBirth?.length ? row.dateOfBirth : null,
    placeOfBirth: row.placeOfBirth?.length ? row.placeOfBirth : null,
    nationalityCountryId: row.nationalityCountryId?.length ? row.nationalityCountryId : null,
    totalChampionshipWins: toNumber(row.totalChampionshipWins),
    totalRaceWins: toNumber(row.totalRaceWins),
    totalPodiums: toNumber(row.totalPodiums),
    totalPolePositions: toNumber(row.totalPolePositions),
    totalFastestLaps: toNumber(row.totalFastestLaps),
    totalRaceStarts: toNumber(row.totalRaceStarts),
  }));

  const races: F1dbRace[] = readRows(dataDir, "f1db-races.csv").map((row) => ({
    id: row.id ?? "",
    year: toNumber(row.year) ?? 0,
    round: toNumber(row.round) ?? 0,
    date: row.date?.length ? row.date : null,
    grandPrixId: row.grandPrixId?.length ? row.grandPrixId : null,
    officialName: row.officialName?.length ? row.officialName : null,
    circuitId: row.circuitId ?? "",
    circuitLayoutId: row.circuitLayoutId?.length ? row.circuitLayoutId : null,
    courseLengthKm: toNumber(row.courseLength),
    turns: toNumber(row.turns),
    laps: toNumber(row.laps),
  }));

  const resultsByDriverId = new Map<string, F1dbResult[]>();
  for (const row of readRows(dataDir, "f1db-races-race-results.csv")) {
    const result: F1dbResult = {
      raceId: row.raceId ?? "",
      year: toNumber(row.year) ?? 0,
      round: toNumber(row.round) ?? 0,
      driverId: row.driverId ?? "",
      positionNumber: toNumber(row.positionNumber),
      positionText: row.positionText ?? "",
      points: toNumber(row.points),
      polePosition: toBoolean(row.polePosition),
      gridPositionNumber: toNumber(row.gridPositionNumber),
      fastestLap: toBoolean(row.fastestLap),
      reasonRetired: row.reasonRetired?.length ? row.reasonRetired : null,
    };
    const list = resultsByDriverId.get(result.driverId) ?? [];
    list.push(result);
    resultsByDriverId.set(result.driverId, list);
  }
  for (const list of resultsByDriverId.values()) {
    list.sort((a, b) => a.year - b.year || a.round - b.round);
  }

  const championsByYear = new Map<number, F1dbChampion>();
  for (const row of readRows(dataDir, "f1db-seasons-driver-standings.csv")) {
    if (!toBoolean(row.championshipWon)) continue;
    const year = toNumber(row.year);
    if (year === null) continue;
    championsByYear.set(year, {
      year,
      driverId: row.driverId ?? "",
      positionNumber: toNumber(row.positionNumber),
    });
  }

  const circuitsById = new Map(circuits.map((circuit) => [circuit.id, circuit]));
  const driversById = new Map(drivers.map((driver) => [driver.id, driver]));
  const racesById = new Map(races.map((race) => [race.id, race]));

  return Object.freeze({
    dataDir,
    sourceVersion: resolveSourceVersion(dataDir),
    circuits,
    circuitsById,
    layoutsByCircuitId,
    drivers,
    driversById,
    races,
    racesById,
    resultsByDriverId,
    championsByYear,
  });
}

function resolveSourceVersion(dataDir: string): string {
  try {
    const raw = readFileSync(path.join(dataDir, "PROVENANCE.json"), "utf8");
    const parsed = JSON.parse(raw) as { release?: string };
    return parsed.release ?? "unknown";
  } catch {
    return "unknown";
  }
}
