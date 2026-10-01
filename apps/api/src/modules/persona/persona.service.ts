import type { PersonaEvidenceType, PersonaOrigin, Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  inspectPersonaConfidence,
  inspectPersonaEvidenceProposal,
  inspectPersonaSummary,
  inspectPersonaTrait,
  inspectPersonaTraitKey,
  planPersonaEvidenceStatusTransition,
  planPersonaTraitReconcile,
  resolveEvidenceAuthority,
  resolveManualTraitOverride,
  sortPersonaTraits,
  type PersonaEvidenceStatus,
  type PersonaRuleIssue,
  type PersonaTraitSource,
} from "./persona.rules.js";

export const PERSONA_SCHEMA_VERSION = "persona.v1";

export type PersonaServiceErrorCode =
  | "NOT_FOUND"
  | "TRAIT_NOT_FOUND"
  | "EVIDENCE_NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "INVALID_TRANSITION"
  | "UNAVAILABLE";

export class PersonaServiceError extends Error {
  constructor(
    public readonly code: PersonaServiceErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly issues: readonly PersonaRuleIssue[] = [],
  ) {
    super(message);
    this.name = "PersonaServiceError";
  }
}

export type PersonaAccessIntent = "READ" | "WRITE";

export type PersonaAccessCharacter = {
  readonly id: string;
  readonly userId: string | null;
  readonly universeId: string | null;
};

export type PersonaAccessResolution =
  | { readonly kind: "OWNER_CHARACTER"; readonly character: PersonaAccessCharacter }
  | { readonly kind: "OWNER_UNIVERSE"; readonly character: PersonaAccessCharacter }
  | { readonly kind: "GLOBAL_AI_CATALOG"; readonly character: PersonaAccessCharacter }
  | { readonly kind: "FORBIDDEN"; readonly character: PersonaAccessCharacter }
  | { readonly kind: "NOT_FOUND" };

export type PersonaOriginInput = {
  readonly userId: string | null;
  readonly universeId: string | null;
  readonly hasExternalBinding: boolean;
};

export function resolvePersonaOrigin(input: PersonaOriginInput): PersonaOrigin | null {
  if (input.userId !== null) return "ORIGINAL";
  if (input.universeId === null) return null;
  return input.hasExternalBinding ? "REAL_DRIVER" : "AI_CHARACTER";
}

export type PersonaTraitView = {
  readonly id: string;
  readonly key: string;
  readonly value: string;
  readonly confidence: number;
  readonly sourceKind: PersonaTraitSource;
  readonly evidenceId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type PersonaEvidenceRole =
  | "AUTHORITATIVE"
  | "SUPPORTING"
  | "CONFLICTING"
  | null;

export type PersonaEvidenceView = {
  readonly id: string;
  readonly traitKey: string;
  readonly proposedValue: string;
  readonly sourceType: PersonaEvidenceType;
  readonly title: string;
  readonly url: string | null;
  readonly publishedAt: Date | null;
  readonly excerpt: string;
  readonly confidence: number;
  readonly status: PersonaEvidenceStatus;
  readonly reviewedById: string | null;
  readonly reviewedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly role: PersonaEvidenceRole;
};

export type PersonaView = {
  readonly exists: boolean;
  readonly id: string | null;
  readonly characterId: string;
  readonly origin: PersonaOrigin | null;
  readonly summary: string | null;
  readonly schemaVersion: string;
  readonly traits: readonly PersonaTraitView[];
  readonly evidences: readonly PersonaEvidenceView[];
};

const personaInclude = { traits: true, evidences: true } as const;

type PersonaWithRelations = Prisma.CharacterPersonaGetPayload<{
  include: { traits: true; evidences: true };
}>;

type PersonaTraitRow = PersonaWithRelations["traits"][number];
type PersonaEvidenceRow = PersonaWithRelations["evidences"][number];

function notFoundError(): PersonaServiceError {
  return new PersonaServiceError("NOT_FOUND", "Personagem não encontrado", 404);
}

function forbiddenError(message: string): PersonaServiceError {
  return new PersonaServiceError("FORBIDDEN", message, 403);
}

export async function resolvePersonaAccess(
  userId: string,
  characterId: string,
  intent: PersonaAccessIntent = "READ",
): Promise<PersonaAccessResolution> {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true, userId: true, universeId: true },
  });

  if (!character) return { kind: "NOT_FOUND" };

  if (character.userId === userId) {
    return { kind: "OWNER_CHARACTER", character };
  }

  if (character.userId === null && character.universeId === null) {
    return intent === "WRITE"
      ? { kind: "FORBIDDEN", character }
      : { kind: "GLOBAL_AI_CATALOG", character };
  }

  if (character.universeId !== null) {
    const universe = await prisma.universe.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (universe && character.universeId === universe.id) {
      return { kind: "OWNER_UNIVERSE", character };
    }
  }

  return { kind: "NOT_FOUND" };
}

async function resolveOwnedCharacterOrigin(
  character: PersonaAccessCharacter,
): Promise<PersonaOrigin> {
  const binding =
    character.userId === null
      ? await prisma.externalBindingDriver.findUnique({
          where: { characterId: character.id },
          select: { id: true },
        })
      : null;

  const origin = resolvePersonaOrigin({
    userId: character.userId,
    universeId: character.universeId,
    hasExternalBinding: binding !== null,
  });

  if (!origin) {
    throw forbiddenError("Persona não está disponível para o catálogo global de AI");
  }

  return origin;
}

function buildTraitViews(traits: readonly PersonaTraitRow[]): PersonaTraitView[] {
  return sortPersonaTraits(traits).map((trait) => ({
    id: trait.id,
    key: trait.key,
    value: trait.value,
    confidence: trait.confidence,
    sourceKind: trait.sourceKind,
    evidenceId: trait.evidenceId,
    createdAt: trait.createdAt,
    updatedAt: trait.updatedAt,
  }));
}

const EVIDENCE_ROLE_ORDER = {
  AUTHORITATIVE: 0,
  SUPPORTING: 1,
  CONFLICTING: 2,
} as const;

function compareOrdinalText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function buildEvidenceViews(evidences: readonly PersonaEvidenceRow[]): PersonaEvidenceView[] {
  const byTraitKey = new Map<string, PersonaEvidenceRow[]>();
  for (const evidence of evidences) {
    const list = byTraitKey.get(evidence.traitKey);
    if (list) {
      list.push(evidence);
    } else {
      byTraitKey.set(evidence.traitKey, [evidence]);
    }
  }

  const roles = new Map<string, Exclude<PersonaEvidenceRole, null>>();
  for (const list of byTraitKey.values()) {
    const authority = resolveEvidenceAuthority(list);
    if (!authority.authoritative) continue;
    roles.set(authority.authoritative.id, "AUTHORITATIVE");
    for (const supporting of authority.supporting) {
      roles.set(supporting.id, "SUPPORTING");
    }
    for (const conflicting of authority.conflicting) {
      roles.set(conflicting.id, "CONFLICTING");
    }
  }

  return [...evidences]
    .sort((a, b) => {
      if (a.traitKey !== b.traitKey) return compareOrdinalText(a.traitKey, b.traitKey);
      const roleA = roles.get(a.id);
      const roleB = roles.get(b.id);
      const orderA = roleA ? EVIDENCE_ROLE_ORDER[roleA] : 3;
      const orderB = roleB ? EVIDENCE_ROLE_ORDER[roleB] : 3;
      if (orderA !== orderB) return orderA - orderB;
      const created = b.createdAt.getTime() - a.createdAt.getTime();
      if (created !== 0) return created;
      return compareOrdinalText(a.id, b.id);
    })
    .map((evidence) => ({
      id: evidence.id,
      traitKey: evidence.traitKey,
      proposedValue: evidence.proposedValue,
      sourceType: evidence.sourceType,
      title: evidence.title,
      url: evidence.url,
      publishedAt: evidence.publishedAt,
      excerpt: evidence.excerpt,
      confidence: evidence.confidence,
      status: evidence.status,
      reviewedById: evidence.reviewedById,
      reviewedAt: evidence.reviewedAt,
      createdAt: evidence.createdAt,
      updatedAt: evidence.updatedAt,
      role: roles.get(evidence.id) ?? null,
    }));
}

function buildPersonaView(persona: PersonaWithRelations): PersonaView {
  return {
    exists: true,
    id: persona.id,
    characterId: persona.characterId,
    origin: persona.origin,
    summary: persona.summary,
    schemaVersion: persona.schemaVersion,
    traits: buildTraitViews(persona.traits),
    evidences: buildEvidenceViews(persona.evidences),
  };
}

function buildEmptyPersonaView(
  characterId: string,
  origin: PersonaOrigin | null,
): PersonaView {
  return {
    exists: false,
    id: null,
    characterId,
    origin,
    summary: null,
    schemaVersion: PERSONA_SCHEMA_VERSION,
    traits: [],
    evidences: [],
  };
}

export function isPersonaSchemaUnavailable(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === "P2021" || code === "P2022";
}

export async function withPersonaAvailability<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isPersonaSchemaUnavailable(error)) {
      throw new PersonaServiceError(
        "UNAVAILABLE",
        "Persona indisponível neste ambiente (migração pendente).",
        503,
      );
    }
    throw error;
  }
}

async function loadPersona(characterId: string): Promise<PersonaWithRelations | null> {
  return withPersonaAvailability(() =>
    prisma.characterPersona.findUnique({
      where: { characterId },
      include: personaInclude,
    }),
  );
}

export async function getPersonaView(
  userId: string,
  characterId: string,
): Promise<PersonaView> {
  const access = await resolvePersonaAccess(userId, characterId, "READ");
  if (access.kind === "NOT_FOUND" || access.kind === "FORBIDDEN") {
    throw notFoundError();
  }

  const persona = await loadPersona(characterId);
  if (persona) return buildPersonaView(persona);

  const origin =
    access.kind === "GLOBAL_AI_CATALOG"
      ? null
      : await resolveOwnedCharacterOrigin(access.character);

  return buildEmptyPersonaView(characterId, origin);
}

export async function ensurePersona(
  userId: string,
  characterId: string,
): Promise<{ persona: PersonaView; created: boolean }> {
  const access = await resolvePersonaAccess(userId, characterId, "WRITE");

  if (access.kind === "NOT_FOUND") throw notFoundError();
  if (access.kind === "FORBIDDEN" || access.kind === "GLOBAL_AI_CATALOG") {
    throw forbiddenError("Persona não pode ser criada para o catálogo global de AI");
  }

  const existing = await loadPersona(characterId);
  if (existing) return { persona: buildPersonaView(existing), created: false };

  const origin = await resolveOwnedCharacterOrigin(access.character);

  try {
    const created = await prisma.characterPersona.create({
      data: {
        characterId,
        origin,
        schemaVersion: PERSONA_SCHEMA_VERSION,
        summary: null,
        createdById: userId,
      },
      include: personaInclude,
    });
    return { persona: buildPersonaView(created), created: true };
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      const raced = await loadPersona(characterId);
      if (raced) return { persona: buildPersonaView(raced), created: false };
    }
    throw error;
  }
}

export type ManualPersonaTraitInput = {
  readonly key: string;
  readonly value: string;
};

export type UpdatePersonaManuallyInput = {
  readonly summary?: string | null;
  readonly traits?: readonly ManualPersonaTraitInput[];
};

function validationError(
  message: string,
  issues: readonly PersonaRuleIssue[],
): PersonaServiceError {
  return new PersonaServiceError("VALIDATION_ERROR", message, 400, issues);
}

function traitNotFoundError(): PersonaServiceError {
  return new PersonaServiceError("TRAIT_NOT_FOUND", "Trait não encontrado", 404);
}

function collectManualInputIssues(
  input: UpdatePersonaManuallyInput,
): PersonaRuleIssue[] {
  const issues: PersonaRuleIssue[] = [];

  if (typeof input.summary === "string") {
    const summaryIssue = inspectPersonaSummary(input.summary);
    if (summaryIssue) issues.push({ field: "summary", code: summaryIssue });
  }

  for (const trait of input.traits ?? []) {
    issues.push(...inspectPersonaTrait({ key: trait.key, value: trait.value }));
  }

  return issues;
}

function requireWriteAccess(
  access: PersonaAccessResolution,
): PersonaAccessCharacter {
  if (access.kind === "NOT_FOUND") throw notFoundError();
  if (access.kind === "FORBIDDEN" || access.kind === "GLOBAL_AI_CATALOG") {
    throw forbiddenError("Persona não pode ser editada no catálogo global de AI");
  }
  return access.character;
}

async function retryOnUniqueConflict<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    return await operation();
  }
}

export async function updatePersonaManually(
  userId: string,
  characterId: string,
  input: UpdatePersonaManuallyInput,
): Promise<PersonaView> {
  const issues = collectManualInputIssues(input);
  if (issues.length > 0) {
    throw validationError("Dados de persona inválidos", issues);
  }

  const access = await resolvePersonaAccess(userId, characterId, "WRITE");
  const character = requireWriteAccess(access);

  const traits = input.traits ?? [];
  const summaryProvided = input.summary !== undefined;
  const needsPersistence =
    traits.length > 0 || (summaryProvided && input.summary !== null);

  if (!needsPersistence) {
    const existing = await loadPersona(characterId);
    if (!existing) {
      const origin = await resolveOwnedCharacterOrigin(character);
      return buildEmptyPersonaView(characterId, origin);
    }
    if (summaryProvided && existing.summary !== null) {
      const cleared = await prisma.characterPersona.update({
        where: { characterId },
        data: { summary: null },
        include: personaInclude,
      });
      return buildPersonaView(cleared);
    }
    return buildPersonaView(existing);
  }

  await ensurePersona(userId, characterId);

  const manual = resolveManualTraitOverride();

  const updated = await retryOnUniqueConflict(() =>
    prisma.$transaction(async (tx) => {
      const persona = await tx.characterPersona.findUniqueOrThrow({
        where: { characterId },
        select: { id: true, summary: true },
      });

      if (summaryProvided && input.summary !== persona.summary) {
        await tx.characterPersona.update({
          where: { characterId },
          data: { summary: input.summary ?? null },
        });
      }

      for (const trait of traits) {
        await tx.personaTrait.upsert({
          where: { personaId_key_context: { personaId: persona.id, key: trait.key, context: "ON_TRACK" } },
          update: { value: trait.value, ...manual },
          create: {
            personaId: persona.id,
            key: trait.key,
            value: trait.value,
            ...manual,
          },
        });
      }

      return tx.characterPersona.findUniqueOrThrow({
        where: { characterId },
        include: personaInclude,
      });
    }),
  );

  return buildPersonaView(updated);
}

export async function deletePersonaTrait(
  userId: string,
  characterId: string,
  traitKey: string,
): Promise<PersonaView> {
  const keyIssue = inspectPersonaTraitKey(traitKey);
  if (keyIssue) {
    throw validationError("Chave de trait inválida", [
      { field: "traitKey", code: keyIssue },
    ]);
  }

  const access = await resolvePersonaAccess(userId, characterId, "WRITE");
  requireWriteAccess(access);

  const persona = await prisma.characterPersona.findUnique({
    where: { characterId },
    select: { id: true },
  });
  if (!persona) throw notFoundError();

  const trait = await prisma.personaTrait.findUnique({
      where: { personaId_key_context: { personaId: persona.id, key: traitKey, context: "ON_TRACK" } },
    select: { id: true },
  });
  if (!trait) throw traitNotFoundError();

  try {
    await prisma.personaTrait.delete({ where: { id: trait.id } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") throw traitNotFoundError();
    throw error;
  }

  const reloaded = await prisma.characterPersona.findUniqueOrThrow({
    where: { characterId },
    include: personaInclude,
  });
  return buildPersonaView(reloaded);
}

export type CreatePersonaEvidenceInput = {
  readonly traitKey: string;
  readonly proposedValue: string;
  readonly sourceType: PersonaEvidenceType;
  readonly title: string;
  readonly url?: string | null;
  readonly publishedAt?: Date | null;
  readonly excerpt: string;
  readonly confidence: number;
};

export type PersonaEvidenceReviewStatus = "APPROVED" | "REJECTED";

export type ReviewPersonaEvidenceInput = {
  readonly status: PersonaEvidenceReviewStatus;
  readonly confidence?: number;
};

function evidenceNotFoundError(): PersonaServiceError {
  return new PersonaServiceError(
    "EVIDENCE_NOT_FOUND",
    "Evidência não encontrada",
    404,
  );
}

function invalidTransitionError(
  from: PersonaEvidenceStatus,
  to: PersonaEvidenceStatus,
): PersonaServiceError {
  return new PersonaServiceError(
    "INVALID_TRANSITION",
    `Transição de evidência inválida: ${from} -> ${to}`,
    409,
  );
}

async function requireAdminReviewer(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!user || user.role !== "ADMIN") {
    throw forbiddenError("Apenas administradores podem revisar evidências de persona");
  }
}

async function reconcileTraitWithinTransaction(
  tx: Prisma.TransactionClient,
  personaId: string,
  traitKey: string,
): Promise<void> {
  const evidences = await tx.personaEvidence.findMany({
    where: { personaId, traitKey },
  });
  const trait = await tx.personaTrait.findUnique({
      where: { personaId_key_context: { personaId, key: traitKey, context: "ON_TRACK" } },
  });

  const plan = planPersonaTraitReconcile({
    currentSourceKind: trait?.sourceKind ?? null,
    currentEvidenceId: trait?.evidenceId ?? null,
    evidences,
  });

  if (plan.kind === "NO_EFFECTIVE_TRAIT" || plan.kind === "KEEP_MANUAL_TRAIT") {
    return;
  }

  if (plan.kind === "REMOVE_EVIDENCE_TRAIT") {
    if (trait) await tx.personaTrait.delete({ where: { id: trait.id } });
    return;
  }

  const unchanged =
    trait !== null &&
    trait.value === plan.value &&
    trait.confidence === plan.confidence &&
    trait.evidenceId === plan.evidenceId;
  if (unchanged) return;

  if (trait) {
    await tx.personaTrait.update({
      where: { id: trait.id },
      data: {
        value: plan.value,
        confidence: plan.confidence,
        sourceKind: "EVIDENCE",
        evidenceId: plan.evidenceId,
      },
    });
    return;
  }

  await tx.personaTrait.create({
    data: {
      personaId,
      key: traitKey,
      value: plan.value,
      confidence: plan.confidence,
      sourceKind: "EVIDENCE",
      evidenceId: plan.evidenceId,
    },
  });
}

export async function createPersonaEvidence(
  userId: string,
  characterId: string,
  input: CreatePersonaEvidenceInput,
): Promise<PersonaView> {
  const issues = inspectPersonaEvidenceProposal({
    traitKey: input.traitKey,
    proposedValue: input.proposedValue,
    confidence: input.confidence,
    sourceType: input.sourceType,
    title: input.title,
    url: input.url,
    publishedAt: input.publishedAt,
    excerpt: input.excerpt,
  });
  if (issues.length > 0) {
    throw validationError("Dados de evidência inválidos", issues);
  }

  const access = await resolvePersonaAccess(userId, characterId, "WRITE");
  requireWriteAccess(access);

  const ensured = await ensurePersona(userId, characterId);
  const personaId = ensured.persona.id;
  if (!personaId) throw notFoundError();

  await prisma.personaEvidence.create({
    data: {
      personaId,
      traitKey: input.traitKey,
      proposedValue: input.proposedValue,
      sourceType: input.sourceType,
      title: input.title,
      url: input.url ?? null,
      publishedAt: input.publishedAt ?? null,
      excerpt: input.excerpt,
      confidence: input.confidence,
      status: "PROPOSED",
      createdById: userId,
    },
  });

  const refreshed = await prisma.characterPersona.findUniqueOrThrow({
    where: { characterId },
    include: personaInclude,
  });
  return buildPersonaView(refreshed);
}

export async function reviewPersonaEvidence(
  reviewerUserId: string,
  evidenceId: string,
  input: ReviewPersonaEvidenceInput,
): Promise<PersonaView> {
  if (input.status !== "APPROVED" && input.status !== "REJECTED") {
    throw validationError("Status de revisão inválido", []);
  }

  if (input.confidence !== undefined) {
    const confidenceIssue = inspectPersonaConfidence(input.confidence);
    if (confidenceIssue) {
      throw validationError("Confiança inválida", [
        { field: "confidence", code: confidenceIssue },
      ]);
    }
  }

  await requireAdminReviewer(reviewerUserId);

  const evidence = await prisma.personaEvidence.findUnique({
    where: { id: evidenceId },
    select: { id: true, personaId: true },
  });
  if (!evidence) throw evidenceNotFoundError();

  const updated = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`persona:${evidence.personaId}`}))`;

    const current = await tx.personaEvidence.findUnique({
      where: { id: evidenceId },
      select: { id: true, personaId: true, traitKey: true, status: true },
    });
    if (!current) throw evidenceNotFoundError();

    const transition = planPersonaEvidenceStatusTransition(current.status, input.status);
    if (!transition.allowed) {
      throw invalidTransitionError(current.status, input.status);
    }

    await tx.personaEvidence.update({
      where: { id: evidenceId },
      data: {
        status: input.status,
        ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
        reviewedById: reviewerUserId,
        reviewedAt: new Date(),
      },
    });

    await reconcileTraitWithinTransaction(tx, current.personaId, current.traitKey);

    return tx.characterPersona.findUniqueOrThrow({
      where: { id: current.personaId },
      include: personaInclude,
    });
  });

  return buildPersonaView(updated);
}
