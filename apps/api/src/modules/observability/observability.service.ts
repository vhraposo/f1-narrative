import { prisma } from "../../infrastructure/database/prisma.js";

export class ObservabilityError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "ObservabilityError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

const SENSITIVE_KEY_PATTERN = /(authorization|api[-_]?key|token|secret|password|cookie)/i;

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitizeValue(entry, depth + 1);
    }
    return output;
  }
  if (typeof value === "string") return value.slice(0, 2000);
  return value;
}

export async function getDecisionTrace(decisionId: string) {
  const decision = await prisma.aiDecision.findUnique({
    where: { id: decisionId },
    include: {
      character: { select: { id: true, name: true, controlledBy: true, universeId: true } },
    },
  });
  if (!decision) {
    throw new ObservabilityError("DECISION_NOT_FOUND", "Decisão não encontrada", 404);
  }
  const metadata = (decision.metadata ?? {}) as Record<string, unknown>;
  return {
    decision: {
      id: decision.id,
      universeId: decision.universeId,
      character: decision.character,
      status: decision.status,
      actionType: decision.actionType,
      reason: decision.reason,
      policyCode: decision.policyCode,
      contextVersion: decision.contextVersion,
      conversationId: decision.conversationId,
      executedMessageId: decision.executedMessageId,
      executedEventId: decision.executedEventId,
      createdAt: decision.createdAt,
      updatedAt: decision.updatedAt,
    },
    trace: {
      trigger: metadata.trigger ?? null,
      worldDate: metadata.worldDate ?? null,
      worldDateBucket: metadata.worldDateBucket ?? null,
      fingerprint: metadata.fingerprint ?? null,
      actionFingerprint: metadata.actionFingerprint ?? null,
      scoringVersion: metadata.scoringVersion ?? null,
      goals: sanitizeValue(metadata.goals ?? []),
      candidates: sanitizeValue(metadata.candidates ?? []),
      selected: sanitizeValue(metadata.selected ?? null),
      rejected: sanitizeValue(metadata.rejected ?? []),
      contextOmissions: sanitizeValue(metadata.contextOmissions ?? []),
      execution: sanitizeValue(metadata.execution ?? null),
      llmUsed: metadata.llmUsed === true,
    },
  };
}

export async function getSimulationTrace(tickId: string) {
  const tick = await prisma.simulationTick.findUnique({ where: { id: tickId } });
  if (!tick) {
    throw new ObservabilityError("TICK_NOT_FOUND", "Tick não encontrado", 404);
  }
  const events = await prisma.event.findMany({
    where: {
      payload: { path: ["simulation", "tickId"], equals: tickId },
    },
    orderBy: [{ worldDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      type: true,
      importance: true,
      title: true,
      worldDate: true,
      payload: true,
      participants: { select: { characterId: true }, orderBy: { characterId: "asc" } },
    },
  });
  const eventIds = events.map((event) => event.id);
  const [relationshipChanges, newsItems] = await Promise.all([
    eventIds.length > 0
      ? prisma.relationshipChange.findMany({
          where: { sourceType: "EVENT", sourceId: { in: eventIds } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        })
      : Promise.resolve([]),
    eventIds.length > 0
      ? prisma.newsItem.findMany({
          where: { eventId: { in: eventIds } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true, eventId: true, title: true, worldDate: true },
        })
      : Promise.resolve([]),
  ]);
  return {
    tick: {
      id: tick.id,
      universeId: tick.universeId,
      status: tick.status,
      dryRun: tick.dryRun,
      simulationVersion: tick.simulationVersion,
      startWorldDate: tick.startWorldDate,
      endWorldDate: tick.endWorldDate,
      startedAt: tick.startedAt,
      completedAt: tick.completedAt,
      summary: sanitizeValue(tick.summary ?? null),
      error: tick.error,
    },
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      importance: event.importance,
      title: event.title,
      worldDate: event.worldDate,
      participantIds: event.participants.map((participant) => participant.characterId),
      causality: sanitizeValue((event.payload as Record<string, unknown> | null)?.simulation ?? null),
    })),
    relationshipChanges,
    newsItems,
  };
}

export async function getUniverseActivity(universeId: string, limit = 20) {
  const [decisions, ticks, relationshipChanges, memories, experiences] = await Promise.all([
    prisma.aiDecision.findMany({
      where: { universeId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
      select: {
        id: true,
        characterId: true,
        status: true,
        actionType: true,
        reason: true,
        createdAt: true,
      },
    }),
    prisma.simulationTick.findMany({
      where: { universeId },
      orderBy: [{ startedAt: "desc" }, { id: "asc" }],
      take: limit,
      select: { id: true, status: true, dryRun: true, startedAt: true, completedAt: true },
    }),
    prisma.relationshipChange.findMany({
      where: { relationship: { characterA: { universeId } } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
      select: {
        id: true,
        characterAId: true,
        characterBId: true,
        dimension: true,
        delta: true,
        ruleCode: true,
        sourceType: true,
        createdAt: true,
      },
    }),
    prisma.memory.findMany({
      where: { universeId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
      select: { id: true, summary: true, importance: true, memoryType: true, createdAt: true },
    }),
    prisma.pilotExperience.findMany({
      where: { universeId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
      select: { id: true, characterId: true, experienceType: true, title: true, createdAt: true },
    }),
  ]);
  return { decisions, ticks, relationshipChanges, memories, experiences };
}

export async function getUniverseMetrics(universeId: string) {
  const [
    decisions,
    decisionsExecuted,
    decisionsRejected,
    autonomousDecisions,
    ticks,
    ticksCompleted,
    ticksDryRun,
    memories,
    relationshipChanges,
    experiences,
    messages,
    goals,
  ] = await Promise.all([
    prisma.aiDecision.count({ where: { universeId } }),
    prisma.aiDecision.count({ where: { universeId, status: "EXECUTED" } }),
    prisma.aiDecision.count({ where: { universeId, status: "REJECTED" } }),
    prisma.aiDecision.count({
      where: { universeId, metadata: { path: ["trigger"], equals: "AUTONOMOUS_TICK" } },
    }),
    prisma.simulationTick.count({ where: { universeId } }),
    prisma.simulationTick.count({ where: { universeId, status: "COMPLETED" } }),
    prisma.simulationTick.count({ where: { universeId, status: "DRY_RUN" } }),
    prisma.memory.count({ where: { universeId } }),
    prisma.relationshipChange.count({
      where: { relationship: { characterA: { universeId } } },
    }),
    prisma.pilotExperience.count({ where: { universeId } }),
    prisma.message.count({ where: { conversation: { participants: { some: { character: { universeId } } } } } }),
    prisma.characterGoal.count({ where: { universeId } }),
  ]);
  return {
    decisions: { total: decisions, executed: decisionsExecuted, rejected: decisionsRejected, autonomous: autonomousDecisions },
    ticks: { total: ticks, completed: ticksCompleted, dryRun: ticksDryRun },
    memories,
    relationshipChanges,
    experiences,
    messages,
    goals,
  };
}
