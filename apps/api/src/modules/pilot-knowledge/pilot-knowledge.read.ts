import { prisma } from "../../infrastructure/database/prisma.js";
import type { ExternalPersonaView } from "./pilot-knowledge.persona.js";
import { getExternalPersonaView } from "./pilot-knowledge.persona.js";
import type { PilotHistoryView } from "./pilot-knowledge.events.js";
import { getPilotHistoryView } from "./pilot-knowledge.events.js";
import type { PilotRelationshipsView } from "./pilot-knowledge.relationships.js";
import { getPilotRelationshipsView } from "./pilot-knowledge.relationships.js";
import type { DriverProfileView } from "./pilot-knowledge.access.js";
import { getDriverProfileView } from "./pilot-knowledge.profile.js";
import { listKnowledgeSourcesForDriver } from "./pilot-knowledge.sources.js";

export type PilotSourceView = {
  readonly id: string;
  readonly provider: string;
  readonly sourceKind: string;
  readonly url: string | null;
  readonly title: string | null;
  readonly license: string;
  readonly attributionRequirement: string | null;
  readonly attributionText: string | null;
  readonly publishedAt: Date | null;
  readonly retrievedAt: Date;
  readonly sourceVersion: string | null;
};

export type PilotKnowledgeUnavailableReason =
  | "CHARACTER_NOT_FOUND"
  | "NO_DRIVER_PROFILE"
  | "NO_EXTERNAL_BINDING"
  | "NO_EXTERNAL_PROFILE";

export type PilotKnowledgeView =
  | { readonly available: false; readonly reason: PilotKnowledgeUnavailableReason }
  | {
      readonly available: true;
      readonly topic: string | null;
      readonly profile: Extract<DriverProfileView, { available: true }>;
      readonly persona: ExternalPersonaView;
      readonly history: Extract<PilotHistoryView, { available: true }>;
      readonly relationships: Extract<PilotRelationshipsView, { available: true }>;
      readonly sources: readonly PilotSourceView[];
    };

export async function getPilotKnowledgeView(
  characterId: string,
  options: { readonly topic?: string | null; readonly now?: Date } = {},
): Promise<PilotKnowledgeView> {
  const now = options.now ?? new Date();
  const topic = options.topic?.trim() ?? null;

  const [profileResult, personaResult, historyResult, relationshipsResult] = await Promise.all([
    getDriverProfileView(characterId, now),
    getExternalPersonaView(characterId, now),
    getPilotHistoryView(characterId, { topic }),
    getPilotRelationshipsView(characterId, now),
  ]);

  if (!profileResult.available) {
    return { available: false, reason: profileResult.reason };
  }

  const externalDriverId = profileResult.externalIdentity.externalDriverId;
  const sources = await listKnowledgeSourcesForDriver(externalDriverId);

  const history = historyResult.available ? historyResult : { available: true as const, events: [], relevant: [] };
  const relationships = relationshipsResult.available
    ? relationshipsResult
    : { available: true as const, entries: [], universeOverrides: [] };

  return {
    available: true,
    topic,
    profile: profileResult,
    persona: personaResult,
    history,
    relationships,
    sources: sources.map((source) => ({
      id: source.id,
      provider: source.provider,
      sourceKind: source.sourceKind,
      url: source.url,
      title: source.title,
      license: source.license,
      attributionRequirement: source.attributionRequirement,
      attributionText: source.attributionText,
      publishedAt: source.publishedAt,
      retrievedAt: source.retrievedAt,
      sourceVersion: source.sourceVersion,
    })),
  };
}

export async function findExternalDriverIdForCharacter(
  characterId: string,
): Promise<string | null> {
  const binding = await prisma.externalBindingDriver.findFirst({
    where: { characterId },
    orderBy: { createdAt: "asc" },
    select: { externalDriverId: true },
  });
  return binding?.externalDriverId ?? null;
}
