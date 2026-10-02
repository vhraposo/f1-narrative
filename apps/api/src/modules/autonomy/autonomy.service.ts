import type { AiActionType } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { buildBehaviorContext } from "../behavior/behavior.context.js";
import { evaluateBehaviorDecision } from "../behavior/behavior.decision.js";
import { executeBehaviorDecision } from "../behavior/behavior.execution.js";
import { evaluateBehaviorPolicy } from "../behavior/behavior.policy.js";
import { resolveCharacterGoals } from "../behavior/behavior.goals.js";
import { runSimulationTick } from "../world-simulation/world-simulation.tick.js";
import { AUTONOMY_VERSION, autonomyBudgets } from "./autonomy.policy.js";

export class AutonomyError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "AutonomyError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type AutonomyStateView = {
  readonly universeId: string;
  readonly mode: string;
  readonly status: string;
  readonly lastSimulationAt: Date | null;
  readonly nextSimulationAt: Date | null;
  readonly simulationVersion: string | null;
};

export type AutonomyTickResult = {
  readonly universeId: string;
  readonly status: "EXECUTED" | "DRY_RUN" | "REUSED" | "SKIPPED";
  readonly reasonCode: string;
  readonly mode: string;
  readonly tickId: string | null;
  readonly decisionsEvaluated: number;
  readonly actionsExecuted: number;
  readonly actionsRejected: number;
  readonly budgetExhausted: boolean;
  readonly planned: ReadonlyArray<{
    characterId: string;
    actionType: string;
    reasonCode: string;
    goalIds: readonly string[];
  }>;
};

export async function getAutonomyState(universeId: string): Promise<AutonomyStateView> {
  const universe = await prisma.universe.findUnique({
    where: { id: universeId },
    select: {
      id: true,
      autonomyMode: true,
      autonomyStatus: true,
      lastSimulationAt: true,
      nextSimulationAt: true,
      simulationVersion: true,
    },
  });
  if (!universe) throw new AutonomyError("UNIVERSE_NOT_FOUND", "Universe não encontrado", 404);
  return {
    universeId: universe.id,
    mode: universe.autonomyMode,
    status: universe.autonomyStatus,
    lastSimulationAt: universe.lastSimulationAt,
    nextSimulationAt: universe.nextSimulationAt,
    simulationVersion: universe.simulationVersion,
  };
}

export async function updateAutonomy(
  universeId: string,
  input: { readonly mode?: "OFF" | "OBSERVER" | "GUIDED" | "FULL"; readonly status?: "ACTIVE" | "PAUSED" | "STOPPED" },
): Promise<AutonomyStateView> {
  await getAutonomyState(universeId);
  await prisma.universe.update({
    where: { id: universeId },
    data: {
      ...(input.mode ? { autonomyMode: input.mode } : {}),
      ...(input.status ? { autonomyStatus: input.status } : {}),
    },
  });
  return getAutonomyState(universeId);
}

async function listAutonomousCharacters(universeId: string, limit: number) {
  const characters = await prisma.character.findMany({
    where: { universeId, controlledBy: "AI" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (characters.length === 0) return [];
  const lastDecisions = await prisma.aiDecision.groupBy({
    by: ["characterId"],
    where: { universeId, characterId: { in: characters.map((character) => character.id) } },
    _max: { createdAt: true },
  });
  const lastByCharacter = new Map(
    lastDecisions.map((entry) => [entry.characterId, entry._max.createdAt ?? null]),
  );
  return characters
    .map((character) => ({
      characterId: character.id,
      lastActionAt: lastByCharacter.get(character.id) ?? null,
    }))
    .sort((a, b) => {
      const aTime = a.lastActionAt?.getTime() ?? 0;
      const bTime = b.lastActionAt?.getTime() ?? 0;
      if (aTime !== bTime) return aTime - bTime;
      return a.characterId.localeCompare(b.characterId);
    })
    .slice(0, limit);
}

export async function runAutonomousTick(input: {
  readonly universeId: string;
  readonly dryRun?: boolean;
  readonly toDate?: Date;
}): Promise<AutonomyTickResult> {
  const state = await getAutonomyState(input.universeId);
  if (state.mode === "OFF") {
    return {
      universeId: input.universeId,
      status: "SKIPPED",
      reasonCode: "AUTONOMY_DISABLED",
      mode: state.mode,
      tickId: null,
      decisionsEvaluated: 0,
      actionsExecuted: 0,
      actionsRejected: 0,
      budgetExhausted: false,
      planned: [],
    };
  }
  if (state.status !== "ACTIVE") {
    return {
      universeId: input.universeId,
      status: "SKIPPED",
      reasonCode: state.status === "PAUSED" ? "AUTONOMY_PAUSED" : "AUTONOMY_STOPPED",
      mode: state.mode,
      tickId: null,
      decisionsEvaluated: 0,
      actionsExecuted: 0,
      actionsRejected: 0,
      budgetExhausted: false,
      planned: [],
    };
  }

  const budgets = autonomyBudgets();
  const worldState = await prisma.worldState.findUnique({
    where: { universeId_key: { universeId: input.universeId, key: "default" } },
    select: { currentDate: true },
  });
  const fromDate = state.lastSimulationAt ?? worldState?.currentDate ?? new Date();
  if (input.toDate && input.toDate.getTime() <= fromDate.getTime()) {
    return {
      universeId: input.universeId,
      status: "REUSED",
      reasonCode: "WINDOW_ALREADY_PROCESSED",
      mode: state.mode,
      tickId: null,
      decisionsEvaluated: 0,
      actionsExecuted: 0,
      actionsRejected: 0,
      budgetExhausted: false,
      planned: [],
    };
  }
  const toDate =
    input.toDate ?? new Date(fromDate.getTime() + budgets.tickWindowHours * 60 * 60 * 1000);

  if (input.dryRun === true) {
    const tick = await runSimulationTick({
      universeId: input.universeId,
      fromDate,
      toDate,
      dryRun: true,
    });
    const characters = await listAutonomousCharacters(
      input.universeId,
      budgets.maxAutonomousCharacters,
    );
    const planned: Array<{
      characterId: string;
      actionType: string;
      reasonCode: string;
      goalIds: readonly string[];
    }> = [];
    for (const entry of characters) {
      const context = await buildBehaviorContext({
        universeId: input.universeId,
        characterId: entry.characterId,
        trigger: "AUTONOMOUS_TICK",
        worldDate: toDate,
        userInitiated: false,
      });
      const goals = await resolveCharacterGoals(context, {
        universeId: input.universeId,
        characterId: entry.characterId,
        trigger: "AUTONOMOUS_TICK",
        worldDate: toDate,
        userInitiated: false,
      });
      const policy = evaluateBehaviorPolicy(
        context,
        {
          universeId: input.universeId,
          characterId: entry.characterId,
          trigger: "AUTONOMOUS_TICK",
          worldDate: toDate,
          userInitiated: false,
        },
        { goals },
      );
      planned.push({
        characterId: entry.characterId,
        actionType: policy.selected.actionType,
        reasonCode: policy.selected.reasonCode,
        goalIds: policy.selected.goalIds,
      });
    }
    return {
      universeId: input.universeId,
      status: "DRY_RUN",
      reasonCode: "DRY_RUN",
      mode: state.mode,
      tickId: tick.tickId,
      decisionsEvaluated: planned.length,
      actionsExecuted: 0,
      actionsRejected: 0,
      budgetExhausted: false,
      planned,
    };
  }

  const tick = await runSimulationTick({
    universeId: input.universeId,
    fromDate,
    toDate,
  });
  if (tick.reused) {
    return {
      universeId: input.universeId,
      status: "REUSED",
      reasonCode: "TICK_ALREADY_PROCESSED",
      mode: state.mode,
      tickId: tick.tickId,
      decisionsEvaluated: 0,
      actionsExecuted: 0,
      actionsRejected: 0,
      budgetExhausted: false,
      planned: [],
    };
  }

  const characters = await listAutonomousCharacters(
    input.universeId,
    budgets.maxAutonomousCharacters,
  );
  let decisionsEvaluated = 0;
  let actionsExecuted = 0;
  let actionsRejected = 0;
  let budgetExhausted = false;
  const perType = new Map<AiActionType, number>();

  for (const entry of characters) {
    if (actionsExecuted >= budgets.maxActionsPerTick) {
      budgetExhausted = true;
      break;
    }
    const existing = await prisma.aiDecision.findFirst({
      where: {
        characterId: entry.characterId,
        metadata: { path: ["requestPayload", "tickId"], equals: tick.tickId },
      },
      select: { id: true },
    });
    if (existing) continue;

    const relationship = await prisma.relationship.findFirst({
      where: {
        OR: [
          { characterAId: entry.characterId },
          { characterBId: entry.characterId },
        ],
      },
      orderBy: { id: "asc" },
      select: { characterAId: true, characterBId: true },
    });
    const targetCharacterId = relationship
      ? relationship.characterAId === entry.characterId
        ? relationship.characterBId
        : relationship.characterAId
      : null;
    const conversation =
      targetCharacterId === null
        ? null
        : await prisma.conversation.findFirst({
            where: {
              AND: [
                { participants: { some: { characterId: entry.characterId } } },
                { participants: { some: { characterId: targetCharacterId } } },
              ],
            },
            orderBy: { createdAt: "asc" },
            select: { id: true },
          });

    const decision = await evaluateBehaviorDecision({
      universeId: input.universeId,
      characterId: entry.characterId,
      trigger: "AUTONOMOUS_TICK",
      worldDate: toDate,
      conversationId: conversation?.id ?? null,
      userInitiated: false,
      metadata: { tickId: tick.tickId, ...(targetCharacterId ? { targetCharacterId } : {}) },
    });
    decisionsEvaluated += 1;
    if (state.mode !== "FULL" || decision.selected.actionType === "NO_ACTION") continue;

    const actionType = decision.selected.actionType as AiActionType;
    const typeLimit: Partial<Record<AiActionType, number>> = {
      RESPOND: budgets.maxMessagesPerTick,
      SEND_MESSAGE: budgets.maxMessagesPerTick,
      CREATE_EVENT: budgets.maxEventsPerTick,
      CREATE_MEMORY: budgets.maxMemoryWritesPerTick,
      UPDATE_RELATIONSHIP: budgets.maxRelationshipChangesPerTick,
    };
    const limit = typeLimit[actionType] ?? 0;
    if ((perType.get(actionType) ?? 0) >= limit) {
      budgetExhausted = true;
      continue;
    }
    const execution = await executeBehaviorDecision(decision.decisionId);
    if (execution.status === "EXECUTED") {
      actionsExecuted += 1;
      perType.set(actionType, (perType.get(actionType) ?? 0) + 1);
    } else {
      actionsRejected += 1;
    }
  }

  await prisma.universe.update({
    where: { id: input.universeId },
    data: {
      lastSimulationAt: toDate,
      nextSimulationAt: new Date(toDate.getTime() + budgets.tickWindowHours * 60 * 60 * 1000),
      simulationVersion: AUTONOMY_VERSION,
    },
  });

  return {
    universeId: input.universeId,
    status: "EXECUTED",
    reasonCode: "AUTONOMOUS_TICK_COMPLETED",
    mode: state.mode,
    tickId: tick.tickId,
    decisionsEvaluated,
    actionsExecuted,
    actionsRejected,
    budgetExhausted,
    planned: [],
  };
}
