import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import { deleteKnowledgeSourcesForDrivers } from "../../test-utils/pilot-knowledge-cleanup.js";
import { getCuratedEvidenceDataset } from "./biography.evidence.js";
import { evaluateBiographyCoverage, RICH_BIOGRAPHY_MIN_AREAS } from "./biography.coverage.js";
import { buildApprovedBiographyClaims } from "./biography.claims.js";
import { ensurePilotKnowledgeProvisioned } from "./pilot-knowledge.provision.js";

const GRID_FIXTURE: ReadonlyArray<{ readonly id: string; readonly name: string }> = [
  { id: "george-russell", name: "George Russell" },
  { id: "kimi-antonelli", name: "Kimi Antonelli" },
  { id: "charles-leclerc", name: "Charles Leclerc" },
  { id: "lewis-hamilton", name: "Lewis Hamilton" },
  { id: "lando-norris", name: "Lando Norris" },
  { id: "oscar-piastri", name: "Oscar Piastri" },
  { id: "max-verstappen", name: "Max Verstappen" },
  { id: "isack-hadjar", name: "Isack Hadjar" },
  { id: "liam-lawson", name: "Liam Lawson" },
  { id: "arvid-lindblad", name: "Arvid Lindblad" },
  { id: "pierre-gasly", name: "Pierre Gasly" },
  { id: "franco-colapinto", name: "Franco Colapinto" },
  { id: "esteban-ocon", name: "Esteban Ocon" },
  { id: "oliver-bearman", name: "Oliver Bearman" },
  { id: "nico-hulkenberg", name: "Nico Hülkenberg" },
  { id: "gabriel-bortoleto", name: "Gabriel Bortoleto" },
  { id: "carlos-sainz-jr", name: "Carlos Sainz" },
  { id: "alexander-albon", name: "Alexander Albon" },
  { id: "fernando-alonso", name: "Fernando Alonso" },
  { id: "lance-stroll", name: "Lance Stroll" },
  { id: "sergio-perez", name: "Sergio Pérez" },
  { id: "valtteri-bottas", name: "Valtteri Bottas" },
];

const REQUIRED_LORE_CATEGORIES = ["ORIGIN", "KARTING", "JUNIOR_CAREER"] as const;
const RELEVANT_EXCLUDED = new Set(["IDENTITY", "CURRENT_CONTEXT"]);

const PREFIX = "bio-grid";
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdDriverIds: string[] = [];

afterAll(async () => {
  await deleteKnowledgeSourcesForDrivers(prisma, createdDriverIds);
  if (createdDriverIds.length > 0) {
    await prisma.externalDriverProfile.deleteMany({
      where: { externalDriverId: { in: createdDriverIds } },
    });
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

describe("curated grid evidence (dataset)", () => {
  it("1) todo o grid possui evidence curada com cobertura RICH e fases obrigatórias", () => {
    const dataset = getCuratedEvidenceDataset();
    expect(dataset).not.toBeNull();
    const failures: string[] = [];
    for (const driver of GRID_FIXTURE) {
      const bundle = dataset?.drivers.get(driver.id);
      if (!bundle) {
        failures.push(`${driver.id}: sem bundle curado`);
        continue;
      }
      const categories = new Set(bundle.claims.map((claim) => claim.category));
      for (const required of REQUIRED_LORE_CATEGORIES) {
        if (!categories.has(required)) failures.push(`${driver.id}: falta ${required}`);
      }
      const relevantAreas = [...categories].filter(
        (category) => !RELEVANT_EXCLUDED.has(category),
      ).length;
      if (relevantAreas < RICH_BIOGRAPHY_MIN_AREAS) {
        failures.push(`${driver.id}: ${relevantAreas} áreas relevantes (<${RICH_BIOGRAPHY_MIN_AREAS})`);
      }
      if (bundle.claims.length < 12) {
        failures.push(`${driver.id}: ${bundle.claims.length} claims (<12)`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("2) claims curados têm fonte resolvida e chaves únicas por categoria", () => {
    const dataset = getCuratedEvidenceDataset();
    const failures: string[] = [];
    for (const driver of GRID_FIXTURE) {
      const bundle = dataset?.drivers.get(driver.id);
      if (!bundle) continue;
      const keys = new Set<string>();
      for (const claim of bundle.claims) {
        const source = bundle.sources.get(claim.sourceRef);
        if (!source) failures.push(`${driver.id}: sourceRef órfão ${claim.sourceRef}`);
        else if (!source.url.startsWith("https://")) {
          failures.push(`${driver.id}: url inválida ${source.url}`);
        }
        const dedupeKey = `${claim.category}:${claim.key}`;
        if (keys.has(dedupeKey)) failures.push(`${driver.id}: duplicado ${dedupeKey}`);
        keys.add(dedupeKey);
        if (claim.category !== "IDENTITY" && claim.display.trim().length < 40) {
          failures.push(`${driver.id}: display curto em ${claim.key}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("3) regressão: Lando, Max e Gasly continuam ricos com lore completa", () => {
    const dataset = getCuratedEvidenceDataset();
    for (const id of ["lando-norris", "max-verstappen", "pierre-gasly"]) {
      const bundle = dataset?.drivers.get(id);
      expect(bundle).toBeDefined();
      const categories = new Set(bundle?.claims.map((claim) => claim.category));
      expect(categories.has("KARTING")).toBe(true);
      expect(categories.has("JUNIOR_CAREER")).toBe(true);
      expect(categories.has("ORIGIN")).toBe(true);
      expect(categories.has("PUBLIC_PERSONALITY")).toBe(true);
      expect(categories.has("INTERESTS") || categories.has("PROJECTS")).toBe(true);
      expect((bundle?.claims.length ?? 0) >= 25).toBe(true);
      const personalityWithContext = (bundle?.claims ?? []).filter(
        (claim) =>
          claim.category === "PUBLIC_PERSONALITY" &&
          (claim.context === "ON_TRACK" || claim.context === "OFF_TRACK"),
      );
      expect(personalityWithContext.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("6) semântica do dataset: INTERESTS/PROJECTS nunca têm contexto de trait", () => {
    const dataset = getCuratedEvidenceDataset();
    expect(dataset).not.toBeNull();
    if (!dataset) return;
    const failures: string[] = [];
    for (const [driverId, bundle] of dataset.drivers) {
      for (const claim of bundle.claims) {
        if (
          (claim.category === "INTERESTS" || claim.category === "PROJECTS") &&
          claim.context !== null
        ) {
          failures.push(`${driverId}:${claim.key} tem contexto indevido`);
        }
        if (
          claim.category === "PUBLIC_PERSONALITY" &&
          claim.context !== null &&
          claim.context !== "ON_TRACK" &&
          claim.context !== "OFF_TRACK"
        ) {
          failures.push(`${driverId}:${claim.key} contexto inválido`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("curated grid evidence (pipeline)", () => {
  async function provisionDriver(name: string) {
    const user = await prisma.user.create({
      data: {
        email: `${PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@f1nw.test`,
        name: `Owner ${name}`,
      },
    });
    createdUserIds.push(user.id);
    const universe = await prisma.universe.create({ data: { userId: user.id } });
    createdUniverseIds.push(universe.id);
    const driver = await prisma.externalDriver.create({
      data: {
        source: "f1db",
        externalId: `${PREFIX}-${name.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}`,
        name,
        contentHash: `hash-${name}`,
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
    const result = await ensurePilotKnowledgeProvisioned(character.id, new Date("2026-10-01T00:00:00.000Z"));
    const profile = await prisma.externalDriverProfile.findUniqueOrThrow({
      where: { externalDriverId: driver.id },
      select: { biographyDisplay: true },
    });
    return { result, display: profile.biographyDisplay ?? "" };
  }

  it("4) pilotos novos geram biografia rica determinística com 5+ parágrafos", async () => {
    for (const name of ["George Russell", "Gabriel Bortoleto", "Yuki Tsunoda"]) {
      const { result, display } = await provisionDriver(name);
      const paragraphs = display
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph.length > 0);
      expect(result.biography?.mode).toBe("RICH_DETERMINISTIC");
      expect(paragraphs.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("5) claim set curado do grid atinge RICH no coverage validator", () => {
    const dataset = getCuratedEvidenceDataset();
    const bundle = dataset?.drivers.get("george-russell");
    expect(bundle).toBeDefined();
    if (!bundle) return;
    const claimSet = buildApprovedBiographyClaims({
      externalDriverId: "test-external",
      facts: {
        publicName: "George Russell",
        fullName: "George William Russell",
        dateOfBirth: new Date("1998-02-15T00:00:00.000Z"),
        placeOfBirth: "King's Lynn",
        nationality: "GBR",
        teams: ["Mercedes", "Williams"],
        career: {
          starts: 167,
          wins: 8,
          podiums: 32,
          poles: 12,
          fastestLaps: 13,
          titles: 0,
        },
        championships: [],
        interests: [],
        debutYear: 2019,
        milestoneTitles: [],
      },
      f1dbDriver: null,
      f1dbAmbiguous: false,
      f1dbSourceVersion: null,
      curated: bundle,
      evidenceVersion: "test",
    });
    const coverage = evaluateBiographyCoverage(claimSet);
    expect(coverage.rich).toBe(true);
  });
});
