import type {
  DriverRelationshipKind,
  DriverRelationshipState,
  DriverRelationshipTarget,
  ExternalDriverRelationship,
  UniverseDriverRelationship,
} from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { PilotKnowledgeError } from "./pilot-knowledge.access.js";
import { authorityClassOfProvider } from "./pilot-knowledge.policy.js";
import { recordKnowledgeSource, type KnowledgeSourceInput } from "./pilot-knowledge.sources.js";

export const RELATIONSHIP_KIND_LABELS: Record<DriverRelationshipKind, string> = {
  ROMANTIC_PARTNER: "Parceiro(a)",
  SPOUSE: "Cônjuge",
  PARENT: "Pai/Mãe",
  CHILD: "Filho(a)",
  SIBLING: "Irmão/Irmã",
  TEAMMATE: "Companheiro de equipe",
  TEAM_RELATION: "Relação de equipe",
  MENTOR: "Mentor",
  OTHER_PUBLIC_RELATION: "Outra relação pública",
};

export type RelationshipClassification = "MATCH" | "DIVERGENT" | "UNKNOWN" | "CONFLICT";

export type ExternalRelationshipInput = {
  readonly kind: DriverRelationshipKind;
  readonly targetType: DriverRelationshipTarget;
  readonly targetExternalId?: string | null;
  readonly targetWikidataQid?: string | null;
  readonly displayName: string;
  readonly state: DriverRelationshipState;
  readonly validFrom?: Date | null;
  readonly validTo?: Date | null;
  readonly confidence?: number | null;
  readonly source: KnowledgeSourceInput;
};

type RelationshipRow = Pick<
  ExternalDriverRelationship,
  | "id"
  | "kind"
  | "targetType"
  | "targetExternalDriverId"
  | "targetWikidataQid"
  | "displayName"
  | "state"
  | "validFrom"
  | "validTo"
  | "confidence"
  | "lastVerifiedAt"
  | "sourceId"
>;

function normalizeDisplayName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function coversDate(row: { validFrom: Date | null; validTo: Date | null }, at: Date): boolean {
  if (row.validFrom && row.validFrom.getTime() > at.getTime()) return false;
  if (row.validTo && row.validTo.getTime() < at.getTime()) return false;
  return true;
}

export type ResolvedRelationshipCurrent = {
  readonly row: RelationshipRow;
  readonly conflicting: boolean;
};

export function resolveCurrentExternalRelationship(
  rows: readonly (RelationshipRow & { provider?: string | null })[],
  kind: DriverRelationshipKind,
  at: Date,
): ResolvedRelationshipCurrent | null {
  const candidates = rows.filter((row) => row.kind === kind && coversDate(row, at));
  if (candidates.length === 0) return null;
  const ranked = [...candidates].sort((a, b) => {
    const authorityA = a.provider ? authorityClassOfProvider(a.provider) : "OTHER_SECONDARY";
    const authorityB = b.provider ? authorityClassOfProvider(b.provider) : "OTHER_SECONDARY";
    const rank = (value: string) =>
      value === "PRIMARY_OFFICIAL" ? 3 : value === "STRUCTURED_LICENSED" ? 2 : value === "REPUTABLE_SECONDARY" ? 1 : 0;
    const diff = rank(authorityB) - rank(authorityA);
    if (diff !== 0) return diff;
    const fromDiff = (b.validFrom?.getTime() ?? 0) - (a.validFrom?.getTime() ?? 0);
    if (fromDiff !== 0) return fromDiff;
    const confidenceDiff = (b.confidence ?? 0) - (a.confidence ?? 0);
    if (confidenceDiff !== 0) return confidenceDiff;
    const verifiedDiff = (b.lastVerifiedAt?.getTime() ?? 0) - (a.lastVerifiedAt?.getTime() ?? 0);
    if (verifiedDiff !== 0) return verifiedDiff;
    return a.id.localeCompare(b.id);
  });
  const top = ranked[0] as RelationshipRow & { provider?: string | null };
  const topAuthority = top.provider ? authorityClassOfProvider(top.provider) : "OTHER_SECONDARY";
  const topFrom = top.validFrom?.getTime() ?? 0;
  const conflicting = ranked.some((row) => {
    if (row.id === top.id) return false;
    const rowAuthority = row.provider ? authorityClassOfProvider(row.provider) : "OTHER_SECONDARY";
    const rowFrom = row.validFrom?.getTime() ?? 0;
    return (
      rowAuthority === topAuthority &&
      rowFrom === topFrom &&
      normalizeDisplayName(row.displayName) !== normalizeDisplayName(top.displayName)
    );
  });
  return { row: top, conflicting };
}

export async function ingestExternalRelationships(
  externalDriverId: string,
  inputs: readonly ExternalRelationshipInput[],
  now: Date = new Date(),
): Promise<readonly ExternalDriverRelationship[]> {
  const driver = await prisma.externalDriver.findUnique({
    where: { id: externalDriverId },
    select: { id: true },
  });
  if (!driver) {
    throw new PilotKnowledgeError("DRIVER_NOT_FOUND", "Piloto externo não encontrado", 404);
  }
  const results: ExternalDriverRelationship[] = [];
  for (const input of inputs) {
    if (input.displayName.trim().length === 0) {
      throw new PilotKnowledgeError("VALIDATION_ERROR", "displayName obrigatório", 400);
    }
    const source = await recordKnowledgeSource(input.source, now);
    const existing = await prisma.externalDriverRelationship.findFirst({
      where: {
        externalDriverId,
        kind: input.kind,
        sourceId: source.id,
        displayName: input.displayName.trim(),
        validFrom: input.validFrom ?? null,
        validTo: input.validTo ?? null,
      },
    });
    if (existing) {
      results.push(
        await prisma.externalDriverRelationship.update({
          where: { id: existing.id },
          data: {
            state: input.state,
            confidence: input.confidence ?? null,
            lastVerifiedAt: now,
            targetExternalDriverId: input.targetExternalId ?? null,
            targetWikidataQid: input.targetWikidataQid ?? null,
          },
        }),
      );
      continue;
    }
    results.push(
      await prisma.externalDriverRelationship.create({
        data: {
          externalDriverId,
          kind: input.kind,
          targetType: input.targetType,
          targetExternalDriverId: input.targetExternalId ?? null,
          targetWikidataQid: input.targetWikidataQid ?? null,
          displayName: input.displayName.trim(),
          state: input.state,
          validFrom: input.validFrom ?? null,
          validTo: input.validTo ?? null,
          sourceId: source.id,
          confidence: input.confidence ?? null,
          lastVerifiedAt: now,
        },
      }),
    );
  }
  return results;
}

export type RelationshipEntryView = {
  readonly kind: DriverRelationshipKind;
  readonly label: string;
  readonly classification: RelationshipClassification;
  readonly current: {
    readonly displayName: string;
    readonly state: DriverRelationshipState;
    readonly validFrom: Date | null;
    readonly validTo: Date | null;
    readonly origin: "UNIVERSE" | "EXTERNAL";
    readonly verifiedAt: Date | null;
  } | null;
  readonly externalCurrent: {
    readonly displayName: string;
    readonly state: DriverRelationshipState;
    readonly validFrom: Date | null;
    readonly validTo: Date | null;
    readonly verifiedAt: Date | null;
  } | null;
  readonly history: ReadonlyArray<{
    readonly displayName: string;
    readonly state: DriverRelationshipState;
    readonly validFrom: Date | null;
    readonly validTo: Date | null;
    readonly origin: "UNIVERSE" | "EXTERNAL";
  }>;
};

export type UniverseDriverRelationshipView = {
  readonly id: string;
  readonly kind: DriverRelationshipKind;
  readonly targetType: DriverRelationshipTarget;
  readonly targetCharacterId: string | null;
  readonly targetWikidataQid: string | null;
  readonly displayName: string;
  readonly state: DriverRelationshipState;
  readonly validFrom: Date | null;
  readonly validTo: Date | null;
  readonly updatedAt: Date;
};

function toUniverseDriverRelationshipView(
  row: UniverseDriverRelationship,
): UniverseDriverRelationshipView {
  return {
    id: row.id,
    kind: row.kind,
    targetType: row.targetType,
    targetCharacterId: row.targetCharacterId,
    targetWikidataQid: row.targetWikidataQid,
    displayName: row.displayName,
    state: row.state,
    validFrom: row.validFrom,
    validTo: row.validTo,
    updatedAt: row.updatedAt,
  };
}

export type PilotRelationshipsView =
  | { readonly available: false; readonly reason: "CHARACTER_NOT_FOUND" | "NO_EXTERNAL_BINDING" }
  | {
      readonly available: true;
      readonly entries: readonly RelationshipEntryView[];
      readonly universeOverrides: readonly UniverseDriverRelationshipView[];
    };

function compareOverrideRows(a: UniverseDriverRelationship, b: UniverseDriverRelationship): number {
  const aFrom = a.validFrom?.getTime() ?? 0;
  const bFrom = b.validFrom?.getTime() ?? 0;
  if (aFrom !== bFrom) return bFrom - aFrom;
  return a.id.localeCompare(b.id);
}

export async function getPilotRelationshipsView(
  characterId: string,
  now: Date = new Date(),
): Promise<PilotRelationshipsView> {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      universeId: true,
      externalDriverBindings: {
        take: 1,
        orderBy: { createdAt: "asc" },
        select: { externalDriverId: true },
      },
    },
  });
  if (!character) return { available: false, reason: "CHARACTER_NOT_FOUND" };
  const binding = character.externalDriverBindings[0];
  if (!binding) return { available: false, reason: "NO_EXTERNAL_BINDING" };

  const [externalRows, overrides] = await Promise.all([
    prisma.externalDriverRelationship.findMany({
      where: { externalDriverId: binding.externalDriverId },
      include: { source: { select: { provider: true } } },
      orderBy: [{ validFrom: "asc" }, { id: "asc" }],
    }),
    character.universeId
      ? prisma.universeDriverRelationship.findMany({
          where: { characterId },
          orderBy: [{ validFrom: "asc" }, { id: "asc" }],
        })
      : Promise.resolve([] as UniverseDriverRelationship[]),
  ]);

  const rows: (RelationshipRow & { provider: string | null })[] = externalRows.map((row) => ({
    id: row.id,
    kind: row.kind,
    targetType: row.targetType,
    targetExternalDriverId: row.targetExternalDriverId,
    targetWikidataQid: row.targetWikidataQid,
    displayName: row.displayName,
    state: row.state,
    validFrom: row.validFrom,
    validTo: row.validTo,
    confidence: row.confidence,
    lastVerifiedAt: row.lastVerifiedAt,
    sourceId: row.sourceId,
    provider: row.source?.provider ?? null,
  }));

  const presentKinds = new Set<DriverRelationshipKind>([
    ...rows.map((row) => row.kind),
    ...overrides.map((row) => row.kind),
  ]);

  const entries: RelationshipEntryView[] = [];
  for (const kind of presentKinds) {
    const resolved = resolveCurrentExternalRelationship(rows, kind, now);
    const kindOverrides = overrides.filter((row) => row.kind === kind).sort(compareOverrideRows);
    const currentOverride = kindOverrides.find((row) => coversDate(row, now)) ?? null;

    const externalCurrent = resolved
      ? {
          displayName: resolved.row.displayName,
          state: resolved.row.state,
          validFrom: resolved.row.validFrom,
          validTo: resolved.row.validTo,
          verifiedAt: resolved.row.lastVerifiedAt,
        }
      : null;

    let classification: RelationshipClassification;
    if (currentOverride && resolved?.conflicting) classification = "CONFLICT";
    else if (currentOverride && externalCurrent) {
      classification =
        normalizeDisplayName(currentOverride.displayName) === normalizeDisplayName(externalCurrent.displayName)
          ? "MATCH"
          : "DIVERGENT";
    } else if (currentOverride) classification = "DIVERGENT";
    else if (resolved?.conflicting) classification = "CONFLICT";
    else if (externalCurrent) classification = "UNKNOWN";
    else classification = "UNKNOWN";

    const current = currentOverride
      ? {
          displayName: currentOverride.displayName,
          state: currentOverride.state,
          validFrom: currentOverride.validFrom,
          validTo: currentOverride.validTo,
          origin: "UNIVERSE" as const,
          verifiedAt: currentOverride.updatedAt,
        }
      : externalCurrent
        ? { ...externalCurrent, origin: "EXTERNAL" as const }
        : null;

    const history = [
      ...kindOverrides
        .filter((row) => row.id !== currentOverride?.id)
        .map((row) => ({
          displayName: row.displayName,
          state: row.state,
          validFrom: row.validFrom,
          validTo: row.validTo,
          origin: "UNIVERSE" as const,
        })),
      ...rows
        .filter((row) => row.kind === kind && row.id !== resolved?.row.id)
        .map((row) => ({
          displayName: row.displayName,
          state: row.state,
          validFrom: row.validFrom,
          validTo: row.validTo,
          origin: "EXTERNAL" as const,
        })),
    ];

    entries.push({
      kind,
      label: RELATIONSHIP_KIND_LABELS[kind],
      classification,
      current,
      externalCurrent,
      history,
    });
  }

  const order = Object.keys(RELATIONSHIP_KIND_LABELS) as DriverRelationshipKind[];
  entries.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.kind.localeCompare(b.kind));
  return {
    available: true,
    entries,
    universeOverrides: overrides.map(toUniverseDriverRelationshipView),
  };
}

export type UniverseRelationshipInput = {
  readonly kind: DriverRelationshipKind;
  readonly targetType: DriverRelationshipTarget;
  readonly targetCharacterId?: string | null;
  readonly targetWikidataQid?: string | null;
  readonly displayName: string;
  readonly state: DriverRelationshipState;
  readonly validFrom?: Date | null;
  readonly validTo?: Date | null;
};

async function loadOwnedCharacter(userId: string, characterId: string) {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true, universeId: true, universe: { select: { userId: true } } },
  });
  if (!character || character.universeId === null || character.universe?.userId !== userId) {
    throw new PilotKnowledgeError("NOT_FOUND", "Piloto não encontrado", 404);
  }
  return character;
}

export async function createUniverseDriverRelationship(
  userId: string,
  characterId: string,
  input: UniverseRelationshipInput,
): Promise<UniverseDriverRelationshipView> {
  const character = await loadOwnedCharacter(userId, characterId);
  if (input.displayName.trim().length === 0) {
    throw new PilotKnowledgeError("VALIDATION_ERROR", "displayName obrigatório", 400);
  }
  if (input.targetType === "CHARACTER") {
    if (!input.targetCharacterId) {
      throw new PilotKnowledgeError("VALIDATION_ERROR", "targetCharacterId obrigatório", 400);
    }
    const target = await prisma.character.findFirst({
      where: { id: input.targetCharacterId, universeId: character.universeId },
      select: { id: true },
    });
    if (!target) {
      throw new PilotKnowledgeError("NOT_FOUND", "Personagem alvo não encontrado", 404);
    }
  }
  const created = await prisma.universeDriverRelationship.create({
    data: {
      universeId: character.universeId as string,
      characterId,
      kind: input.kind,
      targetType: input.targetType,
      targetCharacterId: input.targetType === "CHARACTER" ? (input.targetCharacterId ?? null) : null,
      targetWikidataQid: input.targetWikidataQid ?? null,
      displayName: input.displayName.trim(),
      state: input.state,
      validFrom: input.validFrom ?? null,
      validTo: input.validTo ?? null,
      createdById: userId,
    },
  });
  return toUniverseDriverRelationshipView(created);
}

async function loadOwnedRelationship(userId: string, id: string) {
  const row = await prisma.universeDriverRelationship.findUnique({
    where: { id },
    include: { universe: { select: { userId: true } } },
  });
  if (!row || row.universe.userId !== userId) {
    throw new PilotKnowledgeError("RELATIONSHIP_NOT_FOUND", "Relacionamento não encontrado", 404);
  }
  return row;
}

export async function updateUniverseDriverRelationship(
  userId: string,
  id: string,
  input: Partial<UniverseRelationshipInput>,
): Promise<UniverseDriverRelationshipView> {
  await loadOwnedRelationship(userId, id);
  if (input.displayName !== undefined && input.displayName.trim().length === 0) {
    throw new PilotKnowledgeError("VALIDATION_ERROR", "displayName obrigatório", 400);
  }
  try {
    const updated = await prisma.universeDriverRelationship.update({
      where: { id },
      data: {
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.state !== undefined ? { state: input.state } : {}),
        ...(input.displayName !== undefined ? { displayName: input.displayName.trim() } : {}),
        ...(input.validFrom !== undefined ? { validFrom: input.validFrom } : {}),
        ...(input.validTo !== undefined ? { validTo: input.validTo } : {}),
        ...(input.targetWikidataQid !== undefined ? { targetWikidataQid: input.targetWikidataQid } : {}),
      },
    });
    return toUniverseDriverRelationshipView(updated);
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") {
      throw new PilotKnowledgeError("RELATIONSHIP_NOT_FOUND", "Relacionamento não encontrado", 404);
    }
    throw error;
  }
}

export async function deleteUniverseDriverRelationship(userId: string, id: string): Promise<void> {
  await loadOwnedRelationship(userId, id);
  try {
    await prisma.universeDriverRelationship.delete({ where: { id } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") {
      throw new PilotKnowledgeError("RELATIONSHIP_NOT_FOUND", "Relacionamento não encontrado", 404);
    }
    throw error;
  }
}
