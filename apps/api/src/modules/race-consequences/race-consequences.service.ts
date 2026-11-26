import type { Prisma } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { buildBehaviorContext } from "../behavior/behavior.context.js";
import { evaluateBehaviorDecision } from "../behavior/behavior.decision.js";
import { reconcileCharacterGoals } from "../behavior/behavior.goals.js";
import {
  invalidatePilotExperienceForCorrection,
  reconcilePilotExperiences,
} from "../pilot-experience/pilot-experience.reconcile.js";

export class RaceConsequencesError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "RaceConsequencesError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type RaceConsequenceCharacterResult = {
  readonly characterId: string;
  readonly position: number | null;
  readonly experiences: {
    created: number;
    updated: number;
    reactivated: number;
    invalidated: number;
  };
  readonly memories: { created: number; superseded: number; invalidated: number };
  readonly goals: { completed: number; failed: number; expired: number; created: number };
  readonly decisionCreated: boolean;
};

export type RaceConsequencesResult = {
  readonly raceId: string;
  readonly universeId: string;
  readonly characters: readonly RaceConsequenceCharacterResult[];
  readonly canonicalUntouched: true;
};

export async function processRaceConsequences(input: {
  readonly universeId: string;
  readonly raceId: string;
  readonly now?: Date;
  readonly triggerBehavior?: boolean;
}): Promise<RaceConsequencesResult> {
  const race = await prisma.race.findUnique({
    where: { id: input.raceId },
    select: {
      id: true,
      status: true,
      date: true,
      season: { select: { universeId: true } },
      results: {
        orderBy: [{ position: "asc" }, { driverProfileId: "asc" }],
        select: {
          position: true,
          driverProfile: {
            select: {
              id: true,
              character: { select: { id: true, universeId: true, controlledBy: true } },
            },
          },
        },
      },
    },
  });
  if (!race || race.season.universeId !== input.universeId) {
    throw new RaceConsequencesError("RACE_NOT_FOUND", "Corrida não encontrada", 404);
  }
  if (race.status !== "FINISHED") {
    throw new RaceConsequencesError("RACE_NOT_FINISHED", "Corrida ainda não finalizada", 409);
  }

  const worldState = await prisma.worldState.findUnique({
    where: { universeId_key: { universeId: input.universeId, key: "default" } },
    select: { currentDate: true },
  });
  const worldDate = race.date ?? worldState?.currentDate ?? input.now ?? new Date();
  const characters: RaceConsequenceCharacterResult[] = [];

  for (const result of race.results) {
    const character = result.driverProfile.character;
    if (!character || character.universeId !== input.universeId) continue;

    const experienceReport = await reconcilePilotExperiences({
      universeId: input.universeId,
      characterId: character.id,
      ...(input.now ? { now: input.now } : {}),
    });

    const context = await buildBehaviorContext({
      universeId: input.universeId,
      characterId: character.id,
      trigger: "RACE_FINISHED",
      worldDate,
      raceId: race.id,
      userInitiated: false,
    });
    const goalReport = await reconcileCharacterGoals(context, {
      universeId: input.universeId,
      characterId: character.id,
      trigger: "RACE_FINISHED",
      worldDate,
      raceId: race.id,
      userInitiated: false,
    });

    let decisionCreated = false;
    if (input.triggerBehavior !== false && character.controlledBy === "AI") {
      const existing = await prisma.aiDecision.findFirst({
        where: {
          characterId: character.id,
          AND: [
            { metadata: { path: ["trigger"], equals: "RACE_FINISHED" } },
            { metadata: { path: ["requestPayload", "raceId"], equals: race.id } },
          ],
        },
        select: { id: true },
      });
      if (!existing) {
        await evaluateBehaviorDecision({
          universeId: input.universeId,
          characterId: character.id,
          trigger: "RACE_FINISHED",
          worldDate,
          raceId: race.id,
          userInitiated: false,
        });
        decisionCreated = true;
      }
    }

    characters.push({
      characterId: character.id,
      position: result.position,
      experiences: {
        created: experienceReport.experiences.created,
        updated: experienceReport.experiences.updated,
        reactivated: experienceReport.experiences.reactivated,
        invalidated: experienceReport.experiences.invalidated,
      },
      memories: {
        created: experienceReport.memories.created,
        superseded: experienceReport.memories.superseded,
        invalidated: experienceReport.memories.invalidated,
      },
      goals: {
        completed: goalReport.completed,
        failed: goalReport.failed,
        expired: goalReport.expired,
        created: goalReport.created,
      },
      decisionCreated,
    });
  }

  return {
    raceId: race.id,
    universeId: input.universeId,
    characters,
    canonicalUntouched: true,
  };
}

export async function invalidateRaceConsequences(input: {
  readonly universeId: string;
  readonly raceId: string;
  readonly reason: string;
}): Promise<{ experiencesInvalidated: number; memoriesInvalidated: number }> {
  const race = await prisma.race.findUnique({
    where: { id: input.raceId },
    select: { id: true, season: { select: { universeId: true } } },
  });
  if (!race || race.season.universeId !== input.universeId) {
    throw new RaceConsequencesError("RACE_NOT_FOUND", "Corrida não encontrada", 404);
  }
  return prisma.$transaction((tx) =>
    invalidatePilotExperienceForCorrection(
      tx as Prisma.TransactionClient,
      input.universeId,
      { raceId: input.raceId },
      input.reason,
    ),
  );
}
