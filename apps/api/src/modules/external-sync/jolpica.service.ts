import { prisma } from "../../infrastructure/database/prisma.js";
import type {
  JolpicaClient,
  JolpicaRaceRaw,
} from "./jolpica.client.js";
import {
  normalizeDriverSeasons,
  normalizeDrivers,
  normalizeDriversFromStandings,
  normalizeRaceResults,
  normalizeRaces,
  normalizeSeason,
  normalizeStandings,
  normalizeTeams,
  type NormalizedWithSource,
  type NormalizedDriver,
  type NormalizedResult,
} from "./jolpica.normalizer.js";
import {
  mergePersistResults,
  persistDrivers,
  persistDriverSeasons,
  persistRaces,
  persistResults,
  persistSeasons,
  persistStandings,
  persistTeams,
  type PersistResult,
} from "./jolpica.persist.js";

export const JOLPICA_SOURCE = "jolpica";

export const JOLPICA_SYNC_SCOPES = [
  "SEASON",
  "TEAMS",
  "DRIVERS",
  "DRIVER_SEASONS",
  "RACES",
  "RESULTS",
  "STANDINGS",
] as const;

export type JolpicaSyncScope = (typeof JOLPICA_SYNC_SCOPES)[number];

export interface JolpicaSyncReport {
  source: string;
  year: number;
  scope: JolpicaSyncScope;
  counts: PersistResult;
  durationMs: number;
}

export interface JolpicaSyncOptions {
  requestDelayMs?: number;
}

export class JolpicaSyncService {
  private readonly client: JolpicaClient;
  private readonly requestDelayMs: number;

  constructor(client: JolpicaClient, options: JolpicaSyncOptions = {}) {
    this.client = client;
    this.requestDelayMs = options.requestDelayMs ?? 0;
  }

  async sync(year: number, scope: JolpicaSyncScope): Promise<JolpicaSyncReport> {
    switch (scope) {
      case "SEASON":
        return this.syncSeason(year);
      case "TEAMS":
        return this.syncTeams(year);
      case "DRIVERS":
        return this.syncDrivers(year);
      case "DRIVER_SEASONS":
        return this.syncDriverSeasons(year);
      case "RACES":
        return this.syncRaces(year);
      case "RESULTS":
        return this.syncResults(year);
      case "STANDINGS":
        return this.syncStandings(year);
    }
  }

  async syncSeason(year: number): Promise<JolpicaSyncReport> {
    const started = Date.now();
    const races = await this.client.getSeasonRaces(year);
    const season = normalizeSeason(year, races);
    const counts = await prisma.$transaction((tx) =>
      persistSeasons(tx, JOLPICA_SOURCE, [season], new Date()),
    );
    return this.report(year, "SEASON", counts, started);
  }

  async syncTeams(year: number): Promise<JolpicaSyncReport> {
    const started = Date.now();
    const constructors = await this.client.getConstructors(year);
    const teams = normalizeTeams(constructors);
    const counts = await prisma.$transaction((tx) =>
      persistTeams(tx, JOLPICA_SOURCE, teams, new Date()),
    );
    return this.report(year, "TEAMS", counts, started);
  }

  async syncDrivers(year: number): Promise<JolpicaSyncReport> {
    const started = Date.now();
    const drivers = await this.client.getDrivers(year);
    const items = normalizeDrivers(drivers);
    const counts = await prisma.$transaction((tx) =>
      persistDrivers(tx, JOLPICA_SOURCE, items, new Date()),
    );
    return this.report(year, "DRIVERS", counts, started);
  }

  async syncDriverSeasons(year: number): Promise<JolpicaSyncReport> {
    const started = Date.now();
    const list = await this.client.getDriverStandings(year);
    const payload = normalizeDriverSeasons(list, year);
    const now = new Date();
    const counts = await prisma.$transaction(async (tx) =>
      mergePersistResults([
        await persistTeams(tx, JOLPICA_SOURCE, payload.teams, now),
        await persistDrivers(tx, JOLPICA_SOURCE, payload.drivers, now),
        await persistDriverSeasons(
          tx,
          JOLPICA_SOURCE,
          payload.driverSeasons,
          now,
        ),
      ]),
    );
    return this.report(year, "DRIVER_SEASONS", counts, started);
  }

  async syncRaces(year: number): Promise<JolpicaSyncReport> {
    const started = Date.now();
    const races = await this.client.getSeasonRaces(year);
    const items = normalizeRaces(races, year);
    const counts = await prisma.$transaction((tx) =>
      persistRaces(tx, JOLPICA_SOURCE, items, new Date()),
    );
    return this.report(year, "RACES", counts, started);
  }

  async syncResults(year: number): Promise<JolpicaSyncReport> {
    const started = Date.now();
    const races = await this.client.getSeasonRaces(year);
    const rounds = uniqueSortedRounds(races);
    const resultItems: NormalizedWithSource<NormalizedResult>[] = [];
    const driverItems = new Map<string, NormalizedWithSource<NormalizedDriver>>();
    for (const round of rounds) {
      const payload = await this.client.getRaceResults(year, round);
      const normalized = normalizeRaceResults(payload, year);
      resultItems.push(...normalized.results);
      for (const driver of normalized.drivers) {
        driverItems.set(driver.data.externalId, driver);
      }
      if (this.requestDelayMs > 0) {
        await this.sleep(this.requestDelayMs);
      }
    }
    const now = new Date();
    const counts = await prisma.$transaction(async (tx) =>
      mergePersistResults([
        await persistDrivers(
          tx,
          JOLPICA_SOURCE,
          [...driverItems.values()],
          now,
        ),
        await persistResults(tx, JOLPICA_SOURCE, resultItems, now),
      ]),
    );
    return this.report(year, "RESULTS", counts, started);
  }

  async syncStandings(year: number): Promise<JolpicaSyncReport> {
    const started = Date.now();
    const list = await this.client.getDriverStandings(year);
    const statics = normalizeDriversFromStandings(list.DriverStandings ?? []);
    const items = normalizeStandings(list, year);
    const now = new Date();
    const counts = await prisma.$transaction(async (tx) =>
      mergePersistResults([
        await persistDrivers(tx, JOLPICA_SOURCE, statics.drivers, now),
        await persistStandings(tx, JOLPICA_SOURCE, items, now),
      ]),
    );
    return this.report(year, "STANDINGS", counts, started);
  }

  private report(
    year: number,
    scope: JolpicaSyncScope,
    counts: PersistResult,
    started: number,
  ): JolpicaSyncReport {
    return {
      source: JOLPICA_SOURCE,
      year,
      scope,
      counts,
      durationMs: Date.now() - started,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function uniqueSortedRounds(races: JolpicaRaceRaw[]): number[] {
  const rounds: number[] = [];
  for (const race of races) {
    const round = Number.parseInt(String(race.round), 10);
    if (Number.isInteger(round)) rounds.push(round);
  }
  return [...new Set(rounds)].sort((a, b) => a - b);
}