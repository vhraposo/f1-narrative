import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import { deleteKnowledgeSourcesForDrivers } from "../../test-utils/pilot-knowledge-cleanup.js";
import { getPublicProfileView } from "./pilot-knowledge.public-profile.js";

const PREFIX = "pk-public-profile";
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdDriverIds: string[] = [];
const createdSeasonIds: string[] = [];

afterAll(async () => {
  await deleteKnowledgeSourcesForDrivers(prisma, createdDriverIds);
  if (createdSeasonIds.length > 0) {
    await prisma.externalDriverSeason.deleteMany({
      where: { externalDriverId: { in: createdDriverIds } },
    });
  }
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

async function createBoundDriver(label: string, name: string) {
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
      name,
      contentHash: `hash-${label}`,
    },
  });
  createdDriverIds.push(driver.id);
  const character = await prisma.character.create({
    data: {
      universeId: universe.id,
      controlledBy: "AI",
      name,
      nationality: "GBR",
      birthDate: new Date("1998-02-15T00:00:00.000Z"),
      driverProfile: { create: {} },
    },
  });
  createdCharacterIds.push(character.id);
  await prisma.externalBindingDriver.create({
    data: { universeId: universe.id, externalDriverId: driver.id, characterId: character.id },
  });
  return { driver, character };
}

describe("public profile read model", () => {
  it("1) driver com evidence curada rica → AVAILABLE com summary, facts e fontes", async () => {
    const { character } = await createBoundDriver("russell", "George Russell");
    const view = await getPublicProfileView(character.id);
    expect(view.status).toBe("AVAILABLE");
    expect(view.summary).toContain("George Russell");
    expect(view.summary).not.toBeNull();
    expect(view.facts.length).toBeGreaterThanOrEqual(5);
    expect(view.sources.length).toBeGreaterThanOrEqual(2);
    expect(view.relevantAreaCount).toBeGreaterThanOrEqual(5);
    expect(view.sources.every((source) => source.url.startsWith("https://"))).toBe(true);
  });

  it("2) driver sem evidence curada mas com claims derivados → PARTIAL", async () => {
    const { driver, character } = await createBoundDriver("partial", "Piloto Parcial");
    const season = await prisma.externalDriverSeason.create({
      data: {
        externalDriverId: driver.id,
        seasonYear: 2021,
        teamNameSnapshot: "Equipe Teste",
        source: "f1db",
        contentHash: "hash-partial-season",
      },
    });
    createdSeasonIds.push(season.id);

    const view = await getPublicProfileView(character.id);
    expect(view.status).toBe("PARTIAL");
    expect(view.summary).not.toBeNull();
    expect(view.facts.length).toBeGreaterThanOrEqual(1);
  });

  it("3) character sem binding externo → EMPTY", async () => {
    const user = await prisma.user.create({
      data: {
        email: `${PREFIX}-empty-${Date.now()}@f1nw.test`,
        name: "Owner Empty",
      },
    });
    createdUserIds.push(user.id);
    const universe = await prisma.universe.create({ data: { userId: user.id } });
    createdUniverseIds.push(universe.id);
    const character = await prisma.character.create({
      data: {
        universeId: universe.id,
        controlledBy: "AI",
        name: "Sem Vínculo",
        nationality: "BRA",
        birthDate: new Date("2000-01-01T00:00:00.000Z"),
      },
    });
    createdCharacterIds.push(character.id);

    const view = await getPublicProfileView(character.id);
    expect(view.status).toBe("EMPTY");
    expect(view.summary).toBeNull();
    expect(view.facts).toHaveLength(0);
  });

  it("4) summary determinístico não contém markdown nem JSON bruto", async () => {
    const { character } = await createBoundDriver("russell-2", "George Russell");
    const view = await getPublicProfileView(character.id);
    expect(view.summary ?? "").not.toContain("{");
    expect(view.summary ?? "").not.toContain("```");
    expect(view.facts.every((fact) => fact.display.length > 0)).toBe(true);
  });
});
