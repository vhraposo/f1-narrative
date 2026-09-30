import { createHash } from "node:crypto";

import type { MemoryImportance } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { getDriverProfileView } from "../pilot-knowledge/pilot-knowledge.profile.js";
import { getExternalPersonaView } from "../pilot-knowledge/pilot-knowledge.persona.js";
import { getPilotHistoryView, type DriverEventView } from "../pilot-knowledge/pilot-knowledge.events.js";
import {
  getPilotRelationshipsView,
  type RelationshipEntryView,
} from "../pilot-knowledge/pilot-knowledge.relationships.js";
import {
  PILOT_CONTEXT_BIOGRAPHY_CAP,
  PILOT_CONTEXT_EVENTS_MAX,
  PILOT_CONTEXT_MEMORIES_MAX,
  PILOT_CONTEXT_RELATIONSHIPS_MAX,
  PILOT_CONTEXT_TRAITS_MAX,
  clampText,
  comparePublicTraits,
  publicTraitLabel,
} from "./pilot-context.policy.js";
import { TRAIT_VALUE_CAP } from "../pilot-knowledge/pilot-knowledge.policy.js";

export type PilotContextIdentity = {
  readonly publicName: string;
  readonly fullName: string | null;
  readonly nationality: string | null;
  readonly number: number | null;
  readonly teamName: string | null;
};

export type PilotContextBiography = {
  readonly text: string;
  readonly origin: "UNIVERSE" | "EXTERNAL";
};

export type PilotContextTrait = {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly origin: "UNIVERSE" | "EXTERNAL";
  readonly status: string | null;
};

export type PilotContextRelationship = {
  readonly kind: string;
  readonly label: string;
  readonly displayName: string;
  readonly state: string;
  readonly origin: "UNIVERSE" | "EXTERNAL";
  readonly classification: RelationshipEntryView["classification"];
  readonly validFrom: Date | null;
  readonly validTo: Date | null;
};

export type PilotContextMemory = {
  readonly id: string;
  readonly content: string;
  readonly summary: string | null;
  readonly importance: MemoryImportance;
};

export type PilotContextCurrentState = {
  readonly seasonYear: number | null;
  readonly seasonId: string | null;
  readonly teamName: string | null;
  readonly number: number | null;
  readonly standingPosition: number | null;
  readonly standingPoints: number | null;
  readonly recentResults: ReadonlyArray<{
    readonly raceName: string;
    readonly round: number | null;
    readonly position: number | null;
    readonly status: string | null;
  }>;
};

export type PilotContextView = {
  readonly speakerCharacterId: string;
  readonly universeId: string | null;
  readonly identity: PilotContextIdentity | null;
  readonly biography: PilotContextBiography | null;
  readonly effectivePersona: readonly PilotContextTrait[];
  readonly relationships: readonly PilotContextRelationship[];
  readonly historicalContext: readonly DriverEventView[];
  readonly memories: readonly PilotContextMemory[];
  readonly currentUniverseState: PilotContextCurrentState;
  readonly refresh: {
    readonly profile: "FRESH" | "STALE" | "UNKNOWN";
    readonly persona: "FRESH" | "STALE" | "UNKNOWN";
  };
  readonly topic: string | null;
  readonly omitted: { readonly reasons: readonly string[] };
  readonly fingerprint: string;
};

function memoryRelevance(memory: { content: string; summary: string | null; importance: MemoryImportance; createdAt: Date }, topic: string | null): number {
  const rank = memory.importance === "CRITICAL" ? 4 : memory.importance === "HIGH" ? 3 : memory.importance === "MEDIUM" ? 2 : 1;
  if (!topic || topic.trim().length === 0) return rank;
  const normalized = topic.trim().toLowerCase();
  const haystack = `${memory.content} ${memory.summary ?? ""}`.toLowerCase();
  return haystack.includes(normalized) ? rank + 8 : rank;
}

export async function resolvePilotContext(
  input: {
    readonly speakerCharacterId: string;
    readonly universeId?: string | null;
    readonly topic?: string | null;
    readonly now?: Date;
  },
): Promise<PilotContextView | null> {
  const now = input.now ?? new Date();
  const topic = input.topic?.trim() ?? null;

  const character = await prisma.character.findUnique({
    where: { id: input.speakerCharacterId },
    select: {
      id: true,
      universeId: true,
      biography: true,
      driverProfile: { select: { id: true } },
      persona: { include: { traits: true } },
    },
  });
  if (!character) return null;
  if (!character.driverProfile) return null;
  if (input.universeId && character.universeId !== input.universeId) return null;

  const [profileView, personaView, relationshipsView, historyView, memoriesRaw, state] = await Promise.all([
    getDriverProfileView(input.speakerCharacterId, now),
    getExternalPersonaView(input.speakerCharacterId, now),
    getPilotRelationshipsView(input.speakerCharacterId, now),
    getPilotHistoryView(input.speakerCharacterId, { topic, limit: PILOT_CONTEXT_EVENTS_MAX }),
    prisma.memory.findMany({
      where: { participants: { some: { characterId: input.speakerCharacterId } } },
      orderBy: [{ createdAt: "desc" }],
      take: 40,
      select: { id: true, content: true, summary: true, importance: true, createdAt: true },
    }),
    loadCurrentUniverseState(input.speakerCharacterId, character.universeId),
  ]);

  const omitted: string[] = [];

  const identity =
    profileView.available && profileView.identity
      ? {
          publicName: profileView.identity.publicName,
          fullName: profileView.identity.fullName,
          nationality: profileView.identity.nationality,
          number: profileView.identity.driverNumber,
          teamName: profileView.identity.currentTeamName,
        }
      : null;

  let biography: PilotContextBiography | null = null;
  if (profileView.available && profileView.biography.origin !== "NONE" && profileView.biography.context) {
    const origin = profileView.biography.origin === "UNIVERSE" ? "UNIVERSE" : "EXTERNAL";
    biography = {
      text: clampText(profileView.biography.context, PILOT_CONTEXT_BIOGRAPHY_CAP),
      origin,
    };
  }

  const externalTraits =
    personaView.available && personaView.traits
      ? personaView.traits.map((trait) => ({
          key: trait.traitKey,
          label: trait.label,
          value: trait.value,
          origin: "EXTERNAL" as const,
          status: trait.status,
        }))
      : [];
  const universeTraits = character.persona
    ? character.persona.traits.map((trait) => ({
        key: trait.key,
        label: publicTraitLabel(trait.key),
        value: clampText(trait.value, TRAIT_VALUE_CAP),
        origin: "UNIVERSE" as const,
        status: null,
      }))
    : [];
  const traitsByKey = new Map<string, PilotContextTrait>();
  for (const trait of universeTraits) traitsByKey.set(trait.key, trait);
  for (const trait of externalTraits) {
    if (!traitsByKey.has(trait.key)) traitsByKey.set(trait.key, trait);
  }
  const allTraits = [...traitsByKey.values()].sort((a, b) =>
    comparePublicTraits(
      { traitKey: a.key, status: a.status ?? "" },
      { traitKey: b.key, status: b.status ?? "" },
    ),
  );
  const effectivePersona = allTraits.slice(0, PILOT_CONTEXT_TRAITS_MAX);
  if (allTraits.length > effectivePersona.length) omitted.push("pilot-context-traits-truncated");

  const relationships: PilotContextRelationship[] = [];
  if (relationshipsView.available) {
    for (const entry of relationshipsView.entries) {
      if (entry.current) {
        relationships.push({
          kind: entry.kind,
          label: entry.label,
          displayName: entry.current.displayName,
          state: entry.current.state,
          origin: entry.current.origin,
          classification: entry.classification,
          validFrom: entry.current.validFrom,
          validTo: entry.current.validTo,
        });
      }
      for (const history of entry.history) {
        relationships.push({
          kind: entry.kind,
          label: entry.label,
          displayName: history.displayName,
          state: history.state,
          origin: history.origin,
          classification: entry.classification,
          validFrom: history.validFrom,
          validTo: history.validTo,
        });
      }
    }
  }
  const cappedRelationships = relationships.slice(0, PILOT_CONTEXT_RELATIONSHIPS_MAX);
  if (relationships.length > cappedRelationships.length) {
    omitted.push("pilot-context-relationships-truncated");
  }

  const historicalContext = historyView.available ? historyView.relevant : [];
  const memories = memoriesRaw
    .map((memory) => ({ memory, relevance: memoryRelevance(memory, topic) }))
    .sort((a, b) => {
      if (b.relevance !== a.relevance) return b.relevance - a.relevance;
      const createdDiff = b.memory.createdAt.getTime() - a.memory.createdAt.getTime();
      if (createdDiff !== 0) return createdDiff;
      return a.memory.id.localeCompare(b.memory.id);
    })
    .slice(0, PILOT_CONTEXT_MEMORIES_MAX)
    .map(({ memory }) => ({
      id: memory.id,
      content: clampText(memory.content, 300),
      summary: memory.summary ? clampText(memory.summary, 160) : null,
      importance: memory.importance,
    }));
  if (memoriesRaw.length > memories.length) omitted.push("pilot-context-memories-truncated");

  const view: Omit<PilotContextView, "fingerprint"> = {
    speakerCharacterId: input.speakerCharacterId,
    universeId: character.universeId,
    identity,
    biography,
    effectivePersona,
    relationships: cappedRelationships,
    historicalContext,
    memories,
    currentUniverseState: state,
    refresh: {
      profile: profileView.available ? profileView.refresh.status : "UNKNOWN",
      persona: personaView.available ? personaView.refresh.status : "UNKNOWN",
    },
    topic,
    omitted: { reasons: omitted },
  };

  return { ...view, fingerprint: computePilotContextFingerprint(view) };
}

async function loadCurrentUniverseState(
  characterId: string,
  universeId: string | null,
): Promise<PilotContextCurrentState> {
  const empty: PilotContextCurrentState = {
    seasonYear: null,
    seasonId: null,
    teamName: null,
    number: null,
    standingPosition: null,
    standingPoints: null,
    recentResults: [],
  };
  if (!universeId) return empty;

  const worldState = await prisma.worldState.findUnique({
    where: { universeId_key: { universeId, key: "default" } },
    select: { currentSeasonId: true },
  });
  const seasonId = worldState?.currentSeasonId ?? null;
  const season = seasonId
    ? await prisma.season.findUnique({ where: { id: seasonId }, select: { id: true, year: true } })
    : null;

  const driverProfile = await prisma.driverProfile.findUnique({
    where: { characterId },
    select: { id: true, number: true, team: { select: { name: true } } },
  });
  let standingPosition: number | null = null;
  let standingPoints: number | null = null;
  let recentResults: PilotContextCurrentState["recentResults"] = [];
  let entryNumber: number | null = null;
  let entryTeamName: string | null = null;

  if (driverProfile && season) {
    const [entry, standing, results] = await Promise.all([
      prisma.seasonDriverEntry.findUnique({
        where: { seasonId_driverProfileId: { seasonId: season.id, driverProfileId: driverProfile.id } },
        select: { number: true, team: { select: { name: true } } },
      }),
      prisma.championshipStanding.findUnique({
        where: { seasonId_driverProfileId: { seasonId: season.id, driverProfileId: driverProfile.id } },
        select: { position: true, points: true },
      }),
      prisma.raceResult.findMany({
        where: { driverProfileId: driverProfile.id, race: { seasonId: season.id } },
        orderBy: [{ race: { round: "desc" } }],
        take: 3,
        select: {
          position: true,
          status: true,
          race: { select: { name: true, round: true } },
        },
      }),
    ]);
    entryNumber = entry?.number ?? null;
    entryTeamName = entry?.team?.name ?? null;
    standingPosition = standing?.position ?? null;
    standingPoints = standing?.points ?? null;
    recentResults = results.map((result) => ({
      raceName: result.race.name,
      round: result.race.round,
      position: result.position,
      status: result.status,
    }));
  }

  return {
    seasonYear: season?.year ?? null,
    seasonId: season?.id ?? null,
    teamName: entryTeamName ?? driverProfile?.team?.name ?? null,
    number: entryNumber ?? driverProfile?.number ?? null,
    standingPosition,
    standingPoints,
    recentResults,
  };
}

export function computePilotContextFingerprint(view: Omit<PilotContextView, "fingerprint">): string {
  const canonical = JSON.stringify({
    speakerCharacterId: view.speakerCharacterId,
    universeId: view.universeId,
    identity: view.identity,
    biography: view.biography,
    persona: view.effectivePersona.map((trait) => [trait.key, trait.value, trait.origin]),
    relationships: view.relationships.map((relationship) => [
      relationship.kind,
      relationship.displayName,
      relationship.state,
      relationship.origin,
      relationship.classification,
      relationship.validFrom?.toISOString() ?? null,
      relationship.validTo?.toISOString() ?? null,
    ]),
    events: view.historicalContext.map((event) => [event.id, event.title, event.seasonYear]),
    memories: view.memories.map((memory) => memory.id),
    state: {
      seasonId: view.currentUniverseState.seasonId,
      teamName: view.currentUniverseState.teamName,
      number: view.currentUniverseState.number,
      standingPosition: view.currentUniverseState.standingPosition,
      standingPoints: view.currentUniverseState.standingPoints,
      recent: view.currentUniverseState.recentResults.map((result) => [
        result.round,
        result.position,
        result.status,
      ]),
    },
    topic: view.topic,
    omitted: view.omitted.reasons,
  });
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

export async function loadSpeakerPilotContext(
  characterId: string | undefined,
  options: { readonly topic?: string | null; readonly now?: Date } = {},
): Promise<PilotContextView | null> {
  if (!characterId) return null;
  try {
    return await resolvePilotContext({
      speakerCharacterId: characterId,
      topic: options.topic ?? null,
      ...(options.now ? { now: options.now } : {}),
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2021" || (error as { code?: string }).code === "P2022") {
      return null;
    }
    throw error;
  }
}
