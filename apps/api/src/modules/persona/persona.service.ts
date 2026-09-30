import type { PersonaEvidenceType, PersonaOrigin, Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  resolveEvidenceAuthority,
  sortPersonaTraits,
  type PersonaEvidenceStatus,
  type PersonaTraitSource,
} from "./persona.rules.js";

export const PERSONA_SCHEMA_VERSION = "persona.v1";

export type PersonaServiceErrorCode = "NOT_FOUND" | "FORBIDDEN";

export class PersonaServiceError extends Error {
  constructor(
    public readonly code: PersonaServiceErrorCode,
    message: string,
    public readonly statusCode: number,
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

async function loadPersona(characterId: string): Promise<PersonaWithRelations | null> {
  return prisma.characterPersona.findUnique({
    where: { characterId },
    include: personaInclude,
  });
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
