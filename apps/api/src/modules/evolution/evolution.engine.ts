import { createHash } from "node:crypto";

export const ATTRIBUTE_MIN = 0;
export const ATTRIBUTE_MAX = 100;

export type AttributeValues = {
  speed: number;
  consistency: number;
  racecraft: number;
  aggression: number;
};

export type PerformanceValues = {
  carSpeed: number;
  reliability: number;
  operations: number;
};

export const DEFAULT_ATTRIBUTES: AttributeValues = {
  speed: 50,
  consistency: 50,
  racecraft: 50,
  aggression: 50,
};

export const DEFAULT_PERFORMANCE: PerformanceValues = {
  carSpeed: 50,
  reliability: 50,
  operations: 50,
};

export type SeasonResultRow = {
  raceId: string;
  round: number | null;
  date: Date | null;
  driverProfileId: string;
  teamId: string | null;
  position: number | null;
  grid: number | null;
  status: string | null;
  points: number;
};

export type EvaluationInput = {
  seasonId: string;
  results: SeasonResultRow[];
  drivers: Array<{
    driverProfileId: string;
    name: string;
    attributes: AttributeValues;
  }>;
  teams: Array<{
    teamId: string;
    name: string;
    performance: PerformanceValues;
  }>;
};

export type DriverChange = {
  driverProfileId: string;
  name: string;
  before: AttributeValues;
  after: AttributeValues;
};

export type TeamChange = {
  teamId: string;
  name: string;
  before: PerformanceValues;
  after: PerformanceValues;
};

export type EvolutionChangeSet = {
  seasonId: string;
  fingerprint: string;
  racesConsidered: number;
  drivers: DriverChange[];
  teams: TeamChange[];
  changed: boolean;
  alreadyApplied?: boolean;
};

function clamp(value: number): number {
  return Math.max(ATTRIBUTE_MIN, Math.min(ATTRIBUTE_MAX, value));
}

function bound(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value);
}

function isRetired(row: SeasonResultRow): boolean {
  return row.position === null || row.status === "Retired";
}

function computeFingerprint(results: SeasonResultRow[]): string {
  const ordered = [...results].sort((a, b) =>
    `${a.raceId}:${a.driverProfileId}`.localeCompare(
      `${b.raceId}:${b.driverProfileId}`,
    ),
  );
  const canonical = ordered
    .map(
      (row) =>
        `${row.raceId}:${row.driverProfileId}:${row.position ?? "R"}:${row.grid ?? "-"}:${row.status ?? "-"}:${row.points}`,
    )
    .join("|");
  return createHash("sha256").update(`${canonical}`).digest("hex");
}

function driverDeltas(
  results: SeasonResultRow[],
): Partial<AttributeValues> {
  const races = results.length;
  if (races === 0) return {};

  const finishes = results.filter((row) => !isRetired(row));
  const wins = finishes.filter((row) => row.position === 1).length;
  const podiums = finishes.filter(
    (row) => row.position !== null && row.position <= 3,
  ).length;
  const dnfs = results.filter((row) => isRetired(row)).length;
  const finishRate = finishes.length / races;

  const gained = finishes.filter(
    (row) => row.grid !== null && row.position !== null,
  );
  const positionsGained =
    gained.length === 0
      ? 0
      : gained.reduce(
          (total, row) => total + ((row.grid as number) - (row.position as number)),
          0,
        ) / gained.length;

  const speed = bound(
    round(wins * 1.5 + podiums * 0.5 + (positionsGained >= 2 ? 1 : 0)),
    0,
    3,
  );
  const consistency =
    finishRate >= 0.8 ? 2 : finishRate <= 0.5 ? -2 : 0;
  const racecraft = bound(round(positionsGained * 0.75 + podiums * 0.25), -1, 3);
  const aggression = bound(round(dnfs * 0.5), 0, 2);

  return { speed, consistency, racecraft, aggression };
}

function teamDeltas(
  performance: PerformanceValues,
  teamResults: SeasonResultRow[],
): PerformanceValues {
  const races = new Set(teamResults.map((row) => row.raceId)).size;
  if (races === 0) return performance;

  const finishes = teamResults.filter((row) => !isRetired(row));
  const wins = finishes.filter((row) => row.position === 1).length;
  const podiums = finishes.filter(
    (row) => row.position !== null && row.position <= 3,
  ).length;
  const dnfs = teamResults.filter((row) => isRetired(row)).length;

  const carSpeed = bound(round(wins * 1.5 + podiums * 0.5), 0, 3);
  const reliability = -Math.min(3, dnfs);
  const operations = bound(
    finishes.length >= races ? 1 : finishes.length <= races / 2 ? -1 : 0,
    -1,
    1,
  );

  return {
    carSpeed: clamp(performance.carSpeed + carSpeed),
    reliability: clamp(performance.reliability + reliability),
    operations: clamp(performance.operations + operations),
  };
}

export function evaluateSeasonEvolution(
  input: EvaluationInput,
): EvolutionChangeSet {
  const fingerprint = computeFingerprint(input.results);
  const racesConsidered = new Set(input.results.map((row) => row.raceId)).size;

  const resultsByDriver = new Map<string, SeasonResultRow[]>();
  for (const row of input.results) {
    const list = resultsByDriver.get(row.driverProfileId) ?? [];
    list.push(row);
    resultsByDriver.set(row.driverProfileId, list);
  }

  const drivers: DriverChange[] = input.drivers
    .map((driver) => {
      const rows = resultsByDriver.get(driver.driverProfileId) ?? [];
      const deltas = driverDeltas(rows);
      const after: AttributeValues = {
        speed: clamp(driver.attributes.speed + (deltas.speed ?? 0)),
        consistency: clamp(
          driver.attributes.consistency + (deltas.consistency ?? 0),
        ),
        racecraft: clamp(
          driver.attributes.racecraft + (deltas.racecraft ?? 0),
        ),
        aggression: clamp(
          driver.attributes.aggression + (deltas.aggression ?? 0),
        ),
      };
      return {
        driverProfileId: driver.driverProfileId,
        name: driver.name,
        before: driver.attributes,
        after,
      };
    })
    .filter(
      (change) =>
        change.before.speed !== change.after.speed ||
        change.before.consistency !== change.after.consistency ||
        change.before.racecraft !== change.after.racecraft ||
        change.before.aggression !== change.after.aggression,
    )
    .sort((a, b) => a.driverProfileId.localeCompare(b.driverProfileId));

  const resultsByTeam = new Map<string, SeasonResultRow[]>();
  for (const row of input.results) {
    if (!row.teamId) continue;
    const list = resultsByTeam.get(row.teamId) ?? [];
    list.push(row);
    resultsByTeam.set(row.teamId, list);
  }

  const teams: TeamChange[] = input.teams
    .map((team) => {
      const rows = resultsByTeam.get(team.teamId) ?? [];
      const after = teamDeltas(team.performance, rows);
      return {
        teamId: team.teamId,
        name: team.name,
        before: team.performance,
        after,
      };
    })
    .filter(
      (change) =>
        change.before.carSpeed !== change.after.carSpeed ||
        change.before.reliability !== change.after.reliability ||
        change.before.operations !== change.after.operations,
    )
    .sort((a, b) => a.teamId.localeCompare(b.teamId));

  return {
    seasonId: input.seasonId,
    fingerprint,
    racesConsidered,
    drivers,
    teams,
    changed: drivers.length > 0 || teams.length > 0,
  };
}
