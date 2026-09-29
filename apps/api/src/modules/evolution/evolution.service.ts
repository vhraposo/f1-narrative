import type { Prisma } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import {
  appendTimelineEvent,
  lockUniverseTimeline,
} from "../timeline/timeline.service.js";
import { ensureUniverse } from "../universe/universe.service.js";
import {
  DEFAULT_ATTRIBUTES,
  DEFAULT_PERFORMANCE,
  evaluateSeasonEvolution,
  type AttributeValues,
  type EvolutionChangeSet,
  type PerformanceValues,
  type SeasonResultRow,
} from "./evolution.engine.js";

const WORLD_KEY = "default";

export class EvolutionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "EvolutionError";
  }
}

async function resolveSeason(
  userId: string,
  seasonId: string,
): Promise<{ universeId: string; seasonId: string }> {
  const universe = await ensureUniverse(userId);
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    select: { id: true, universeId: true },
  });
  if (!season) {
    throw new EvolutionError("SEASON_NOT_FOUND", "Temporada não encontrada", 404);
  }
  if (season.universeId !== universe.id) {
    throw new EvolutionError(
      "SEASON_NOT_IN_UNIVERSE",
      "Temporada não pertence ao seu Universe",
      403,
    );
  }
  return { universeId: universe.id, seasonId: season.id };
}

async function buildChangeSet(
  universeId: string,
  seasonId: string,
): Promise<EvolutionChangeSet> {
  const [entries, races] = await Promise.all([
    prisma.seasonDriverEntry.findMany({
      where: { seasonId, status: "ACTIVE" },
      select: {
        driverProfileId: true,
        teamId: true,
        driverProfile: { select: { character: { select: { name: true } } } },
      },
    }),
    prisma.race.findMany({
      where: { seasonId, status: "FINISHED" },
      select: { id: true, round: true, date: true },
    }),
  ]);

  const raceMeta = new Map(
    races.map((race) => [
      race.id,
      { round: race.round, date: race.date },
    ]),
  );
  const teamByDriver = new Map(
    entries.map((entry) => [entry.driverProfileId, entry.teamId]),
  );
  const driverIds = entries.map((entry) => entry.driverProfileId);
  const teamIds = [
    ...new Set(
      entries
        .map((entry) => entry.teamId)
        .filter((value): value is string => value !== null),
    ),
  ];

  const raceIds = races.map((race) => race.id);
  const [resultRows, attributeRows, performanceRows, teams] = await Promise.all([
    raceIds.length
      ? prisma.raceResult.findMany({
          where: { raceId: { in: raceIds } },
          select: {
            raceId: true,
            driverProfileId: true,
            position: true,
            grid: true,
            status: true,
            points: true,
          },
        })
      : Promise.resolve([]),
    driverIds.length
      ? prisma.driverAttribute.findMany({
          where: { seasonId, driverProfileId: { in: driverIds } },
        })
      : Promise.resolve([]),
    teamIds.length
      ? prisma.teamPerformance.findMany({
          where: { seasonId, teamId: { in: teamIds } },
        })
      : Promise.resolve([]),
    teamIds.length
      ? prisma.team.findMany({
          where: { id: { in: teamIds }, universeId },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const attributesByDriver = new Map(
    attributeRows.map((row) => [
      row.driverProfileId,
      {
        speed: row.speed,
        consistency: row.consistency,
        racecraft: row.racecraft,
        aggression: row.aggression,
      } satisfies AttributeValues,
    ]),
  );
  const performanceByTeam = new Map(
    performanceRows.map((row) => [
      row.teamId,
      {
        carSpeed: row.carSpeed,
        reliability: row.reliability,
        operations: row.operations,
      } satisfies PerformanceValues,
    ]),
  );

  const results: SeasonResultRow[] = resultRows.map((row) => ({
    raceId: row.raceId,
    round: raceMeta.get(row.raceId)?.round ?? null,
    date: raceMeta.get(row.raceId)?.date ?? null,
    driverProfileId: row.driverProfileId,
    teamId: teamByDriver.get(row.driverProfileId) ?? null,
    position: row.position,
    grid: row.grid,
    status: row.status,
    points: row.points,
  }));

  return evaluateSeasonEvolution({
    seasonId,
    results,
    drivers: entries.map((entry) => ({
      driverProfileId: entry.driverProfileId,
      name: entry.driverProfile.character.name,
      attributes:
        attributesByDriver.get(entry.driverProfileId) ?? { ...DEFAULT_ATTRIBUTES },
    })),
    teams: teams.map((team) => ({
      teamId: team.id,
      name: team.name,
      performance:
        performanceByTeam.get(team.id) ?? { ...DEFAULT_PERFORMANCE },
    })),
  });
}

export async function evaluateSeasonEvolutionForUser(
  userId: string,
  seasonId: string,
): Promise<EvolutionChangeSet> {
  const resolved = await resolveSeason(userId, seasonId);
  const changeSet = await buildChangeSet(resolved.universeId, resolved.seasonId);
  if (!changeSet.changed) return changeSet;

  const applied = await prisma.timelineEvent.findFirst({
    where: {
      universeId: resolved.universeId,
      kind: "ATTRIBUTE_EVOLVED",
      AND: [
        { payload: { path: ["seasonId"], equals: resolved.seasonId } },
        { payload: { path: ["fingerprint"], equals: changeSet.fingerprint } },
      ],
    },
    select: { id: true },
  });
  if (applied) {
    return { ...changeSet, changed: false, alreadyApplied: true };
  }
  return changeSet;
}

export async function applySeasonEvolution(
  userId: string,
  seasonId: string,
): Promise<EvolutionChangeSet> {
  const resolved = await resolveSeason(userId, seasonId);
  const changeSet = await buildChangeSet(resolved.universeId, resolved.seasonId);
  if (!changeSet.changed) {
    throw new EvolutionError(
      "NO_CHANGES",
      "Nenhuma mudança de atributos/performance a aplicar",
      409,
    );
  }

  return prisma.$transaction(async (tx) => {
    await lockUniverseTimeline(tx, resolved.universeId);

    const existing = await tx.timelineEvent.findFirst({
      where: {
        universeId: resolved.universeId,
        kind: "ATTRIBUTE_EVOLVED",
        AND: [
          { payload: { path: ["seasonId"], equals: resolved.seasonId } },
          { payload: { path: ["fingerprint"], equals: changeSet.fingerprint } },
        ],
      },
      select: { id: true },
    });
    if (existing) {
      throw new EvolutionError(
        "ALREADY_APPLIED",
        "Evolução já aplicada para estes resultados",
        409,
      );
    }

    for (const change of changeSet.drivers) {
      await tx.driverAttribute.upsert({
        where: {
          seasonId_driverProfileId: {
            seasonId: resolved.seasonId,
            driverProfileId: change.driverProfileId,
          },
        },
        create: {
          seasonId: resolved.seasonId,
          driverProfileId: change.driverProfileId,
          ...change.after,
        },
        update: { ...change.after },
      });
    }

    for (const change of changeSet.teams) {
      await tx.teamPerformance.upsert({
        where: {
          seasonId_teamId: {
            seasonId: resolved.seasonId,
            teamId: change.teamId,
          },
        },
        create: {
          seasonId: resolved.seasonId,
          teamId: change.teamId,
          ...change.after,
        },
        update: { ...change.after },
      });
    }

    const world = await tx.worldState.findUnique({
      where: {
        universeId_key: { universeId: resolved.universeId, key: WORLD_KEY },
      },
      select: { currentDate: true },
    });

    await appendTimelineEvent(tx, resolved.universeId, {
      kind: "ATTRIBUTE_EVOLVED",
      worldDate: world?.currentDate ?? new Date(),
      causedBy: "USER",
      payload: {
        seasonId: resolved.seasonId,
        fingerprint: changeSet.fingerprint,
        racesConsidered: changeSet.racesConsidered,
        drivers: changeSet.drivers,
        teams: changeSet.teams,
      } as Prisma.InputJsonValue,
    });

    return changeSet;
  });
}

export async function getSeasonEvolutionStatus(
  userId: string,
  seasonId: string,
): Promise<{
  seasonId: string;
  lastRun: {
    worldDate: Date;
    appliedAt: Date;
    fingerprint: string | null;
    racesConsidered: number | null;
    driverChanges: number;
    teamChanges: number;
  } | null;
}> {
  const resolved = await resolveSeason(userId, seasonId);
  const event = await prisma.timelineEvent.findFirst({
    where: {
      universeId: resolved.universeId,
      kind: "ATTRIBUTE_EVOLVED",
      payload: { path: ["seasonId"], equals: resolved.seasonId },
    },
    orderBy: { sequence: "desc" },
    select: { worldDate: true, createdAt: true, payload: true },
  });
  if (!event) {
    return { seasonId: resolved.seasonId, lastRun: null };
  }
  const payload =
    event.payload !== null &&
    typeof event.payload === "object" &&
    !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : {};
  const drivers = Array.isArray(payload.drivers) ? payload.drivers.length : 0;
  const teams = Array.isArray(payload.teams) ? payload.teams.length : 0;
  return {
    seasonId: resolved.seasonId,
    lastRun: {
      worldDate: event.worldDate,
      appliedAt: event.createdAt,
      fingerprint:
        typeof payload.fingerprint === "string" ? payload.fingerprint : null,
      racesConsidered:
        typeof payload.racesConsidered === "number"
          ? payload.racesConsidered
          : null,
      driverChanges: drivers,
      teamChanges: teams,
    },
  };
}
