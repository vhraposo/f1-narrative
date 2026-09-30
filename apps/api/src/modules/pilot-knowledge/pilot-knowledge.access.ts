import type { Prisma } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";

export type PilotKnowledgeErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "AMBIGUOUS_IDENTITY"
  | "DRIVER_NOT_FOUND"
  | "PROFILE_NOT_FOUND"
  | "PERSONA_NOT_FOUND"
  | "RELATIONSHIP_NOT_FOUND"
  | "SOURCE_NOT_FOUND"
  | "AMBIGUOUS_CANDIDATES"
  | "PROVIDERS_UNAVAILABLE"
  | "EVOLUTION_STALE";

export class PilotKnowledgeError extends Error {
  constructor(
    public readonly code: PilotKnowledgeErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "PilotKnowledgeError";
  }
}

export type PilotKnowledgeAccessCharacter = {
  readonly id: string;
  readonly userId: string | null;
  readonly universeId: string | null;
};

export type PilotKnowledgeAccessResolution =
  | { readonly kind: "OWNER_CHARACTER"; readonly character: PilotKnowledgeAccessCharacter }
  | { readonly kind: "OWNER_UNIVERSE"; readonly character: PilotKnowledgeAccessCharacter }
  | { readonly kind: "GLOBAL_AI_CATALOG"; readonly character: PilotKnowledgeAccessCharacter }
  | { readonly kind: "NOT_FOUND" };

export async function resolvePilotKnowledgeAccess(
  userId: string,
  characterId: string,
): Promise<PilotKnowledgeAccessResolution> {
  const character: PilotKnowledgeAccessCharacter | null = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true, userId: true, universeId: true },
  });
  if (!character) return { kind: "NOT_FOUND" };
  if (character.userId === userId) return { kind: "OWNER_CHARACTER", character };
  if (character.userId === null && character.universeId === null) {
    return { kind: "GLOBAL_AI_CATALOG", character };
  }
  if (character.universeId !== null) {
    const universe = await prisma.universe.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (universe && universe.id === character.universeId) {
      return { kind: "OWNER_UNIVERSE", character };
    }
  }
  return { kind: "NOT_FOUND" };
}

export function requireOwnedAccess(
  access: PilotKnowledgeAccessResolution,
): PilotKnowledgeAccessCharacter {
  if (access.kind === "NOT_FOUND" || access.kind === "GLOBAL_AI_CATALOG") {
    throw new PilotKnowledgeError("NOT_FOUND", "Piloto não encontrado", 404);
  }
  return access.character;
}

export function isDatabaseUnavailableError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === "P2021" || code === "P2022";
}

export async function withPilotKnowledgeAvailability<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      throw new PilotKnowledgeError(
        "PROVIDERS_UNAVAILABLE",
        "Pilot knowledge indisponível neste ambiente (migração pendente).",
        503,
      );
    }
    throw error;
  }
}

export type ExternalDriverIdentityView = {
  readonly externalDriverId: string;
  readonly source: string;
  readonly name: string;
  readonly fullName: string | null;
  readonly nationality: string | null;
  readonly number: number | null;
  readonly wikidataQid: string | null;
  readonly f1dbDriverId: string | null;
};

export type BiographyView = {
  readonly display: string | null;
  readonly context: string | null;
  readonly origin: "UNIVERSE" | "EXTERNAL" | "NONE";
  readonly lastVerifiedAt: Date | null;
};

export type DriverProfileView =
  | {
      readonly available: false;
      readonly reason:
        | "CHARACTER_NOT_FOUND"
        | "NO_DRIVER_PROFILE"
        | "NO_EXTERNAL_BINDING"
        | "NO_EXTERNAL_PROFILE";
      readonly externalIdentity: ExternalDriverIdentityView | null;
    }
  | {
      readonly available: true;
      readonly externalIdentity: ExternalDriverIdentityView;
      readonly identity: {
        readonly publicName: string;
        readonly fullName: string | null;
        readonly dateOfBirth: Date | null;
        readonly placeOfBirth: string | null;
        readonly nationality: string | null;
        readonly representedCountry: string | null;
        readonly driverNumber: number | null;
        readonly driverCode: string | null;
        readonly currentTeamName: string | null;
        readonly officialLinks: Prisma.JsonValue | null;
      };
      readonly biography: BiographyView;
      readonly refresh: {
        readonly status: "FRESH" | "STALE" | "UNKNOWN";
        readonly lastVerifiedAt: Date | null;
      };
      readonly hasPersona: boolean;
    };
