import type {
  JolpicaCircuitRaw,
  JolpicaConstructorRaw,
  JolpicaDriverRaw,
  JolpicaRaceRaw,
  JolpicaRaceWithResultsRaw,
  JolpicaStandingsListRaw,
  JolpicaStandingRaw,
} from "./jolpica.client.js";

export interface NormalizedSeason {
  year: number;
  name: string | null;
  status: string | null;
}

export interface NormalizedTeam {
  externalId: string;
  name: string;
  shortName: string | null;
  color: string | null;
}

export interface NormalizedDriver {
  externalId: string;
  name: string;
  fullName: string | null;
  nationality: string | null;
  number: number | null;
}

export interface NormalizedDriverSeason {
  seasonYear: number;
  driverExternalId: string;
  teamExternalId: string | null;
  teamNameSnapshot: string | null;
  number: number | null;
  role: string | null;
}

export interface NormalizedRace {
  seasonYear: number;
  round: number;
  grandPrix: string | null;
  name: string | null;
  officialName: string | null;
  circuitName: string | null;
  circuitExternalId: string | null;
  locality: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  date: Date | null;
  time: string | null;
  url: string | null;
  status: string | null;
}

export interface NormalizedCircuit {
  externalId: string;
  name: string;
  url: string | null;
  locality: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface NormalizedResult {
  seasonYear: number;
  round: number;
  driverExternalId: string;
  position: number | null;
  points: number | null;
  grid: number | null;
  fastestLap: boolean | null;
  status: string | null;
}

export interface NormalizedStanding {
  seasonYear: number;
  driverExternalId: string;
  position: number | null;
  points: number | null;
  wins: number | null;
  podiums: number | null;
}

export interface NormalizedWithSource<T> {
  data: T;
  sourceRecord: Record<string, unknown>;
}

export function normalizeSeason(
  year: number,
  races: JolpicaRaceRaw[],
): NormalizedWithSource<NormalizedSeason> {
  return {
    data: { year, name: null, status: null },
    sourceRecord: { year, roundCount: races.length },
  };
}

export function normalizeTeams(
  constructors: JolpicaConstructorRaw[],
): NormalizedWithSource<NormalizedTeam>[] {
  return constructors
    .filter((item) => typeof item.constructorId === "string")
    .map((item) => ({
      data: {
        externalId: item.constructorId!,
        name: safeString(item.name, "unknown"),
        shortName: null,
        color: null,
      },
      sourceRecord: {
        constructorId: item.constructorId,
        name: emptyToNull(item.name),
        nationality: emptyToNull(item.nationality),
      },
    }));
}

export function normalizeDrivers(
  drivers: JolpicaDriverRaw[],
): NormalizedWithSource<NormalizedDriver>[] {
  return drivers
    .filter((item) => typeof item.driverId === "string" && item.driverId.length > 0)
    .map((item) => {
      const full = fullDriverName(item);
      return {
        data: {
          externalId: item.driverId!,
          name: full,
          fullName: full,
          nationality: emptyToNull(item.nationality),
          number: toInt(item.permanentNumber),
        },
        sourceRecord: {
          driverId: item.driverId,
          permanentNumber: emptyToNull(item.permanentNumber),
          code: emptyToNull(item.code),
          name: full,
          nationality: emptyToNull(item.nationality),
          dateOfBirth: emptyToNull(item.dateOfBirth),
        },
      };
    });
}

export interface NormalizedDriverStatics {
  drivers: NormalizedWithSource<NormalizedDriver>[];
  teams: NormalizedWithSource<NormalizedTeam>[];
}

export function normalizeDriversFromStandings(
  standings: JolpicaStandingRaw[],
): NormalizedDriverStatics {
  const drivers = uniqueBy(
    standings
      .map((s) => s.Driver)
      .filter((d): d is JolpicaDriverRaw => !!d && typeof d.driverId === "string"),
    (d) => d.driverId!,
  );
  const teams = uniqueBy(
    standings.flatMap((s) => s.Constructors ?? []),
    (c) => c.constructorId ?? "",
  );
  return {
    drivers: normalizeDrivers(drivers),
    teams: normalizeTeams(teams),
  };
}

export interface NormalizedResultsPayload {
  results: NormalizedWithSource<NormalizedResult>[];
  drivers: NormalizedWithSource<NormalizedDriver>[];
}

export function normalizeRaceResults(
  races: JolpicaRaceWithResultsRaw[],
  seasonYear: number,
): NormalizedResultsPayload {
  const results: NormalizedWithSource<NormalizedResult>[] = [];
  for (const race of races) {
    const round = toInt(race.round);
    if (round === null) continue;
    for (const item of race.Results ?? []) {
      const driverId = item.Driver?.driverId;
      if (!driverId) continue;
      results.push({
        data: {
          seasonYear,
          round,
          driverExternalId: driverId,
          position: toInt(item.position),
          points: toFloat(item.points),
          grid: toInt(item.grid),
          fastestLap: toFastestLap(item.FastestLap?.rank),
          status: emptyToNull(item.status),
        },
        sourceRecord: {
          round,
          driverId,
          constructorId: emptyToNull(item.Constructor?.constructorId),
          number: emptyToNull(item.number),
          position: emptyToNull(item.position),
          positionText: emptyToNull(item.positionText),
          points: emptyToNull(item.points),
          grid: emptyToNull(item.grid),
          status: emptyToNull(item.status),
          fastestLapRank: emptyToNull(item.FastestLap?.rank),
        },
      });
    }
  }
  const drivers = uniqueBy(
    races
      .flatMap((race) => (race.Results ?? []).map((r) => r.Driver))
      .filter((d): d is JolpicaDriverRaw => !!d && typeof d.driverId === "string"),
    (d) => d.driverId!,
  );
  return { results, drivers: normalizeDrivers(drivers) };
}

export function normalizeRaces(
  races: JolpicaRaceRaw[],
  seasonYear: number,
): NormalizedWithSource<NormalizedRace>[] {
  const items: NormalizedWithSource<NormalizedRace>[] = [];
  for (const race of races) {
    const round = toInt(race.round);
    if (round === null) continue;
    const circuit = race.Circuit;
    items.push({
      data: {
        seasonYear,
        round,
        grandPrix: emptyToNull(race.raceName),
        name: emptyToNull(race.raceName),
        officialName: null,
        circuitName: emptyToNull(circuit?.circuitName),
        circuitExternalId: emptyToNull(circuit?.circuitId),
        locality: normalizeLocality(circuit?.Location?.locality),
        country: normalizeCountry(circuit?.Location?.country),
        latitude: toCoordinate(circuit?.Location?.lat, -90, 90),
        longitude: toCoordinate(circuit?.Location?.long, -180, 180),
        date: toDate(race.date),
        time: emptyToNull(race.time),
        url: emptyToNull(race.url),
        status: null,
      },
      sourceRecord: {
        season: emptyToNull(race.season),
        round,
        raceName: emptyToNull(race.raceName),
        url: emptyToNull(race.url),
        circuitId: emptyToNull(circuit?.circuitId),
        circuitName: emptyToNull(circuit?.circuitName),
        locality: emptyToNull(circuit?.Location?.locality),
        country: emptyToNull(circuit?.Location?.country),
        date: emptyToNull(race.date),
        time: emptyToNull(race.time),
      },
    });
  }
  return items;
}

export function normalizeCircuits(
  circuits: JolpicaCircuitRaw[],
): NormalizedWithSource<NormalizedCircuit>[] {
  const items: NormalizedWithSource<NormalizedCircuit>[] = [];
  for (const circuit of circuits) {
    const externalId = emptyToNull(circuit.circuitId);
    const name = emptyToNull(circuit.circuitName);
    if (!externalId || !name) continue;
    items.push({
      data: {
        externalId,
        name,
        url: emptyToNull(circuit.url),
        locality: normalizeLocality(circuit.Location?.locality),
        country: normalizeCountry(circuit.Location?.country),
        latitude: toCoordinate(circuit.Location?.lat, -90, 90),
        longitude: toCoordinate(circuit.Location?.long, -180, 180),
      },
      sourceRecord: {
        circuitId: externalId,
        url: emptyToNull(circuit.url),
        circuitName: name,
        locality: emptyToNull(circuit.Location?.locality),
        country: emptyToNull(circuit.Location?.country),
        lat: emptyToNull(circuit.Location?.lat),
        long: emptyToNull(circuit.Location?.long),
      },
    });
  }
  return items;
}

export function normalizeCircuitsFromRaces(
  races: JolpicaRaceRaw[],
): NormalizedWithSource<NormalizedCircuit>[] {
  const circuits = races
    .map((race) => race.Circuit)
    .filter((circuit): circuit is JolpicaCircuitRaw => !!circuit);
  return normalizeCircuits(uniqueBy(circuits, (c) => c.circuitId ?? ""));
}

const COUNTRY_ALIASES: Record<string, string> = {
  uk: "United Kingdom",
  "great britain": "United Kingdom",
  usa: "United States",
  "united states of america": "United States",
  uae: "United Arab Emirates",
  "south korea": "South Korea",
  "korea": "South Korea",
};

export function normalizeCountry(value: unknown): string | null {
  const raw = emptyToNull(value);
  if (!raw) return null;
  const alias = COUNTRY_ALIASES[raw.toLowerCase()];
  if (alias) return alias;
  return collapseSpaces(raw);
}

export function normalizeLocality(value: unknown): string | null {
  const raw = emptyToNull(value);
  return raw ? collapseSpaces(raw) : null;
}

function toCoordinate(
  value: unknown,
  min: number,
  max: number,
): number | null {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export interface NormalizedDriverSeasonPayload {
  driverSeasons: NormalizedWithSource<NormalizedDriverSeason>[];
  drivers: NormalizedWithSource<NormalizedDriver>[];
  teams: NormalizedWithSource<NormalizedTeam>[];
}

export function normalizeDriverSeasons(
  list: JolpicaStandingsListRaw,
  seasonYear: number,
): NormalizedDriverSeasonPayload {
  const standings = uniqueBy(
    list.DriverStandings ?? [],
    (s) => s.Driver?.driverId ?? "",
  );
  const drivers = uniqueBy(
    standings
      .map((s) => s.Driver)
      .filter((d): d is JolpicaDriverRaw => !!d && typeof d.driverId === "string"),
    (d) => d.driverId!,
  );
  const teams = uniqueBy(
    standings.flatMap((s) => s.Constructors ?? []),
    (c) => c.constructorId ?? "",
  );
  const driverSeasons = standings
    .filter((s) => !!s.Driver?.driverId)
    .map((s) => {
      const team = s.Constructors?.[0];
      return {
        data: {
          seasonYear,
          driverExternalId: s.Driver!.driverId!,
          teamExternalId: team?.constructorId ?? null,
          teamNameSnapshot: team?.name ?? null,
          number: toInt(s.Driver?.permanentNumber),
          role: null,
        },
        sourceRecord: {
          driverId: s.Driver!.driverId,
          teamExternalId: team?.constructorId ?? null,
          teamName: team?.name ?? null,
          number: emptyToNull(s.Driver?.permanentNumber),
          seasonYear,
        },
      };
    });
  return {
    driverSeasons,
    drivers: normalizeDrivers(drivers),
    teams: normalizeTeams(teams),
  };
}

export function normalizeStandings(
  list: JolpicaStandingsListRaw,
  seasonYear: number,
): NormalizedWithSource<NormalizedStanding>[] {
  return (list.DriverStandings ?? [])
    .filter((s) => !!s.Driver?.driverId)
    .map((s) => ({
      data: {
        seasonYear,
        driverExternalId: s.Driver!.driverId!,
        position: toInt(s.position),
        points: toFloat(s.points),
        wins: toInt(s.wins),
        podiums: null,
      },
      sourceRecord: {
        driverId: s.Driver!.driverId,
        position: emptyToNull(s.position),
        points: emptyToNull(s.points),
        wins: emptyToNull(s.wins),
      },
    }));
}

function fullDriverName(driver: {
  givenName?: string;
  familyName?: string;
}): string {
  const given = emptyToNull(driver.givenName) ?? "";
  const family = emptyToNull(driver.familyName) ?? "";
  return `${given} ${family}`.trim();
}

function safeString(value: unknown, fallback: string): string {
  const normalized = emptyToNull(value);
  return normalized ?? fallback;
}

function emptyToNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === "\\N" || trimmed === "-") return null;
  return trimmed;
}

function toInt(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function toFloat(value: unknown): number | null {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function toDate(value: unknown): Date | null {
  const s = typeof value === "string" ? value : "";
  const normalized = s.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toFastestLap(rank: unknown): boolean | null {
  if (rank === undefined || rank === null) return null;
  const s = String(rank).trim();
  if (s.length === 0) return null;
  return s === "1";
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(item);
    }
  }
  return out;
}