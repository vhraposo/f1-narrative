import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import {
  getKnowledgeSourceById,
  listKnowledgeSourcesForDriver,
  recordKnowledgeSource,
  sanitizeSourceMetadata,
} from "./pilot-knowledge.sources.js";

const PREFIX = "pk-src";
const createdSourceIds: string[] = [];
const createdDriverIds: string[] = [];

function track<T extends { id: string }>(target: string[], row: T): T {
  target.push(row.id);
  return row;
}

afterAll(async () => {
  if (createdDriverIds.length > 0) {
    await prisma.externalDriver.deleteMany({ where: { id: { in: createdDriverIds } } });
  }
  if (createdSourceIds.length > 0) {
    await prisma.externalKnowledgeSource.deleteMany({ where: { id: { in: createdSourceIds } } });
  }
  await prisma.$disconnect();
});

describe("pilot knowledge source ledger", () => {
  it("1) registra source com licença, attribution e retrievedAt", async () => {
    const source = track(
      createdSourceIds,
      await recordKnowledgeSource({
        provider: "F1DB",
        sourceKind: "STRUCTURED_RELEASE",
        url: `https://f1db.example/release/${PREFIX}-1`,
        title: "F1DB release 2026.1",
        license: "CC_BY_4_0",
        attributionRequirement: "Obrigatória",
        attributionText: "F1DB — CC BY 4.0",
        sourceVersion: "2026.1",
        metadata: { records: 120 },
      }),
    );

    expect(source.provider).toBe("F1DB");
    expect(source.license).toBe("CC_BY_4_0");
    expect(source.attributionText).toBe("F1DB — CC BY 4.0");
    expect(source.retrievedAt).toBeInstanceOf(Date);
    expect(source.metadata).toEqual({ records: 120 });
  });

  it("2) deduplica por provider+url atualizando retrievedAt", async () => {
    const url = `https://wikidata.example/entity/${PREFIX}-2`;
    const first = track(
      createdSourceIds,
      await recordKnowledgeSource({
        provider: "WIKIDATA",
        sourceKind: "DATABASE_EXPORT",
        url,
        license: "CC0",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await recordKnowledgeSource({
      provider: "WIKIDATA",
      sourceKind: "DATABASE_EXPORT",
      url,
      title: "atualizado",
      license: "CC0",
    });

    expect(second.id).toBe(first.id);
    expect(second.title).toBe("atualizado");
    expect(second.retrievedAt.getTime()).toBeGreaterThanOrEqual(first.retrievedAt.getTime());
  });

  it("3) mesma URL em providers diferentes gera sources distintas", async () => {
    const url = `https://shared.example/${PREFIX}-3`;
    const a = track(
      createdSourceIds,
      await recordKnowledgeSource({
        provider: "F1DB",
        sourceKind: "STRUCTURED_RELEASE",
        url,
        license: "CC_BY_4_0",
      }),
    );
    const b = track(
      createdSourceIds,
      await recordKnowledgeSource({
        provider: "CURATED",
        sourceKind: "OFFICIAL_PROFILE",
        url,
        license: "PROPRIETARY_REFERENCE_ONLY",
      }),
    );

    expect(a.id).not.toBe(b.id);
    expect(a.license).toBe("CC_BY_4_0");
    expect(b.license).toBe("PROPRIETARY_REFERENCE_ONLY");
  });

  it("4) urls nulas não são mescladas", async () => {
    const a = track(
      createdSourceIds,
      await recordKnowledgeSource({
        provider: "CURATED",
        sourceKind: "PUBLIC_STATEMENT",
        license: "UNKNOWN",
      }),
    );
    const b = track(
      createdSourceIds,
      await recordKnowledgeSource({
        provider: "CURATED",
        sourceKind: "PUBLIC_STATEMENT",
        license: "UNKNOWN",
      }),
    );

    expect(a.id).not.toBe(b.id);
  });

  it("5) rejeita metadata com conteúdo bruto", () => {
    expect(() => sanitizeSourceMetadata({ content: "texto" })).toThrow();
    expect(() => sanitizeSourceMetadata({ transcript: "texto" })).toThrow();
    expect(() => sanitizeSourceMetadata({ records: 1 })).not.toThrow();
    expect(sanitizeSourceMetadata(null)).toBeUndefined();
  });

  it("6) ledger não armazena campos de conteúdo e é recuperável por id", async () => {
    const source = track(
      createdSourceIds,
      await recordKnowledgeSource({
        provider: "DRIVER_OFFICIAL",
        sourceKind: "OFFICIAL_PROFILE",
        url: `https://driver.example/${PREFIX}-6`,
        title: "Perfil oficial",
        license: "PROPRIETARY_REFERENCE_ONLY",
      }),
    );
    const loaded = await getKnowledgeSourceById(source.id);
    expect(loaded).not.toBeNull();
    const keys = Object.keys(loaded as object);
    expect(keys).not.toContain("content");
    expect(keys).not.toContain("excerpt");
    expect(keys).not.toContain("html");
  });

  it("7) lista sources distintas vinculadas a um piloto", async () => {
    const driver = track(
      createdDriverIds,
      await prisma.externalDriver.create({
        data: {
          source: "f1db",
          externalId: `${PREFIX}-driver`,
          name: "Piloto Ledger",
          contentHash: "hash-ledger",
        },
      }),
    );
    const profileSource = track(
      createdSourceIds,
      await recordKnowledgeSource({
        provider: "F1DB",
        sourceKind: "STRUCTURED_RELEASE",
        url: `https://f1db.example/${PREFIX}-7a`,
        license: "CC_BY_4_0",
      }),
    );
    const eventSource = track(
      createdSourceIds,
      await recordKnowledgeSource({
        provider: "CURATED",
        sourceKind: "NEWS_REPORT",
        url: `https://news.example/${PREFIX}-7b`,
        license: "PROPRIETARY_REFERENCE_ONLY",
      }),
    );
    await prisma.externalDriverEvent.create({
      data: {
        externalDriverId: driver.id,
        category: "F1_DEBUT",
        title: "Estreia",
        derivation: "CURATED_SOURCE",
        dedupeKey: `${PREFIX}-event`,
        sourceId: eventSource.id,
      },
    });
    await prisma.externalDriverProfile.create({
      data: {
        externalDriverId: driver.id,
        publicName: "Piloto Ledger",
        sourceId: profileSource.id,
      },
    });

    const sources = await listKnowledgeSourcesForDriver(driver.id);
    const ids = sources.map((source) => source.id);
    expect(ids).toContain(profileSource.id);
    expect(ids).toContain(eventSource.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
