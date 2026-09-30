import type { ExternalDriverProfile, Prisma } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { PilotKnowledgeError } from "./pilot-knowledge.access.js";
import {
  PROFILE_BIOGRAPHY_CONTEXT_CAP,
  PROFILE_BIOGRAPHY_DISPLAY_CAP,
  PROFILE_FRESH_DAYS,
  clampText,
  computeRefreshStatus,
} from "./pilot-knowledge.policy.js";
import type { DriverProfileView } from "./pilot-knowledge.access.js";

export type BiographyFacts = {
  readonly publicName?: string | null;
  readonly fullName?: string | null;
  readonly dateOfBirth?: Date | null;
  readonly placeOfBirth?: string | null;
  readonly nationality?: string | null;
  readonly representedCountry?: string | null;
  readonly teams?: readonly string[];
  readonly championships?: readonly number[];
  readonly interests?: readonly string[];
  readonly milestoneTitles?: readonly string[];
};

const BIRTH_DATE_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function formatBirthDate(date: Date): string {
  return BIRTH_DATE_FORMAT.format(date);
}

function joinList(values: readonly string[]): string {
  const parts = values.filter((value) => value.trim().length > 0);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0] as string;
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

export function composeBiographyDisplay(facts: BiographyFacts): string | null {
  const name = (facts.publicName ?? facts.fullName ?? "").trim();
  const sentences: string[] = [];

  const birthParts: string[] = [];
  if (facts.placeOfBirth) birthParts.push(`em ${facts.placeOfBirth}`);
  if (facts.dateOfBirth) birthParts.push(`em ${formatBirthDate(facts.dateOfBirth)}`);
  if (name.length > 0 && birthParts.length > 0) {
    sentences.push(`${name} nasceu ${birthParts.join(" ")}.`);
  } else if (name.length > 0 && facts.nationality) {
    sentences.push(`${name} tem nacionalidade ${facts.nationality}.`);
  }

  const country = facts.representedCountry;
  if (country && country !== facts.nationality) {
    sentences.push(`Representa ${country} nas pistas.`);
  }

  if (facts.teams && facts.teams.length > 0) {
    sentences.push(`Na Fórmula 1, passou por ${joinList(facts.teams)}.`);
  }

  if (facts.championships && facts.championships.length > 0) {
    const years = facts.championships.map((year) => String(year));
    sentences.push(
      `Conquistou o campeonato mundial em ${joinList(years)}.`,
    );
  }

  if (facts.milestoneTitles && facts.milestoneTitles.length > 0) {
    sentences.push(`Marcos relevantes: ${joinList(facts.milestoneTitles)}.`);
  }

  if (facts.interests && facts.interests.length > 0) {
    sentences.push(`Entre seus interesses públicos estão ${joinList(facts.interests)}.`);
  }

  if (sentences.length === 0) return null;
  return clampText(sentences.join(" "), PROFILE_BIOGRAPHY_DISPLAY_CAP);
}

export function composeBiographyContext(facts: BiographyFacts): string | null {
  const name = (facts.publicName ?? facts.fullName ?? "").trim();
  const parts: string[] = [];
  if (name.length > 0) parts.push(name);
  if (facts.nationality) parts.push(facts.nationality);
  if (facts.dateOfBirth) parts.push(formatBirthDate(facts.dateOfBirth));
  if (facts.placeOfBirth) parts.push(facts.placeOfBirth);
  if (facts.championships && facts.championships.length > 0) {
    parts.push(`campeão em ${facts.championships.join(", ")}`);
  }
  if (facts.teams && facts.teams.length > 0) {
    parts.push(`equipes: ${facts.teams.join(", ")}`);
  }
  if (parts.length === 0) return null;
  return clampText(parts.join(" · "), PROFILE_BIOGRAPHY_CONTEXT_CAP);
}

export type StructuredDriverProfileInput = {
  readonly fullName?: string | null;
  readonly publicName?: string | null;
  readonly dateOfBirth?: Date | null;
  readonly placeOfBirth?: string | null;
  readonly nationality?: string | null;
  readonly representedCountry?: string | null;
  readonly driverNumber?: number | null;
  readonly driverCode?: string | null;
  readonly currentTeamName?: string | null;
  readonly officialLinks?: Prisma.InputJsonValue | null;
  readonly wikidataQid?: string | null;
  readonly f1dbDriverId?: string | null;
  readonly sourceId?: string | null;
  readonly biographyFacts?: BiographyFacts | null;
};

export async function upsertDriverProfileFromProvider(
  externalDriverId: string,
  input: StructuredDriverProfileInput,
  now: Date = new Date(),
): Promise<ExternalDriverProfile> {
  const externalDriver = await prisma.externalDriver.findUnique({
    where: { id: externalDriverId },
    select: { id: true },
  });
  if (!externalDriver) {
    throw new PilotKnowledgeError("DRIVER_NOT_FOUND", "Piloto externo não encontrado", 404);
  }

  const biography =
    input.biographyFacts === undefined || input.biographyFacts === null
      ? null
      : {
          biographyDisplay: composeBiographyDisplay(input.biographyFacts),
          biographyContext: composeBiographyContext(input.biographyFacts),
          biographySourceId: input.sourceId ?? null,
        };

  const data: Prisma.ExternalDriverProfileUncheckedCreateInput = {
    externalDriverId,
    fullName: input.fullName ?? null,
    publicName: input.publicName ?? null,
    dateOfBirth: input.dateOfBirth ?? null,
    placeOfBirth: input.placeOfBirth ?? null,
    nationality: input.nationality ?? null,
    representedCountry: input.representedCountry ?? null,
    driverNumber: input.driverNumber ?? null,
    driverCode: input.driverCode ?? null,
    currentTeamName: input.currentTeamName ?? null,
    officialLinks: input.officialLinks ?? undefined,
    wikidataQid: input.wikidataQid ?? null,
    f1dbDriverId: input.f1dbDriverId ?? null,
    sourceId: input.sourceId ?? null,
    biographyDisplay: biography?.biographyDisplay ?? null,
    biographyContext: biography?.biographyContext ?? null,
    biographySourceId: biography?.biographySourceId ?? null,
    refreshStatus: "FRESH",
    lastVerifiedAt: now,
  };

  return prisma.externalDriverProfile.upsert({
    where: { externalDriverId },
    create: data,
    update: data,
  });
}

export async function markDriverProfileStale(
  externalDriverId: string,
): Promise<void> {
  await prisma.externalDriverProfile.updateMany({
    where: { externalDriverId },
    data: { refreshStatus: "STALE" },
  });
}

export async function getDriverProfileView(
  characterId: string,
  now: Date = new Date(),
): Promise<DriverProfileView> {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      biography: true,
      driverProfile: { select: { id: true } },
      externalDriverBindings: {
        take: 1,
        orderBy: { createdAt: "asc" },
        select: {
          externalDriver: {
            select: {
              id: true,
              source: true,
              name: true,
              fullName: true,
              nationality: true,
              number: true,
              knowledgeProfile: { include: { persona: { select: { id: true } } } },
            },
          },
        },
      },
    },
  });
  if (!character) return { available: false, reason: "CHARACTER_NOT_FOUND", externalIdentity: null };
  if (!character.driverProfile) {
    return { available: false, reason: "NO_DRIVER_PROFILE", externalIdentity: null };
  }
  const binding = character.externalDriverBindings[0];
  if (!binding) {
    return { available: false, reason: "NO_EXTERNAL_BINDING", externalIdentity: null };
  }
  const driver = binding.externalDriver;
  const profile = driver.knowledgeProfile;
  const externalIdentity = {
    externalDriverId: driver.id,
    source: driver.source,
    name: driver.name,
    fullName: driver.fullName,
    nationality: driver.nationality,
    number: driver.number,
    wikidataQid: profile?.wikidataQid ?? null,
    f1dbDriverId: profile?.f1dbDriverId ?? null,
  };
  if (!profile) {
    return { available: false, reason: "NO_EXTERNAL_PROFILE", externalIdentity };
  }

  const universeBiography = character.biography?.trim() ?? null;
  const biography =
    universeBiography !== null && universeBiography.length > 0
      ? {
          display: universeBiography,
          context: universeBiography,
          origin: "UNIVERSE" as const,
          lastVerifiedAt: profile.lastVerifiedAt,
        }
      : profile.biographyDisplay || profile.biographyContext
        ? {
            display: profile.biographyDisplay,
            context: profile.biographyContext,
            origin: "EXTERNAL" as const,
            lastVerifiedAt: profile.lastVerifiedAt,
          }
        : { display: null, context: null, origin: "NONE" as const, lastVerifiedAt: null };

  return {
    available: true,
    externalIdentity,
    identity: {
      publicName: profile.publicName?.trim() || driver.name,
      fullName: profile.fullName ?? driver.fullName,
      dateOfBirth: profile.dateOfBirth,
      placeOfBirth: profile.placeOfBirth,
      nationality: profile.nationality ?? driver.nationality,
      representedCountry: profile.representedCountry,
      driverNumber: profile.driverNumber ?? driver.number,
      driverCode: profile.driverCode,
      currentTeamName: profile.currentTeamName,
      officialLinks: profile.officialLinks ?? null,
    },
    biography,
    refresh: {
      status: computeRefreshStatus(profile.lastVerifiedAt, now, PROFILE_FRESH_DAYS),
      lastVerifiedAt: profile.lastVerifiedAt,
    },
    hasPersona: profile.persona !== null,
  };
}
