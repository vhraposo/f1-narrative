import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import {
  createUniverseDriverRelationship,
  deleteUniverseDriverRelationship,
  getPilotRelationshipsView,
  ingestExternalRelationships,
  updateUniverseDriverRelationship,
  type ExternalRelationshipInput,
} from "./pilot-knowledge.relationships.js";

const PREFIX = "pk-rel";
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdDriverIds: string[] = [];

afterAll(async () => {
  if (createdDriverIds.length > 0) {
    await prisma.externalDriver.deleteMany({ where: { id: { in: createdDriverIds } } });
  }
  if (createdCharacterIds.length > 0) {
    await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  }
  if (createdUniverseIds.length > 0) {
    await prisma.universe.deleteMany({ where: { id: { in: createdUniverseIds } } });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

async function createFixture(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `${PREFIX}-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@f1nw.test`,
      name: `Owner ${label}`,
    },
  });
  createdUserIds.push(user.id);
  const universe = await prisma.universe.create({ data: { userId: user.id } });
  createdUniverseIds.push(universe.id);
  const driver = await prisma.externalDriver.create({
    data: {
      source: "f1db",
      externalId: `${PREFIX}-${label}`,
      name: `Piloto ${label}`,
      contentHash: `hash-${label}`,
    },
  });
  createdDriverIds.push(driver.id);
  const character = await prisma.character.create({
    data: {
      universeId: universe.id,
      controlledBy: "AI",
      name: `Piloto ${label}`,
      nationality: "NED",
      birthDate: new Date("1997-09-30T00:00:00.000Z"),
      driverProfile: { create: {} },
    },
  });
  createdCharacterIds.push(character.id);
  await prisma.externalBindingDriver.create({
    data: { universeId: universe.id, externalDriverId: driver.id, characterId: character.id },
  });
  return { user, universe, driver, character };
}

function relationship(
  overrides: Partial<ExternalRelationshipInput> & { kind: ExternalRelationshipInput["kind"]; displayName: string },
): ExternalRelationshipInput {
  return {
    targetType: "PUBLIC_PERSON",
    state: "ACTIVE",
    source: {
      provider: "WIKIDATA",
      sourceKind: "DATABASE_EXPORT",
      url: `https://wikidata.example/${PREFIX}-${Math.random().toString(36).slice(2, 8)}`,
      title: "Wikidata",
      license: "CC0",
    },
    ...overrides,
  };
}

describe("pilot relationships", () => {
  it("1) parceiro atual é resolvido com validade temporal", async () => {
    const { driver, character } = await createFixture("current");
    await ingestExternalRelationships(driver.id, [
      relationship({
        kind: "ROMANTIC_PARTNER",
        displayName: "Pessoa A",
        state: "ACTIVE",
        validFrom: new Date("2023-01-01T00:00:00.000Z"),
      }),
    ]);

    const view = await getPilotRelationshipsView(character.id, new Date("2026-09-30T00:00:00.000Z"));
    if (!view.available) throw new Error("unreachable");
    const partner = view.entries.find((entry) => entry.kind === "ROMANTIC_PARTNER");
    expect(partner?.current?.displayName).toBe("Pessoa A");
    expect(partner?.current?.origin).toBe("EXTERNAL");
    expect(partner?.classification).toBe("UNKNOWN");
  });

  it("2) troca de parceiro mantém histórico temporal", async () => {
    const { driver, character } = await createFixture("changed");
    await ingestExternalRelationships(driver.id, [
      relationship({
        kind: "SPOUSE",
        displayName: "Pessoa A",
        state: "ENDED",
        validFrom: new Date("2018-01-01T00:00:00.000Z"),
        validTo: new Date("2023-12-31T00:00:00.000Z"),
      }),
      relationship({
        kind: "SPOUSE",
        displayName: "Pessoa B",
        state: "ACTIVE",
        validFrom: new Date("2025-01-01T00:00:00.000Z"),
      }),
    ]);

    const view = await getPilotRelationshipsView(character.id, new Date("2026-06-01T00:00:00.000Z"));
    if (!view.available) throw new Error("unreachable");
    const spouse = view.entries.find((entry) => entry.kind === "SPOUSE");
    expect(spouse?.current?.displayName).toBe("Pessoa B");
    expect(spouse?.history.map((row) => row.displayName)).toEqual(["Pessoa A"]);
  });

  it("3) fontes de mesma autoridade conflitantes permanecem CONFLICT", async () => {
    const { driver, character } = await createFixture("conflict");
    await ingestExternalRelationships(driver.id, [
      relationship({
        kind: "ROMANTIC_PARTNER",
        displayName: "Pessoa A",
        validFrom: new Date("2024-01-01T00:00:00.000Z"),
        confidence: 0.8,
      }),
      relationship({
        kind: "ROMANTIC_PARTNER",
        displayName: "Pessoa B",
        validFrom: new Date("2024-01-01T00:00:00.000Z"),
        confidence: 0.8,
      }),
    ]);

    const view = await getPilotRelationshipsView(character.id, new Date("2026-01-01T00:00:00.000Z"));
    if (!view.available) throw new Error("unreachable");
    const partner = view.entries.find((entry) => entry.kind === "ROMANTIC_PARTNER");
    expect(partner?.classification).toBe("CONFLICT");
  });

  it("4) autoridade vence recência: oficial antigo não perde para rumor novo", async () => {
    const { driver, character } = await createFixture("authority");
    await ingestExternalRelationships(
      driver.id,
      [
        relationship({
          kind: "ROMANTIC_PARTNER",
          displayName: "Pessoa Oficial",
          validFrom: new Date("2024-01-01T00:00:00.000Z"),
          confidence: 0.5,
          source: {
            provider: "DRIVER_OFFICIAL",
            sourceKind: "PUBLIC_STATEMENT",
            url: `https://driver.example/${PREFIX}-official`,
            license: "PROPRIETARY_REFERENCE_ONLY",
          },
        }),
      ],
      new Date("2026-01-01T00:00:00.000Z"),
    );
    await ingestExternalRelationships(
      driver.id,
      [
        relationship({
          kind: "ROMANTIC_PARTNER",
          displayName: "Pessoa Rumor",
          validFrom: new Date("2024-01-01T00:00:00.000Z"),
          confidence: 0.99,
          source: {
            provider: "REPUTABLE_NEWS",
            sourceKind: "NEWS_REPORT",
            url: `https://news.example/${PREFIX}-rumor`,
            license: "PROPRIETARY_REFERENCE_ONLY",
          },
        }),
      ],
      new Date("2026-09-01T00:00:00.000Z"),
    );

    const view = await getPilotRelationshipsView(character.id, new Date("2026-09-30T00:00:00.000Z"));
    if (!view.available) throw new Error("unreachable");
    const partner = view.entries.find((entry) => entry.kind === "ROMANTIC_PARTNER");
    expect(partner?.current?.displayName).toBe("Pessoa Oficial");
  });

  it("5) ausência de dados permanece UNKNOWN e nada é inventado", async () => {
    const { character } = await createFixture("empty");
    const view = await getPilotRelationshipsView(character.id);
    if (!view.available) throw new Error("unreachable");
    expect(view.entries).toEqual([]);
    expect(view.universeOverrides).toEqual([]);
  });

  it("6) override do Universe vence e classifica DIVERGENT; delete volta ao externo", async () => {
    const { user, driver, character } = await createFixture("override");
    await ingestExternalRelationships(driver.id, [
      relationship({
        kind: "ROMANTIC_PARTNER",
        displayName: "Pessoa Externa",
        validFrom: new Date("2023-01-01T00:00:00.000Z"),
        source: {
          provider: "WIKIDATA",
          sourceKind: "DATABASE_EXPORT",
          url: `https://wikidata.example/${PREFIX}-override`,
          license: "CC0",
        },
      }),
    ]);

    const override = await createUniverseDriverRelationship(user.id, character.id, {
      kind: "ROMANTIC_PARTNER",
      targetType: "PUBLIC_PERSON",
      displayName: "Pessoa do Universe",
      state: "ACTIVE",
      validFrom: new Date("2025-01-01T00:00:00.000Z"),
    });

    let view = await getPilotRelationshipsView(character.id, new Date("2026-01-01T00:00:00.000Z"));
    if (!view.available) throw new Error("unreachable");
    let partner = view.entries.find((entry) => entry.kind === "ROMANTIC_PARTNER");
    expect(partner?.current?.displayName).toBe("Pessoa do Universe");
    expect(partner?.current?.origin).toBe("UNIVERSE");
    expect(partner?.externalCurrent?.displayName).toBe("Pessoa Externa");
    expect(partner?.classification).toBe("DIVERGENT");

    await updateUniverseDriverRelationship(user.id, override.id, { displayName: "Pessoa Externa" });
    view = await getPilotRelationshipsView(character.id, new Date("2026-01-01T00:00:00.000Z"));
    if (!view.available) throw new Error("unreachable");
    partner = view.entries.find((entry) => entry.kind === "ROMANTIC_PARTNER");
    expect(partner?.classification).toBe("MATCH");

    await deleteUniverseDriverRelationship(user.id, override.id);
    view = await getPilotRelationshipsView(character.id, new Date("2026-01-01T00:00:00.000Z"));
    if (!view.available) throw new Error("unreachable");
    partner = view.entries.find((entry) => entry.kind === "ROMANTIC_PARTNER");
    expect(partner?.current?.displayName).toBe("Pessoa Externa");
    expect(partner?.current?.origin).toBe("EXTERNAL");
  });

  it("7) refresh externo não sobrescreve override do Universe (A -> B -> C)", async () => {
    const { user, driver, character } = await createFixture("refresh");
    await ingestExternalRelationships(driver.id, [
      relationship({
        kind: "ROMANTIC_PARTNER",
        displayName: "Pessoa A",
        validFrom: new Date("2022-01-01T00:00:00.000Z"),
        source: {
          provider: "WIKIDATA",
          sourceKind: "DATABASE_EXPORT",
          url: `https://wikidata.example/${PREFIX}-refresh-a`,
          license: "CC0",
        },
      }),
    ]);
    await createUniverseDriverRelationship(user.id, character.id, {
      kind: "ROMANTIC_PARTNER",
      targetType: "PUBLIC_PERSON",
      displayName: "Pessoa B",
      state: "ACTIVE",
      validFrom: new Date("2024-01-01T00:00:00.000Z"),
    });
    await ingestExternalRelationships(driver.id, [
      relationship({
        kind: "ROMANTIC_PARTNER",
        displayName: "Pessoa C",
        validFrom: new Date("2026-06-01T00:00:00.000Z"),
        source: {
          provider: "WIKIDATA",
          sourceKind: "DATABASE_EXPORT",
          url: `https://wikidata.example/${PREFIX}-refresh-c`,
          license: "CC0",
        },
      }),
    ]);

    const view = await getPilotRelationshipsView(character.id, new Date("2026-09-30T00:00:00.000Z"));
    if (!view.available) throw new Error("unreachable");
    const partner = view.entries.find((entry) => entry.kind === "ROMANTIC_PARTNER");
    expect(partner?.current?.displayName).toBe("Pessoa B");
    expect(partner?.current?.origin).toBe("UNIVERSE");
    expect(partner?.externalCurrent?.displayName).toBe("Pessoa C");
    expect(partner?.classification).toBe("DIVERGENT");
  });

  it("8) relações familiares e profissionais são agrupadas por tipo", async () => {
    const { driver, character } = await createFixture("family");
    await ingestExternalRelationships(driver.id, [
      relationship({ kind: "PARENT", displayName: "Família P" }),
      relationship({ kind: "SIBLING", displayName: "Família S" }),
      relationship({
        kind: "TEAMMATE",
        displayName: "Colega T",
        targetType: "DRIVER",
      }),
    ]);
    const view = await getPilotRelationshipsView(character.id, new Date("2026-09-30T00:00:00.000Z"));
    if (!view.available) throw new Error("unreachable");
    const kinds = view.entries.map((entry) => entry.kind);
    expect(kinds).toContain("PARENT");
    expect(kinds).toContain("SIBLING");
    expect(kinds).toContain("TEAMMATE");
    expect(kinds).not.toContain("OTHER_PUBLIC_RELATION");
  });

  it("9) CRUD de override respeita ownership e alvo do mesmo Universe", async () => {
    const owner = await createFixture("own");
    const other = await createFixture("other");
    await expect(
      createUniverseDriverRelationship(other.user.id, owner.character.id, {
        kind: "SPOUSE",
        targetType: "PUBLIC_PERSON",
        displayName: "X",
        state: "ACTIVE",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      createUniverseDriverRelationship(owner.user.id, owner.character.id, {
        kind: "TEAMMATE",
        targetType: "CHARACTER",
        targetCharacterId: other.character.id,
        displayName: "Colega",
        state: "ACTIVE",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const created = await createUniverseDriverRelationship(owner.user.id, owner.character.id, {
      kind: "TEAMMATE",
      targetType: "CHARACTER",
      targetCharacterId: owner.character.id,
      displayName: "Colega",
      state: "ACTIVE",
    });
    await expect(
      updateUniverseDriverRelationship(other.user.id, created.id, { displayName: "Y" }),
    ).rejects.toMatchObject({ code: "RELATIONSHIP_NOT_FOUND" });
    await updateUniverseDriverRelationship(owner.user.id, created.id, { displayName: "Colega Atualizado" });
    const reloaded = await prisma.universeDriverRelationship.findUniqueOrThrow({ where: { id: created.id } });
    expect(reloaded.displayName).toBe("Colega Atualizado");
    await deleteUniverseDriverRelationship(owner.user.id, created.id);
    expect(await prisma.universeDriverRelationship.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it("10) ingest é idempotente por fonte/validade ao reprocessar refresh", async () => {
    const { driver } = await createFixture("idempotent");
    const input = relationship({
      kind: "SPOUSE",
      displayName: "Pessoa A",
      validFrom: new Date("2020-01-01T00:00:00.000Z"),
      source: {
        provider: "WIKIDATA",
        sourceKind: "DATABASE_EXPORT",
        url: `https://wikidata.example/${PREFIX}-idem`,
        license: "CC0",
      },
    });
    await ingestExternalRelationships(driver.id, [input]);
    await ingestExternalRelationships(driver.id, [input]);
    const count = await prisma.externalDriverRelationship.count({
      where: { externalDriverId: driver.id },
    });
    expect(count).toBe(1);
  });
});
