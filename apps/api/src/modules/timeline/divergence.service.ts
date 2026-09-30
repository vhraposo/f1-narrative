import { prisma } from "../../infrastructure/database/prisma.js";
import { TimelineError } from "./timeline.service.js";

export type DivergenceClassification =
  | "MATCH"
  | "DIVERGENT"
  | "NO_EXTERNAL"
  | "UNIVERSE_ONLY"
  | "EXTERNAL_ONLY";

export type DivergenceRaceItem = {
  classification: DivergenceClassification;
  raceId: string | null;
  externalRaceId: string | null;
  round: number | null;
  name: string;
  date: string | null;
  fields: string[];
};

export type DivergenceResultItem = {
  classification: DivergenceClassification;
  raceId: string | null;
  raceName: string | null;
  driverProfileId: string | null;
  driverName: string;
  position: number | null;
  externalPosition: number | null;
  grid: number | null;
  externalGrid: number | null;
  status: string | null;
  externalStatus: string | null;
  fields: string[];
};

export type DivergenceStandingItem = {
  classification: DivergenceClassification;
  driverProfileId: string | null;
  driverName: string;
  position: number | null;
  externalPosition: number | null;
  points: number | null;
  externalPoints: number | null;
  wins: number | null;
  externalWins: number | null;
  fields: string[];
};

export type DivergenceReport = {
  season: { id: string; year: number; name: string | null };
  races: DivergenceRaceItem[];
  results: DivergenceResultItem[];
  standings: DivergenceStandingItem[];
  summary: {
    match: number;
    divergent: number;
    noExternal: number;
    universeOnly: number;
    externalOnly: number;
  };
};

function isoDay(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function differs(a: unknown, b: unknown): boolean {
  return a !== b;
}

async function loadDivergenceData(
  universeId: string,
  seasonId: string,
  year: number,
) {
  const [races, results, externalRaces, externalResults, standings, externalStandings] =
    await Promise.all([
      prisma.race.findMany({
        where: { seasonId },
        select: {
          id: true,
          round: true,
          name: true,
          date: true,
          externalRaceBindings: {
            where: { universeId },
            select: {
              externalRace: {
                select: {
                  id: true,
                  round: true,
                  date: true,
                  grandPrix: true,
                  name: true,
                },
              },
            },
          },
        },
        orderBy: [{ round: "asc" }, { name: "asc" }],
      }),
      prisma.raceResult.findMany({
        where: { race: { seasonId } },
        select: {
          raceId: true,
          driverProfileId: true,
          position: true,
          grid: true,
          status: true,
          race: { select: { name: true } },
          driverProfile: { select: { character: { select: { name: true } } } },
          externalBindings: {
            where: { universeId },
            select: {
              externalResult: {
                select: {
                  position: true,
                  grid: true,
                  status: true,
                },
              },
            },
          },
        },
        orderBy: [{ race: { round: "asc" } }, { position: "asc" }],
      }),
      prisma.externalRace.findMany({
        where: { seasonYear: year, bindings: { none: { universeId } } },
        select: {
          id: true,
          round: true,
          date: true,
          grandPrix: true,
          name: true,
        },
        orderBy: [{ round: "asc" }],
      }),
      prisma.externalResult.findMany({
        where: {
          externalRace: { seasonYear: year },
          bindings: { none: { universeId } },
        },
        select: {
          position: true,
          grid: true,
          status: true,
          externalDriver: { select: { name: true } },
          externalRace: { select: { grandPrix: true, name: true } },
        },
      }),
      prisma.championshipStanding.findMany({
        where: { seasonId },
        select: {
          driverProfileId: true,
          position: true,
          points: true,
          wins: true,
          driverProfile: { select: { character: { select: { name: true } } } },
          externalBindings: {
            where: { universeId },
            select: {
              externalStanding: {
                select: {
                  position: true,
                  points: true,
                  wins: true,
                },
              },
            },
          },
        },
        orderBy: [{ position: "asc" }, { driverProfileId: "asc" }],
      }),
      prisma.externalStanding.findMany({
        where: { seasonYear: year, bindings: { none: { universeId } } },
        select: {
          position: true,
          points: true,
          wins: true,
          externalDriver: { select: { name: true } },
        },
      }),
    ]);

  return {
    races,
    results,
    externalRaces,
    externalResults,
    standings,
    externalStandings,
  };
}

export async function buildDivergenceReport(
  universeId: string,
  seasonId: string,
): Promise<DivergenceReport> {
  const season = await prisma.season.findFirst({
    where: { id: seasonId, universeId },
    select: { id: true, year: true, name: true },
  });
  if (!season) {
    throw new TimelineError(
      "SEASON_NOT_FOUND",
      "Temporada não pertence a este universo.",
      404,
    );
  }

  const data = await loadDivergenceData(universeId, season.id, season.year);

  const raceItems: DivergenceRaceItem[] = [];
  for (const race of data.races) {
    const external = race.externalRaceBindings[0]?.externalRace ?? null;
    if (!external) {
      raceItems.push({
        classification: "UNIVERSE_ONLY",
        raceId: race.id,
        externalRaceId: null,
        round: race.round,
        name: race.name,
        date: isoDay(race.date),
        fields: [],
      });
      continue;
    }
    const fields: string[] = [];
    if (differs(external.round, race.round)) fields.push("round");
    if (differs(isoDay(external.date), isoDay(race.date))) fields.push("date");
    const externalName = external.grandPrix ?? external.name ?? null;
    if (externalName !== null && externalName !== race.name) fields.push("name");
    raceItems.push({
      classification: fields.length === 0 ? "MATCH" : "DIVERGENT",
      raceId: race.id,
      externalRaceId: external.id,
      round: race.round,
      name: race.name,
      date: isoDay(race.date),
      fields,
    });
  }
  for (const external of data.externalRaces) {
    raceItems.push({
      classification: "EXTERNAL_ONLY",
      raceId: null,
      externalRaceId: external.id,
      round: external.round,
      name: external.grandPrix ?? external.name ?? "Corrida externa",
      date: isoDay(external.date),
      fields: [],
    });
  }
  raceItems.sort((a, b) => {
    const roundA = a.round ?? Number.MAX_SAFE_INTEGER;
    const roundB = b.round ?? Number.MAX_SAFE_INTEGER;
    if (roundA !== roundB) return roundA - roundB;
    return a.name.localeCompare(b.name);
  });

  const resultItems: DivergenceResultItem[] = [];
  for (const result of data.results) {
    const external = result.externalBindings[0]?.externalResult ?? null;
    if (!external) {
      resultItems.push({
        classification: "UNIVERSE_ONLY",
        raceId: result.raceId,
        raceName: result.race.name,
        driverProfileId: result.driverProfileId,
        driverName: result.driverProfile.character.name,
        position: result.position,
        externalPosition: null,
        grid: result.grid,
        externalGrid: null,
        status: result.status,
        externalStatus: null,
        fields: [],
      });
      continue;
    }
    const fields: string[] = [];
    if (differs(external.position, result.position)) fields.push("position");
    if (differs(external.grid, result.grid)) fields.push("grid");
    if (differs(external.status, result.status)) fields.push("status");
    resultItems.push({
      classification: fields.length === 0 ? "MATCH" : "DIVERGENT",
      raceId: result.raceId,
      raceName: result.race.name,
      driverProfileId: result.driverProfileId,
      driverName: result.driverProfile.character.name,
      position: result.position,
      externalPosition: external.position,
      grid: result.grid,
      externalGrid: external.grid,
      status: result.status,
      externalStatus: external.status,
      fields,
    });
  }
  for (const external of data.externalResults) {
    resultItems.push({
      classification: "EXTERNAL_ONLY",
      raceId: null,
      raceName:
        external.externalRace.grandPrix ?? external.externalRace.name ?? null,
      driverProfileId: null,
      driverName: external.externalDriver.name,
      position: null,
      externalPosition: external.position,
      grid: null,
      externalGrid: external.grid,
      status: null,
      externalStatus: external.status,
      fields: [],
    });
  }

  const standingItems: DivergenceStandingItem[] = [];
  for (const standing of data.standings) {
    const external = standing.externalBindings[0]?.externalStanding ?? null;
    if (!external) {
      standingItems.push({
        classification: "UNIVERSE_ONLY",
        driverProfileId: standing.driverProfileId,
        driverName: standing.driverProfile.character.name,
        position: standing.position,
        externalPosition: null,
        points: standing.points,
        externalPoints: null,
        wins: standing.wins,
        externalWins: null,
        fields: [],
      });
      continue;
    }
    const fields: string[] = [];
    if (differs(external.position, standing.position)) fields.push("position");
    if (differs(external.points, standing.points)) fields.push("points");
    if (differs(external.wins ?? null, standing.wins)) fields.push("wins");
    standingItems.push({
      classification: fields.length === 0 ? "MATCH" : "DIVERGENT",
      driverProfileId: standing.driverProfileId,
      driverName: standing.driverProfile.character.name,
      position: standing.position,
      externalPosition: external.position,
      points: standing.points,
      externalPoints: external.points,
      wins: standing.wins,
      externalWins: external.wins,
      fields,
    });
  }
  for (const external of data.externalStandings) {
    standingItems.push({
      classification: "EXTERNAL_ONLY",
      driverProfileId: null,
      driverName: external.externalDriver.name,
      position: null,
      externalPosition: external.position,
      points: null,
      externalPoints: external.points,
      wins: null,
      externalWins: external.wins,
      fields: [],
    });
  }

  const all: DivergenceClassification[] = [
    ...raceItems.map((item) => item.classification),
    ...resultItems.map((item) => item.classification),
    ...standingItems.map((item) => item.classification),
  ];

  return {
    season,
    races: raceItems,
    results: resultItems,
    standings: standingItems,
    summary: {
      match: all.filter((item) => item === "MATCH").length,
      divergent: all.filter((item) => item === "DIVERGENT").length,
      noExternal: all.filter((item) => item === "NO_EXTERNAL").length,
      universeOnly: all.filter((item) => item === "UNIVERSE_ONLY").length,
      externalOnly: all.filter((item) => item === "EXTERNAL_ONLY").length,
    },
  };
}
