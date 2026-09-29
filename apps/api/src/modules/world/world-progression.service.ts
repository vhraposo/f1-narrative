import type { Prisma, RaceSession } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { finalizeRaceInTx } from "../championship/championship-progression.service.js";
import {
  effectiveSprintValue,
  weekendSequenceFor,
  weekendStatusPosition,
} from "../race-weekend/race-weekend.service.js";
import {
  appendTimelineEvent,
  lockUniverseTimeline,
} from "../timeline/timeline.service.js";
import { ensureUniverse } from "../universe/universe.service.js";

const WORLD_KEY = "default";

const worldSelect = {
  id: true,
  key: true,
  currentDate: true,
  currentSeasonId: true,
  currentRaceId: true,
  currentSession: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type WorldTransitionType =
  | "RACE_SELECTED"
  | "SESSION_ADVANCED"
  | "WEEKEND_FINALIZED"
  | "STALE_POINTER_CLEARED";

export type WorldTransition = {
  type: WorldTransitionType;
  raceId: string;
  fromSession: RaceSession | null;
  toSession: RaceSession | null;
};

export type ProgressWorldStateResult = {
  world: {
    id: string;
    key: string;
    currentDate: Date;
    currentSeasonId: string | null;
    currentRaceId: string | null;
    currentSession: RaceSession | null;
    createdAt: Date;
    updatedAt: Date;
  };
  changed: boolean;
  transition: WorldTransition | null;
};

export async function progressWorldState(
  userId: string,
): Promise<ProgressWorldStateResult> {
  const universe = await ensureUniverse(userId);

  return prisma.$transaction(async (tx) => {
    await lockUniverseTimeline(tx, universe.id);

    const world = await tx.worldState.upsert({
      where: { universeId_key: { universeId: universe.id, key: WORLD_KEY } },
      update: {},
      create: { universeId: universe.id, key: WORLD_KEY },
      select: worldSelect,
    });

    const noChange = async (): Promise<ProgressWorldStateResult> => ({
      world,
      changed: false,
      transition: null,
    });

    if (!world.currentRaceId) {
      if (!world.currentSeasonId) return noChange();
      const season = await tx.season.findFirst({
        where: { id: world.currentSeasonId, universeId: universe.id },
        select: { id: true },
      });
      if (!season) {
        const updated = await tx.worldState.update({
          where: { id: world.id },
          data: { currentSeasonId: null, currentSession: null },
          select: worldSelect,
        });
        await appendWorldAdvancedEvent(tx, universe.id, {
          currentDate: world.currentDate,
          currentSeasonId: null,
          currentRaceId: null,
          currentSession: null,
        });
        return {
          world: updated,
          changed: true,
          transition: {
            type: "STALE_POINTER_CLEARED",
            raceId: "",
            fromSession: world.currentSession,
            toSession: null,
          },
        };
      }
      const firstRace = await tx.race.findFirst({
        where: { seasonId: world.currentSeasonId, status: { not: "FINISHED" } },
        orderBy: [{ round: "asc" }, { date: "asc" }, { id: "asc" }],
        select: {
          id: true,
          status: true,
          seasonId: true,
          sprintOverride: true,
          sprintExternal: true,
          season: { select: { universeId: true } },
        },
      });
      if (!firstRace || firstRace.season.universeId !== universe.id) {
        return noChange();
      }
      const sequence = weekendSequenceFor(effectiveSprintValue(firstRace));
      const toSession = sequence[0] ?? null;
      if (toSession === null) return noChange();
      const updated = await tx.worldState.update({
        where: { id: world.id },
        data: {
          currentSeasonId: firstRace.seasonId,
          currentRaceId: firstRace.id,
          currentSession: toSession,
        },
        select: worldSelect,
      });
      await appendWorldAdvancedEvent(tx, universe.id, {
        currentDate: world.currentDate,
        currentSeasonId: firstRace.seasonId,
        currentRaceId: firstRace.id,
        currentSession: toSession,
      });
      return {
        world: updated,
        changed: true,
        transition: {
          type: "RACE_SELECTED",
          raceId: firstRace.id,
          fromSession: null,
          toSession,
        },
      };
    }

    const race = await tx.race.findUnique({
      where: { id: world.currentRaceId },
      select: {
        id: true,
        status: true,
        seasonId: true,
        sprintOverride: true,
        sprintExternal: true,
        season: { select: { universeId: true } },
      },
    });
    if (!race || race.season.universeId !== universe.id) {
      const danglingRaceId = world.currentRaceId;
      const updated = await tx.worldState.update({
        where: { id: world.id },
        data: { currentRaceId: null, currentSession: null },
        select: worldSelect,
      });
      await appendWorldAdvancedEvent(tx, universe.id, {
        currentDate: world.currentDate,
        currentSeasonId: world.currentSeasonId,
        currentRaceId: null,
        currentSession: null,
      });
      return {
        world: updated,
        changed: true,
        transition: {
          type: "STALE_POINTER_CLEARED",
          raceId: danglingRaceId,
          fromSession: world.currentSession,
          toSession: null,
        },
      };
    }

    const sequence = weekendSequenceFor(effectiveSprintValue(race));

    if (race.status === "FINISHED") {
      if (world.currentSession === null) return noChange();
      const updated = await tx.worldState.update({
        where: { id: world.id },
        data: { currentSession: null },
        select: worldSelect,
      });
      await appendWorldAdvancedEvent(tx, universe.id, {
        currentDate: world.currentDate,
        currentSeasonId: race.seasonId,
        currentRaceId: race.id,
        currentSession: null,
      });
      return {
        world: updated,
        changed: true,
        transition: {
          type: "WEEKEND_FINALIZED",
          raceId: race.id,
          fromSession: world.currentSession,
          toSession: null,
        },
      };
    }

    if (race.status === "RACE") {
      const classified = await tx.raceResult.count({
        where: { raceId: race.id, position: { not: null } },
      });
      if (classified === 0) return noChange();
      await finalizeRaceInTx(tx, {
        raceId: race.id,
        seasonId: race.seasonId,
        universeId: universe.id,
      });
      const updated = await tx.worldState.findUniqueOrThrow({
        where: { id: world.id },
        select: worldSelect,
      });
      await appendWorldAdvancedEvent(tx, universe.id, {
        currentDate: world.currentDate,
        currentSeasonId: race.seasonId,
        currentRaceId: race.id,
        currentSession: null,
      });
      return {
        world: updated,
        changed: true,
        transition: {
          type: "WEEKEND_FINALIZED",
          raceId: race.id,
          fromSession: "RACE",
          toSession: null,
        },
      };
    }

    const nextSession =
      sequence[weekendStatusPosition(race.status, sequence) + 1] ?? null;
    if (nextSession === null || world.currentSession === nextSession) {
      return noChange();
    }
    const updated = await tx.worldState.update({
      where: { id: world.id },
      data: {
        currentSeasonId: race.seasonId,
        currentRaceId: race.id,
        currentSession: nextSession,
      },
      select: worldSelect,
    });
    await appendWorldAdvancedEvent(tx, universe.id, {
      currentDate: world.currentDate,
      currentSeasonId: race.seasonId,
      currentRaceId: race.id,
      currentSession: nextSession,
    });
    return {
      world: updated,
      changed: true,
      transition: {
        type: "SESSION_ADVANCED",
        raceId: race.id,
        fromSession: world.currentSession,
        toSession: nextSession,
      },
    };
  });
}

async function appendWorldAdvancedEvent(
  tx: Prisma.TransactionClient,
  universeId: string,
  payload: {
    currentDate: Date;
    currentSeasonId: string | null;
    currentRaceId: string | null;
    currentSession: RaceSession | null;
  },
): Promise<void> {
  await appendTimelineEvent(tx, universeId, {
    kind: "WORLD_ADVANCED",
    worldDate: payload.currentDate,
    causedBy: "USER",
    payload: {
      currentDate: payload.currentDate.toISOString(),
      currentSeasonId: payload.currentSeasonId,
      currentRaceId: payload.currentRaceId,
      currentSession: payload.currentSession,
    },
  });
}
