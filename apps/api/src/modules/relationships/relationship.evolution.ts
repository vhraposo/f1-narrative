import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { canonicalizeRelationshipPair } from "./relationship.pair.js";
import { clampRelationshipDimension } from "./relationship.rules.js";

export type RelationshipDeltaInput = {
  readonly characterAId: string;
  readonly characterBId: string;
  readonly deltas: Readonly<Record<string, number>>;
  readonly ruleCode: string;
  readonly sourceType: string;
  readonly sourceId?: string | null;
  readonly worldDate?: Date | null;
  readonly metadata?: Prisma.InputJsonValue | null;
};

export type RelationshipEvolutionResult = {
  readonly relationshipId: string;
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
};

function readDimension(dimensions: unknown, key: string): number {
  if (dimensions !== null && typeof dimensions === "object" && !Array.isArray(dimensions)) {
    const value = (dimensions as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

export function relationshipChangeFingerprint(input: {
  characterAId: string;
  characterBId: string;
  dimension: string;
  ruleCode: string;
  sourceType: string;
  sourceId: string | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        characterAId: input.characterAId,
        characterBId: input.characterBId,
        dimension: input.dimension,
        ruleCode: input.ruleCode,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      }),
    )
    .digest("hex");
}

export class RelationshipEvolutionError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "RelationshipEvolutionError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export async function applyRelationshipDelta(
  input: RelationshipDeltaInput,
  client: Prisma.TransactionClient = prisma,
): Promise<RelationshipEvolutionResult> {
  const characters = await client.character.findMany({
    where: { id: { in: [input.characterAId, input.characterBId] } },
    select: { id: true, universeId: true },
  });
  const characterA = characters.find((character) => character.id === input.characterAId);
  const characterB = characters.find((character) => character.id === input.characterBId);
  if (!characterA || !characterB) {
    throw new RelationshipEvolutionError("CHARACTER_NOT_FOUND", "Personagem não encontrado", 404);
  }
  if (
    characterA.universeId !== null &&
    characterB.universeId !== null &&
    characterA.universeId !== characterB.universeId
  ) {
    throw new RelationshipEvolutionError(
      "UNIVERSE_MISMATCH",
      "Personagens pertencem a Universes diferentes",
      403,
    );
  }

  const canonical = canonicalizeRelationshipPair(input.characterAId, input.characterBId);
  const found = await client.relationship.findFirst({
    where: {
      OR: [
        { characterAId: canonical.characterAId, characterBId: canonical.characterBId },
        { characterAId: canonical.characterBId, characterBId: canonical.characterAId },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, dimensions: true, characterAId: true, characterBId: true },
  });
  if (
    found &&
    (found.characterAId !== canonical.characterAId ||
      found.characterBId !== canonical.characterBId)
  ) {
    await client.relationship.update({
      where: { id: found.id },
      data: { characterAId: canonical.characterAId, characterBId: canonical.characterBId },
    });
  }
  const relationship =
    found ??
    (await client.relationship.create({
      data: {
        characterAId: canonical.characterAId,
        characterBId: canonical.characterBId,
        dimensions: {},
      },
      select: { id: true, dimensions: true },
    }));

  const dimensions =
    relationship.dimensions !== null &&
    typeof relationship.dimensions === "object" &&
    !Array.isArray(relationship.dimensions)
      ? { ...(relationship.dimensions as Record<string, unknown>) }
      : {};
  const applied: string[] = [];
  const skipped: string[] = [];
  const sourceId = input.sourceId ?? null;

  for (const [dimension, delta] of Object.entries(input.deltas).sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (delta === 0) continue;
    const fingerprint = relationshipChangeFingerprint({
      characterAId: canonical.characterAId,
      characterBId: canonical.characterBId,
      dimension,
      ruleCode: input.ruleCode,
      sourceType: input.sourceType,
      sourceId,
    });
    const alreadyApplied = await client.relationshipChange.findUnique({
      where: { fingerprint },
      select: { id: true },
    });
    if (alreadyApplied) {
      skipped.push(dimension);
      continue;
    }
    const previousValue = readDimension(dimensions, dimension);
    const resultingValue = clampRelationshipDimension(previousValue + delta);
    dimensions[dimension] = resultingValue;
    await client.relationshipChange.create({
      data: {
        relationshipId: relationship.id,
        characterAId: canonical.characterAId,
        characterBId: canonical.characterBId,
        dimension,
        previousValue,
        delta: resultingValue - previousValue,
        resultingValue,
        ruleCode: input.ruleCode,
        sourceType: input.sourceType,
        sourceId,
        worldDate: input.worldDate ?? null,
        fingerprint,
        metadata: input.metadata ?? undefined,
      },
    });
    applied.push(dimension);
  }

  if (applied.length > 0) {
    await client.relationship.update({
      where: { id: relationship.id },
      data: { dimensions: dimensions as Prisma.InputJsonValue },
    });
  }

  return { relationshipId: relationship.id, applied, skipped };
}
