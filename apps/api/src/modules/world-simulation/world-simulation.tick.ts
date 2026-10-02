import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { createEventWithDerivations } from "../events/event-create.js";
import { processRaceConsequences } from "../race-consequences/race-consequences.service.js";
import {
  UNAVAILABLE_STATUSES,
  WORLD_SIMULATION_VERSION,
  worldSimulationBudgets,
} from "./world-simulation.policy.js";

export class SimulationTickError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "SimulationTickError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type SimulationTickSummary = {
  readonly scheduleDue: number;
  readonly planned: number;
  readonly eventsCreated: number;
  readonly newsCreated: number;
  readonly skippedByBudget: number;
  readonly skippedByCharacter: number;
  readonly skippedUnavailable: number;
  readonly skippedExisting: number;
  readonly dryRun: boolean;
  readonly racesDue: number;
  readonly racesProcessed: number;
  readonly raceExperiencesCreated: number;
  readonly raceMemoriesCreated: number;
  readonly raceDecisionsCreated: number;
};

export type SimulationTickResult = {
  readonly tickId: string;
  readonly status: string;
  readonly dryRun: boolean;
  readonly reused: boolean;
  readonly fingerprint: string;
  readonly window: { readonly from: string; readonly to: string };
  readonly summary: SimulationTickSummary | null;
};

function tickFingerprint(input: {
  universeId: string;
  fromDate: Date;
  toDate: Date;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        universeId: input.universeId,
        from: input.fromDate.toISOString(),
        to: input.toDate.toISOString(),
        version: WORLD_SIMULATION_VERSION,
      }),
    )
    .digest("hex");
}

function toSummary(value: unknown, dryRun: boolean): SimulationTickSummary {
  if (!value || typeof value !== "object") {
    return {
      scheduleDue: 0,
      planned: 0,
      eventsCreated: 0,
      newsCreated: 0,
      skippedByBudget: 0,
      skippedByCharacter: 0,
      skippedUnavailable: 0,
      skippedExisting: 0,
      dryRun,
      racesDue: 0,
      racesProcessed: 0,
      raceExperiencesCreated: 0,
      raceMemoriesCreated: 0,
      raceDecisionsCreated: 0,
    };
  }
  const record = value as Record<string, unknown>;
  const read = (key: string): number =>
    typeof record[key] === "number" ? (record[key] as number) : 0;
  return {
    scheduleDue: read("scheduleDue"),
    planned: read("planned"),
    eventsCreated: read("eventsCreated"),
    newsCreated: read("newsCreated"),
    skippedByBudget: read("skippedByBudget"),
    skippedByCharacter: read("skippedByCharacter"),
    skippedUnavailable: read("skippedUnavailable"),
    skippedExisting: read("skippedExisting"),
    dryRun,
    racesDue: read("racesDue"),
    racesProcessed: read("racesProcessed"),
    raceExperiencesCreated: read("raceExperiencesCreated"),
    raceMemoriesCreated: read("raceMemoriesCreated"),
    raceDecisionsCreated: read("raceDecisionsCreated"),
  };
}

export async function runSimulationTick(input: {
  readonly universeId: string;
  readonly fromDate?: Date;
  readonly toDate: Date;
  readonly dryRun?: boolean;
}): Promise<SimulationTickResult> {
  const universe = await prisma.universe.findUnique({
    where: { id: input.universeId },
    select: { id: true },
  });
  if (!universe) {
    throw new SimulationTickError("UNIVERSE_NOT_FOUND", "Universe não encontrado", 404);
  }
  const worldState = await prisma.worldState.findUnique({
    where: { universeId_key: { universeId: input.universeId, key: "default" } },
    select: { currentDate: true },
  });
  const toDate = input.toDate;
  const fromDate =
    input.fromDate ?? worldState?.currentDate ?? new Date(toDate.getTime() - 24 * 60 * 60 * 1000);
  if (toDate.getTime() <= fromDate.getTime()) {
    throw new SimulationTickError("INVALID_WINDOW", "Janela inválida", 400);
  }

  const fingerprint = tickFingerprint({ universeId: input.universeId, fromDate, toDate });
  const existing = await prisma.simulationTick.findUnique({ where: { fingerprint } });
  if (existing && existing.status !== "RUNNING") {
    return {
      tickId: existing.id,
      status: existing.status,
      dryRun: existing.dryRun,
      reused: true,
      fingerprint,
      window: { from: fromDate.toISOString(), to: toDate.toISOString() },
      summary: toSummary(existing.summary, existing.dryRun),
    };
  }
  if (existing && existing.status === "RUNNING") {
    const budgets = worldSimulationBudgets();
    const age = Date.now() - existing.startedAt.getTime();
    if (age < budgets.staleRunningMs) {
      return {
        tickId: existing.id,
        status: "RUNNING",
        dryRun: existing.dryRun,
        reused: true,
        fingerprint,
        window: { from: fromDate.toISOString(), to: toDate.toISOString() },
        summary: null,
      };
    }
    await prisma.simulationTick.update({
      where: { id: existing.id },
      data: { status: "FAILED", error: "stale running tick replaced", completedAt: new Date() },
    });
  }

  let tickId: string;
  try {
    const created = await prisma.simulationTick.create({
      data: {
        universeId: input.universeId,
        startWorldDate: fromDate,
        endWorldDate: toDate,
        simulationVersion: WORLD_SIMULATION_VERSION,
        status: "RUNNING",
        dryRun: input.dryRun === true,
        fingerprint,
      },
      select: { id: true },
    });
    tickId = created.id;
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      const concurrent = await prisma.simulationTick.findUniqueOrThrow({
        where: { fingerprint },
      });
      return {
        tickId: concurrent.id,
        status: concurrent.status,
        dryRun: concurrent.dryRun,
        reused: true,
        fingerprint,
        window: { from: fromDate.toISOString(), to: toDate.toISOString() },
        summary: toSummary(concurrent.summary, concurrent.dryRun),
      };
    }
    throw error;
  }

  const budgets = worldSimulationBudgets();
  try {
    const schedules = await prisma.characterSchedule.findMany({
      where: {
        character: { universeId: input.universeId },
        startsAt: { gte: fromDate, lte: toDate },
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        activity: true,
        startsAt: true,
        endsAt: true,
        characterId: true,
        character: {
          select: {
            name: true,
            availability: { select: { status: true } },
          },
        },
      },
    });

    const summary = {
      scheduleDue: schedules.length,
      planned: 0,
      eventsCreated: 0,
      newsCreated: 0,
      skippedByBudget: 0,
      skippedByCharacter: 0,
      skippedUnavailable: 0,
      skippedExisting: 0,
      dryRun: input.dryRun === true,
      plannedEvents: [] as unknown[],
      racesDue: 0,
      racesProcessed: 0,
      raceExperiencesCreated: 0,
      raceMemoriesCreated: 0,
      raceDecisionsCreated: 0,
    };
    const perCharacter = new Map<string, number>();

    for (const schedule of schedules) {
      const status = schedule.character.availability?.status;
      if (status && UNAVAILABLE_STATUSES.has(status)) {
        summary.skippedUnavailable += 1;
        continue;
      }
      if ((perCharacter.get(schedule.characterId) ?? 0) >= budgets.maxEventsPerCharacter) {
        summary.skippedByCharacter += 1;
        continue;
      }
      if (summary.planned >= budgets.maxEventsPerTick) {
        summary.skippedByBudget += 1;
        continue;
      }
      const existingEvent = await prisma.event.findFirst({
        where: {
          payload: { path: ["simulation", "scheduleId"], equals: schedule.id },
          worldDate: { gte: fromDate, lte: toDate },
        },
        select: { id: true },
      });
      if (existingEvent) {
        summary.skippedExisting += 1;
        continue;
      }
      const relationship = await prisma.relationship.findFirst({
        where: {
          OR: [
            { characterAId: schedule.characterId },
            { characterBId: schedule.characterId },
          ],
        },
        orderBy: { id: "asc" },
        select: { characterAId: true, characterBId: true },
      });
      const partnerId = relationship
        ? relationship.characterAId === schedule.characterId
          ? relationship.characterBId
          : relationship.characterAId
        : null;
      const title = `${schedule.character.name}: ${schedule.activity}`;
      summary.planned += 1;
      perCharacter.set(schedule.characterId, (perCharacter.get(schedule.characterId) ?? 0) + 1);
      summary.plannedEvents.push({
        scheduleId: schedule.id,
        characterId: schedule.characterId,
        title,
        worldDate: schedule.startsAt.toISOString(),
      });
      if (input.dryRun === true) continue;

      await prisma.$transaction(async (tx) => {
        const created = await createEventWithDerivations(
          tx,
          {
            type: "SOCIAL",
            title,
            description: `Atividade de agenda: ${schedule.activity}`,
            importance: "MEDIUM",
            source: "GENERATED_EVENT",
            worldDate: schedule.startsAt,
            payload: {
              simulation: {
                tickId,
                scheduleId: schedule.id,
                ruleCode: "simulation-rule.schedule-social.v1",
                simulationVersion: WORLD_SIMULATION_VERSION,
              },
            },
          },
          partnerId
            ? [schedule.characterId, partnerId]
            : [schedule.characterId],
        );
        summary.eventsCreated += 1;
        const newsCount = await tx.newsItem.count({ where: { eventId: created.id } });
        summary.newsCreated += newsCount;
      });
    }

    const dueRaces = await prisma.race.findMany({
      where: {
        season: { universeId: input.universeId },
        status: "FINISHED",
        date: { gte: fromDate, lte: toDate },
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      take: budgets.maxRacesPerTick,
      select: { id: true },
    });
    summary.racesDue = dueRaces.length;
    if (input.dryRun !== true) {
      for (const race of dueRaces) {
        const consequence = await processRaceConsequences({
          universeId: input.universeId,
          raceId: race.id,
          now: toDate,
        });
        summary.racesProcessed += 1;
        for (const character of consequence.characters) {
          summary.raceExperiencesCreated += character.experiences.created;
          summary.raceMemoriesCreated += character.memories.created;
          if (character.decisionCreated) summary.raceDecisionsCreated += 1;
        }
      }
    }

    await prisma.simulationTick.update({
      where: { id: tickId },
      data: {
        status: input.dryRun === true ? "DRY_RUN" : "COMPLETED",
        completedAt: new Date(),
        summary: summary as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      tickId,
      status: input.dryRun === true ? "DRY_RUN" : "COMPLETED",
      dryRun: input.dryRun === true,
      reused: false,
      fingerprint,
      window: { from: fromDate.toISOString(), to: toDate.toISOString() },
      summary,
    };
  } catch (error) {
    await prisma.simulationTick.update({
      where: { id: tickId },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        error: error instanceof Error ? error.message.slice(0, 300) : "unknown error",
      },
    });
    throw new SimulationTickError(
      "EXECUTION_FAILED",
      error instanceof Error ? error.message : "Falha na simulação",
      500,
    );
  }
}
