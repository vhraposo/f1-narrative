import type { Prisma, EventType, EventImportance } from "@prisma/client";
import { canonicalizeRelationshipPair } from "../relationships/relationship.pair.js";

export const EVOLUTION_ELIGIBLE_TYPES: readonly EventType[] = [
  "RACE_INCIDENT",
  "RELATIONSHIP",
  "SOCIAL",
];

const DIMENSION_MIN = -100;
const DIMENSION_MAX = 100;

const IMPORTANCE_WEIGHT: Record<EventImportance, number> = {
  LOW: 0.5,
  MEDIUM: 1,
  HIGH: 1.5,
  CRITICAL: 2,
};

const EMOTIONAL_IMPACT: Record<EventType, number> = {
  RACE: 0,
  RACE_INCIDENT: -5,
  RELATIONSHIP: 6,
  SOCIAL: 3,
  PERSONAL: 0,
  NEWS: 0,
  WORLD: 0,
};

const BASE_DELTAS: Record<EventType, EvolutionDelta> = {
  RACE: { affinity: 0, trust: 0, rivalry: 0 },
  RACE_INCIDENT: { affinity: -20, trust: -10, rivalry: 30 },
  RELATIONSHIP: { affinity: 25, trust: 20, rivalry: -10 },
  SOCIAL: { affinity: 10, trust: 5, rivalry: 0 },
  PERSONAL: { affinity: 0, trust: 0, rivalry: 0 },
  NEWS: { affinity: 0, trust: 0, rivalry: 0 },
  WORLD: { affinity: 0, trust: 0, rivalry: 0 },
};

export interface EvolutionDelta {
  affinity: number;
  trust: number;
  rivalry: number;
}

export function isEligibleForEvolution(
  type: EventType,
  worldDate: Date | null,
): boolean {
  return EVOLUTION_ELIGIBLE_TYPES.includes(type) && worldDate !== null;
}

export function computeEventDelta(
  type: EventType,
  importance: EventImportance,
): EvolutionDelta {
  const base = BASE_DELTAS[type];
  const weight = IMPORTANCE_WEIGHT[importance];
  return {
    affinity: Math.round(base.affinity * weight),
    trust: Math.round(base.trust * weight),
    rivalry: Math.round(base.rivalry * weight),
  };
}

function clampDimension(value: number): number {
  return Math.min(DIMENSION_MAX, Math.max(DIMENSION_MIN, value));
}

function readDimension(dimensions: unknown, key: string): number {
  if (dimensions !== null && typeof dimensions === "object" && !Array.isArray(dimensions)) {
    const value = (dimensions as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

export function mergeEvolutionDimensions(
  existing: unknown,
  delta: EvolutionDelta,
): Record<string, unknown> {
  const source =
    existing !== null && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  source.affinity = clampDimension(readDimension(source, "affinity") + delta.affinity);
  source.trust = clampDimension(readDimension(source, "trust") + delta.trust);
  source.rivalry = clampDimension(readDimension(source, "rivalry") + delta.rivalry);
  return source;
}

export interface EventEvolutionResult {
  appliedPairs: number;
  memoryId: string | null;
}

export async function applyEventEvolution(
  client: Prisma.TransactionClient,
  eventId: string,
): Promise<EventEvolutionResult> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${eventId})::bigint)`;

  const event = await client.event.findUnique({
    where: { id: eventId },
    select: {
      type: true,
      importance: true,
      title: true,
      description: true,
      source: true,
      worldDate: true,
    },
  });
  if (!event || !isEligibleForEvolution(event.type, event.worldDate)) {
    return { appliedPairs: 0, memoryId: null };
  }

  const participants = await client.eventCharacter.findMany({
    where: { eventId },
    select: { characterId: true },
  });
  const participantIds = participants.map((p) => p.characterId);
  if (participantIds.length < 2) {
    return { appliedPairs: 0, memoryId: null };
  }

  const evolutionMemory = await client.memory.findFirst({
    where: {
      eventId,
      source: "GENERATED_EVENT",
      context: { path: ["evolution"], equals: "v1" },
    },
    select: { id: true, participants: { select: { characterId: true } } },
  });
  const appliedIds = new Set(
    evolutionMemory?.participants.map((p) => p.characterId) ?? [],
  );

  const delta = computeEventDelta(event.type, event.importance);
  let appliedPairs = 0;

  for (let i = 0; i < participantIds.length; i += 1) {
    for (let j = i + 1; j < participantIds.length; j += 1) {
      const pairA = participantIds[i];
      const pairB = participantIds[j];
      if (appliedIds.has(pairA) && appliedIds.has(pairB)) {
        continue;
      }
      const canonical = canonicalizeRelationshipPair(pairA, pairB);
      const existing = await client.relationship.findFirst({
        where: {
          characterAId: canonical.characterAId,
          characterBId: canonical.characterBId,
        },
        select: { id: true, dimensions: true },
      });
      if (existing) {
        await client.relationship.update({
          where: { id: existing.id },
          data: {
            dimensions: mergeEvolutionDimensions(
              existing.dimensions,
              delta,
            ) as Prisma.InputJsonValue,
          },
        });
      } else {
        await client.relationship.create({
          data: {
            characterAId: canonical.characterAId,
            characterBId: canonical.characterBId,
            dimensions: mergeEvolutionDimensions({}, delta) as Prisma.InputJsonValue,
          },
        });
      }
      appliedPairs += 1;
    }
  }

  const importanceLabel: Record<EventImportance, string> = {
    LOW: "baixa",
    MEDIUM: "média",
    HIGH: "alta",
    CRITICAL: "crítica",
  };
  const content = [
    `Evento de ${importanceLabel[event.importance]} importância: ${event.title}`,
    event.description ? event.description : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n\n");

  let memoryId: string | null;
  if (evolutionMemory) {
    await client.memoryCharacter.createMany({
      data: participantIds.map((characterId) => ({
        memoryId: evolutionMemory.id,
        characterId,
      })),
      skipDuplicates: true,
    });
    memoryId = evolutionMemory.id;
  } else {
    const created = await client.memory.create({
      data: {
        eventId,
        importance: event.importance,
        source: "GENERATED_EVENT",
        content,
        summary: event.title,
        context: { evolution: "v1" },
        emotionalImpact: EMOTIONAL_IMPACT[event.type],
        participants: {
          create: participantIds.map((characterId) => ({ characterId })),
        },
      },
      select: { id: true },
    });
    memoryId = created.id;
  }

  return { appliedPairs, memoryId };
}