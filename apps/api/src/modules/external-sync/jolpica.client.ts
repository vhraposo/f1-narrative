import {
  JolpicaError,
  type JolpicaTransport,
} from "./jolpica.transport.js";

export interface JolpicaDriverRaw {
  driverId?: string;
  permanentNumber?: string;
  code?: string;
  givenName?: string;
  familyName?: string;
  dateOfBirth?: string;
  nationality?: string;
}

export interface JolpicaConstructorRaw {
  constructorId?: string;
  name?: string;
  nationality?: string;
}

export interface JolpicaLocationRaw {
  locality?: string;
  country?: string;
}

export interface JolpicaCircuitRaw {
  circuitId?: string;
  circuitName?: string;
  Location?: JolpicaLocationRaw;
}

export interface JolpicaRaceRaw {
  season?: string;
  round?: string;
  raceName?: string;
  Circuit?: JolpicaCircuitRaw;
  date?: string;
  time?: string;
}

export interface JolpicaFastestLapRaw {
  rank?: string;
  lap?: string;
}

export interface JolpicaResultRaw {
  number?: string;
  position?: string;
  positionText?: string;
  points?: string;
  grid?: string;
  status?: string;
  Driver?: JolpicaDriverRaw;
  Constructor?: JolpicaConstructorRaw;
  FastestLap?: JolpicaFastestLapRaw;
}

export interface JolpicaRaceWithResultsRaw extends JolpicaRaceRaw {
  Results?: JolpicaResultRaw[];
}

export interface JolpicaStandingRaw {
  position?: string;
  points?: string;
  wins?: string;
  Driver?: JolpicaDriverRaw;
  Constructors?: JolpicaConstructorRaw[];
}

export interface JolpicaStandingsListRaw {
  season?: string;
  round?: string;
  DriverStandings?: JolpicaStandingRaw[];
}

export interface JolpicaClientOptions {
  transport: JolpicaTransport;
}

export class JolpicaClient {
  private readonly transport: JolpicaTransport;

  constructor(options: JolpicaClientOptions) {
    this.transport = options.transport;
  }

  async getSeasonRaces(year: number): Promise<JolpicaRaceRaw[]> {
    const body = await this.transport.getJson(`${year}.json`);
    const table = readTable(body, "RaceTable");
    return asArray(table.Races) as JolpicaRaceRaw[];
  }

  async getConstructors(year: number): Promise<JolpicaConstructorRaw[]> {
    const body = await this.transport.getJson(`${year}/constructors.json`);
    const table = readTable(body, "ConstructorTable");
    return asArray(table.Constructors) as JolpicaConstructorRaw[];
  }

  async getDrivers(year: number): Promise<JolpicaDriverRaw[]> {
    const body = await this.transport.getJson(`${year}/drivers.json`);
    const table = readTable(body, "DriverTable");
    return asArray(table.Drivers) as JolpicaDriverRaw[];
  }

  async getDriverStandings(year: number): Promise<JolpicaStandingsListRaw> {
    const body = await this.transport.getJson(`${year}/driverStandings.json`);
    const table = readTable(body, "StandingsTable");
    const lists = asArray(table.StandingsLists);
    const first = lists[0] as JolpicaStandingsListRaw | undefined;
    if (!first || !Array.isArray(first.DriverStandings)) {
      throw new JolpicaError(
        "MALFORMED",
        "Estrutura StandingsLists ausente na resposta.",
      );
    }
    return first;
  }

  async getRaceResults(
    year: number,
    round: number,
  ): Promise<JolpicaRaceWithResultsRaw[]> {
    const body = await this.transport.getJson(`${year}/${round}/results.json`);
    const table = readTable(body, "RaceTable");
    return asArray(table.Races) as JolpicaRaceWithResultsRaw[];
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function readTable(body: unknown, tableKey: string): Record<string, unknown> {
  const root = asRecord(body);
  if (!root) {
    throw new JolpicaError("MALFORMED", "Resposta sem MRData.");
  }
  const mrData = asRecord(root.MRData);
  if (!mrData) {
    throw new JolpicaError("MALFORMED", "Resposta sem MRData.");
  }
  const table = mrData[tableKey];
  if (!isRecord(table)) {
    throw new JolpicaError(
      "MALFORMED",
      `Estrutura ${tableKey} ausente na resposta.`,
    );
  }
  return table;
}