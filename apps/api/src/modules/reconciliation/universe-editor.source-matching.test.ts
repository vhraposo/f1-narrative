import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { JOLPICA_SOURCE } from "../external-sync/jolpica.service.js";
import { reconciliationService } from "./reconciliation.service.js";
import { seedReconciliationFixture, type ReconFixtureIds } from "./reconciliation.fixtures.js";

let app: FastifyInstance;
const activeCleanups: Array<() => Promise<void>> = [];

async function countCharacters() {
  return prisma.character.count();
}
async function countEntries() {
  return prisma.seasonDriverEntry.count();
}
async function countExternalDrivers() {
  return prisma.externalDriver.count({ where: { source: JOLPICA_SOURCE } });
}
async function countResults() {
  return prisma.raceResult.count();
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterEach(async () => {
  for (const cleanup of activeCleanups.splice(0)) {
    await cleanup();
  }
});

afterAll(async () => {
  await app.close();
});

describe("Universe Editor API — invariantes de vínculo de piloto (source matching)", () => {
  it("candidates listing retorna candidatos não vinculados para um driver externo", async () => {
    const fixture = await seedReconciliationFixture(2026);
    activeCleanups.push(fixture.cleanup);
    const { ids, cleanup } = fixture;

    const ze = await prisma.character.create({
      data: { name: "Zé da Silva", nationality: "Brasileira", birthDate: new Date("2002-01-01"), userId: ids.userId },
    });
    const zeDriver = await prisma.driverProfile.create({ data: { characterId: ze.id, number: 44 } });
    const extZe = await prisma.externalDriver.create({
      data: { source: JOLPICA_SOURCE, externalId: "ze-source", name: "Zé da Silva", fullName: "Zé da Silva", nationality: "Brasileira", number: 44, contentHash: "ze-hash" },
    });
    activeCleanups.push(async () => {
      await prisma.externalDriver.deleteMany({ where: { id: extZe.id } });
      await prisma.driverProfile.deleteMany({ where: { id: zeDriver.id } });
      await prisma.character.deleteMany({ where: { id: ze.id } });
    });

    const listing = await reconciliationService.listCandidates(ids.userId, "DRIVER", { source: JOLPICA_SOURCE, externalId: "ze-source" });
    expect(listing.currentBinding).toBeNull();
    expect(listing.external.label).toBe("Zé da Silva");
    expect(listing.candidates).toHaveLength(1);
    expect(listing.candidates[0].id).toBe(ze.id);
    expect(listing.candidates[0].score).toBeGreaterThanOrEqual(0.5);
  });

  it("confirmar vínculo de piloto não cria nem altera Character/SeasonDriverEntry/records externos", async () => {
    const fixture = await seedReconciliationFixture(2026);
    activeCleanups.push(fixture.cleanup);
    const { ids } = fixture;

    const ze = await prisma.character.create({
      data: { name: "Zé da Silva", nationality: "Brasileira", birthDate: new Date("2002-01-01"), userId: ids.userId },
    });
    const zeDriver = await prisma.driverProfile.create({ data: { characterId: ze.id, number: 44 } });
    const extZe = await prisma.externalDriver.create({
      data: { source: JOLPICA_SOURCE, externalId: "ze-source", name: "Zé da Silva", fullName: "Zé da Silva", nationality: "Brasileira", number: 44, contentHash: "ze-hash" },
    });
    activeCleanups.push(async () => {
      await prisma.externalBindingDriver.deleteMany({ where: { externalDriverId: extZe.id } });
      await prisma.externalDriver.deleteMany({ where: { id: extZe.id } });
      await prisma.driverProfile.deleteMany({ where: { id: zeDriver.id } });
      await prisma.character.deleteMany({ where: { id: ze.id } });
    });

    const charsBefore = await countCharacters();
    const entriesBefore = await countEntries();
    const extDriversBefore = await countExternalDrivers();
    const resultsBefore = await countResults();
    const rosterBefore = await reconciliationService.buildRosterDiff(ids.seasonId);
    const standingsBefore = await reconciliationService.buildChampionshipDiff(ids.seasonId);

    const extZeSnapshot = await prisma.externalDriver.findUnique({ where: { id: extZe.id } });
    expect(extZeSnapshot!.contentHash).toBe("ze-hash");
    expect(extZeSnapshot!.number).toBe(44);

    const binding = await reconciliationService.confirmBinding(
      { id: ids.userId, role: "ADMIN" },
      "DRIVER",
      { source: JOLPICA_SOURCE, externalId: "ze-source" },
    );
    expect(binding.confidence).toBe("CONFIRMED");

    const charsAfter = await countCharacters();
    const entriesAfter = await countEntries();
    const extDriversAfter = await countExternalDrivers();
    const resultsAfter = await countResults();
    const rosterAfter = await reconciliationService.buildRosterDiff(ids.seasonId);
    const standingsAfter = await reconciliationService.buildChampionshipDiff(ids.seasonId);

    expect(charsAfter).toBe(charsBefore);
    expect(entriesAfter).toBe(entriesBefore);
    expect(extDriversAfter).toBe(extDriversBefore);
    expect(resultsAfter).toBe(resultsBefore);
    expect(rosterAfter.seatOccupancy).toEqual(rosterBefore.seatOccupancy);
    expect(standingsAfter.rows.length).toBe(standingsBefore.rows.length);

    const extZeAfter = await prisma.externalDriver.findUnique({ where: { id: extZe.id } });
    expect(extZeAfter!.contentHash).toBe("ze-hash");
    expect(extZeAfter!.number).toBe(44);

    const characterAfter = await prisma.character.findUnique({ where: { id: ze.id } });
    expect(characterAfter!.name).toBe("Zé da Silva");
  });

  it("ambiguidade: confirmar sem sugerir quando há >1 candidato lança AMBIGUOUS_CANDIDATES", async () => {
    const fixture = await seedReconciliationFixture(2026);
    activeCleanups.push(fixture.cleanup);
    const { ids } = fixture;

    const ze = await prisma.character.create({
      data: { name: "Zé da Silva", nationality: "Brasileira", birthDate: new Date("2002-01-01"), userId: ids.userId },
    });
    const zeDriver = await prisma.driverProfile.create({ data: { characterId: ze.id, number: 44 } });

    const zeJr = await prisma.character.create({
      data: { name: "Zé da Silva Jr", nationality: "Brasileira", birthDate: new Date("2002-02-02"), userId: ids.userId },
    });
    const zeJrDriver = await prisma.driverProfile.create({ data: { characterId: zeJr.id, number: 99 } });

    const extZe = await prisma.externalDriver.create({
      data: { source: JOLPICA_SOURCE, externalId: "ze-ambiguous", name: "Zé da Silva", fullName: "Zé da Silva", nationality: "Brasileira", number: 44, contentHash: "ze-ambiguous-hash" },
    });
    activeCleanups.push(async () => {
      await prisma.externalDriver.deleteMany({ where: { id: extZe.id } });
      await prisma.driverProfile.deleteMany({ where: { id: { in: [zeDriver.id, zeJrDriver.id] } } });
      await prisma.character.deleteMany({ where: { id: { in: [ze.id, zeJr.id] } } });
    });

    await expect(
      reconciliationService.confirmBinding(
        { id: ids.userId, role: "ADMIN" },
        "DRIVER",
        { source: JOLPICA_SOURCE, externalId: "ze-ambiguous" },
      ),
    ).rejects.toMatchObject({ code: "AMBIGUOUS_CANDIDATES" });

    const listing = await reconciliationService.listCandidates(ids.userId, "DRIVER", { source: JOLPICA_SOURCE, externalId: "ze-ambiguous" });
    expect(listing.currentBinding).toBeNull();
    expect(listing.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it("desvincular remove o vínculo e permite re-sugerir", async () => {
    const fixture = await seedReconciliationFixture(2026);
    activeCleanups.push(fixture.cleanup);
    const { ids } = fixture;

    const ze = await prisma.character.create({
      data: { name: "Zé da Silva", nationality: "Brasileira", birthDate: new Date("2002-01-01"), userId: ids.userId },
    });
    const zeDriver = await prisma.driverProfile.create({ data: { characterId: ze.id, number: 44 } });
    const extZe = await prisma.externalDriver.create({
      data: { source: JOLPICA_SOURCE, externalId: "ze-unbind", name: "Zé da Silva", fullName: "Zé da Silva", nationality: "Brasileira", number: 44, contentHash: "ze-unbind-hash" },
    });
    activeCleanups.push(async () => {
      await prisma.externalBindingDriver.deleteMany({ where: { externalDriverId: extZe.id } });
      await prisma.externalDriver.deleteMany({ where: { id: extZe.id } });
      await prisma.driverProfile.deleteMany({ where: { id: zeDriver.id } });
      await prisma.character.deleteMany({ where: { id: ze.id } });
    });

    const binding = await reconciliationService.confirmBinding(
      { id: ids.userId, role: "ADMIN" },
      "DRIVER",
      { source: JOLPICA_SOURCE, externalId: "ze-unbind" },
    );
    expect(binding.confidence).toBe("CONFIRMED");

    const unbind = await reconciliationService.unbindBinding({ id: ids.userId, role: "ADMIN" }, binding.id);
    expect(unbind).toMatchObject({ ok: true, kind: "DRIVER" });

    const listing = await reconciliationService.listCandidates(ids.userId, "DRIVER", { source: JOLPICA_SOURCE, externalId: "ze-unbind" });
    expect(listing.currentBinding).toBeNull();
    expect(listing.candidates).toHaveLength(1);
    expect(listing.candidates[0].id).toBe(ze.id);
  });
});