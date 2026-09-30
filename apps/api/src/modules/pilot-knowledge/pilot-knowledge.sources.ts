import type {
  ExternalKnowledgeLicense,
  ExternalKnowledgeProvider,
  ExternalKnowledgeSource,
  ExternalKnowledgeSourceKind,
  Prisma,
} from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";

export type KnowledgeSourceInput = {
  readonly provider: ExternalKnowledgeProvider;
  readonly sourceKind: ExternalKnowledgeSourceKind;
  readonly url?: string | null;
  readonly title?: string | null;
  readonly license?: ExternalKnowledgeLicense;
  readonly attributionRequirement?: string | null;
  readonly attributionText?: string | null;
  readonly publishedAt?: Date | null;
  readonly sourceVersion?: string | null;
  readonly metadata?: Prisma.InputJsonValue | null;
};

export const SOURCE_CONTENT_FIELDS = ["content", "article", "transcript", "html", "body"] as const;

export function sanitizeSourceMetadata(
  metadata: Prisma.InputJsonValue | null | undefined,
): Prisma.InputJsonValue | undefined {
  if (metadata === null || metadata === undefined) return undefined;
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("metadata deve ser um objeto JSON");
  }
  const record = metadata as Record<string, Prisma.InputJsonValue>;
  for (const forbidden of SOURCE_CONTENT_FIELDS) {
    if (forbidden in record) {
      throw new Error(`metadata não pode conter conteúdo bruto (${forbidden})`);
    }
  }
  return record;
}

export async function recordKnowledgeSource(
  input: KnowledgeSourceInput,
  now: Date = new Date(),
): Promise<ExternalKnowledgeSource> {
  const url = input.url?.trim() ?? null;
  const data = {
    provider: input.provider,
    sourceKind: input.sourceKind,
    url,
    title: input.title?.trim() ?? null,
    license: input.license ?? ("UNKNOWN" as ExternalKnowledgeLicense),
    attributionRequirement: input.attributionRequirement?.trim() ?? null,
    attributionText: input.attributionText?.trim() ?? null,
    publishedAt: input.publishedAt ?? null,
    sourceVersion: input.sourceVersion?.trim() ?? null,
    metadata: sanitizeSourceMetadata(input.metadata),
  };

  if (url !== null) {
    const existing = await prisma.externalKnowledgeSource.findUnique({
      where: { provider_url: { provider: input.provider, url } },
    });
    if (existing) {
      return prisma.externalKnowledgeSource.update({
        where: { id: existing.id },
        data: { ...data, retrievedAt: now },
      });
    }
  }

  return prisma.externalKnowledgeSource.create({ data });
}

export async function getKnowledgeSourceById(
  id: string,
): Promise<ExternalKnowledgeSource | null> {
  return prisma.externalKnowledgeSource.findUnique({ where: { id } });
}

export async function listKnowledgeSourcesForDriver(
  externalDriverId: string,
  limit = 50,
): Promise<ExternalKnowledgeSource[]> {
  const [primary, evidences, relationships, events] = await Promise.all([
    prisma.externalKnowledgeSource.findMany({
      where: { driverProfiles: { some: { externalDriverId } } },
      orderBy: [{ retrievedAt: "desc" }],
      take: limit,
    }),
    prisma.externalKnowledgeSource.findMany({
      where: { personaEvidences: { some: { persona: { profile: { externalDriverId } } } } },
      orderBy: [{ retrievedAt: "desc" }],
      take: limit,
    }),
    prisma.externalKnowledgeSource.findMany({
      where: { driverRelationships: { some: { externalDriverId } } },
      orderBy: [{ retrievedAt: "desc" }],
      take: limit,
    }),
    prisma.externalKnowledgeSource.findMany({
      where: { driverEvents: { some: { externalDriverId } } },
      orderBy: [{ retrievedAt: "desc" }],
      take: limit,
    }),
  ]);
  const byId = new Map<string, ExternalKnowledgeSource>();
  for (const source of [...primary, ...evidences, ...relationships, ...events]) {
    byId.set(source.id, source);
  }
  return [...byId.values()]
    .sort((a, b) => b.retrievedAt.getTime() - a.retrievedAt.getTime() || a.id.localeCompare(b.id))
    .slice(0, limit);
}
