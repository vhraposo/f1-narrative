import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import { JOLPICA_SOURCE } from "../external-sync/jolpica.service.js";
import { reconciliationService, type Actor } from "./reconciliation.service.js";
import { seedReconciliationFixture, type ReconFixtureIds } from "./reconciliation.fixtures.js";

const UNIVERSE_MODELS = [
  "character",
  "driverProfile",
  "team",
  "season",
  "race",
  "raceResult",
  "championshipStanding",
  "seasonDriverEntry",
  "driverEntryEvent",
  "worldState",
] as const;

const BINDING_MODELS = [
  "externalBindingDriver",
  "externalBindingTeam",
  "externalBindingSeason",
  "externalBindingRace",
  "externalBindingDriverSeason",
  "externalBindingResult",
  "externalBindingStanding",
] as const;

async function snapshotCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const model of [...UNIVERSE_MODELS, ...BINDING_MODELS]) {
    out[model] = await (prisma as unknown as Record<string, { count(): Promise<number> }>)[
      model
    ].count();
  }
  return out;
}

describe("ReconciliationService — isolamento (o reconciler nunca altera o universo) (2029)", () => {
  const year = 2029;
  let ids: ReconFixtureIds;
  let cleanup: () => Promise<void>;
  const actor: Actor = { id: "", role: "ADMIN" };

  beforeAll(async () => {
    const fixture = await seedReconciliationFixture(year);
    ids = fixture.ids;
    cleanup = fixture.cleanup;
    actor.id = ids.userId;
  });

  afterAll(async () => {
    await cleanup();
  });

  const driverQuery = { source: JOLPICA_SOURCE, externalId: "lando-norris" };

  it("operações somente-leitura não alteram universo nem vínculos", async () => {
    const before = await snapshotCounts();

    await reconciliationService.listCandidates(ids.userId, "DRIVER", driverQuery);
    await reconciliationService.listExternal("DRIVER", { source: JOLPICA_SOURCE });
    await reconciliationService.buildRosterDiff(ids.seasonId);
    await reconciliationService.buildChampionshipDiff(ids.seasonId);
    await reconciliationService.buildResultsDiff(ids.raceId);

    const after = await snapshotCounts();
    for (const model of Object.keys(before)) {
      expect(after[model]).toBe(before[model]);
    }
  });

  it("sugestão grava somente na tabela de vínculos (delta +1) e nada no universo", async () => {
    const before = await snapshotCounts();

    const suggested = (await reconciliationService.suggestBinding(
      actor,
      "DRIVER",
      driverQuery,
      ids.characterLandoId,
    )) as { confidence: "SUGGESTED" | "CONFIRMED" };
    expect(suggested.confidence).toBe("SUGGESTED");

    const after = await snapshotCounts();
    for (const model of UNIVERSE_MODELS) {
      expect(after[model]).toBe(before[model]);
    }
    expect(after.externalBindingDriver).toBe(before.externalBindingDriver + 1);
    for (const model of BINDING_MODELS.filter((m) => m !== "externalBindingDriver")) {
      expect(after[model]).toBe(before[model]);
    }
  });

  it("confirmação reutiliza o vínculo existente (delta permanece +1) e nada no universo", async () => {
    const before = await snapshotCounts();

    const confirmed = await reconciliationService.confirmBinding(actor, "DRIVER", driverQuery);
    expect(confirmed.confidence).toBe("CONFIRMED");

    const after = await snapshotCounts();
    for (const model of UNIVERSE_MODELS) {
      expect(after[model]).toBe(before[model]);
    }
    expect(after.externalBindingDriver).toBe(before.externalBindingDriver);
  });

  it("desvincular remove o vínculo sem tocar no universo", async () => {
    const before = await snapshotCounts();
    const row = await prisma.externalBindingDriver.findUniqueOrThrow({
      where: { externalDriverId: ids.extLandoId },
    });

    const result = await reconciliationService.unbindBinding(actor, row.id);
    expect(result.ok).toBe(true);

    const after = await snapshotCounts();
    for (const model of UNIVERSE_MODELS) {
      expect(after[model]).toBe(before[model]);
    }
    expect(after.externalBindingDriver).toBe(before.externalBindingDriver - 1);
  });
});