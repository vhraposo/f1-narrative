import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { JolpicaClient } from "../external-sync/jolpica.client.js";
import { JolpicaTransport } from "../external-sync/jolpica.transport.js";
import { JOLPICA_SOURCE, JolpicaSyncService } from "../external-sync/jolpica.service.js";
import { reconciliationService, type Actor } from "./reconciliation.service.js";
import { seedReconciliationFixture, type ReconFixtureIds } from "./reconciliation.fixtures.js";

type LandoBinding = {
  id: string;
  confidence: "SUGGESTED" | "CONFIRMED";
  characterId: string;
  boundBy: "USER" | "ADMIN" | null;
};

function driverQuery(externalId: string) {
  return { source: JOLPICA_SOURCE, externalId };
}

function seasonQuery(seasonYear: number) {
  return { source: JOLPICA_SOURCE, seasonYear };
}

function raceQuery(seasonYear: number, round = 1) {
  return { source: JOLPICA_SOURCE, seasonYear, round };
}

function resultQuery(seasonYear: number, externalId: string) {
  return { source: JOLPICA_SOURCE, seasonYear, round: 1, externalId };
}

function makeDummyClient(): JolpicaClient {
  return new JolpicaClient({
    transport: new JolpicaTransport({
      baseUrl: "https://mock.invalid/f1/",
      timeoutMs: 5000,
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts[parts.length - 1] === "drivers.json") {
          return new Response(JSON.stringify({ MRData: { DriverTable: { Drivers: [] } } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ MRData: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    }),
  });
}

function makeDrivers2026Client(): JolpicaClient {
  const drivers = [
    {
      driverId: "lando-norris",
      permanentNumber: "2",
      code: "NOR",
      givenName: "Lando",
      familyName: "Norris",
      nationality: "British",
    },
    {
      driverId: "oscar-piastri",
      permanentNumber: "4",
      code: "PIA",
      givenName: "Oscar",
      familyName: "Piastri",
      nationality: "Australian",
    },
    {
      driverId: "reserve-x",
      permanentNumber: "88",
      code: "REX",
      givenName: "Reserve",
      familyName: "X",
      nationality: "Unknown",
    },
  ];
  return new JolpicaClient({
    transport: new JolpicaTransport({
      baseUrl: "https://mock.invalid/f1/",
      timeoutMs: 5000,
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        const parts = url.pathname.split("/").filter(Boolean);
        const year = Number(parts[1]?.replace(/\.json$/, ""));
        if (parts[parts.length - 1] === "drivers.json" && year === 2026) {
          return new Response(JSON.stringify({ MRData: { DriverTable: { Drivers: drivers } } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ MRData: { DriverTable: { Drivers: [] } } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    }),
  });
}

describe("ReconciliationService — candidatos e ciclo de vida de vínculos (2026)", () => {
  const actor = {
    id: "" as string,
    role: "ADMIN" as Actor["role"],
  };
  let ids: ReconFixtureIds;
  let cleanup: () => Promise<void>;
  let landoBinding: LandoBinding;

  beforeAll(async () => {
    const fixture = await seedReconciliationFixture(2026);
    ids = fixture.ids;
    cleanup = fixture.cleanup;
    actor.id = ids.userId;
  });

  afterAll(async () => {
    await cleanup();
  });

  it("A) lista candidatos para o piloto externo Lando Norris", async () => {
    const listing = await reconciliationService.listCandidates(
      ids.userId,
      "DRIVER",
      driverQuery("lando-norris"),
    );
    expect(listing.external.label).toBe("Lando Norris");
    expect(listing.currentBinding).toBeNull();
    expect(listing.candidates).toHaveLength(1);
    expect(listing.candidates[0].id).toBe(ids.characterLandoId);
    expect(listing.candidates[0].score).toBeGreaterThan(0.5);
  });

  it("B) confirma explicitamente o piloto Lando Norris (confiança CONFIRMED)", async () => {
    const binding = (await reconciliationService.confirmBinding(
      actor,
      "DRIVER",
      driverQuery("lando-norris"),
    )) as LandoBinding;
    landoBinding = binding;
    expect(binding.confidence).toBe("CONFIRMED");
    expect(binding.characterId).toBe(ids.characterLandoId);
    expect(binding.boundBy).toBe("ADMIN");
  });

  it("C) invariante 1:1 — mesmo alvo não aceita segundo vínculo; mesmo externo não aceita re-sugestão", async () => {
    await expect(
      prisma.externalBindingDriver.create({
        data: {
          externalDriverId: ids.extOscarId,
          characterId: ids.characterLandoId,
          confidence: "SUGGESTED",
        },
      }),
    ).rejects.toThrow();
    await expect(
      reconciliationService.suggestBinding(
        actor,
        "DRIVER",
        driverQuery("lando-norris"),
        ids.characterLandoId,
      ),
    ).rejects.toMatchObject({ code: "ALREADY_BOUND" });
  });

  it("D) segunda tentativa é idempotente e não cria duplicado", async () => {
    const again = await reconciliationService.confirmBinding(
      actor,
      "DRIVER",
      driverQuery("lando-norris"),
    );
    expect(again.id).toBe(landoBinding.id);
    expect(again.confidence).toBe("CONFIRMED");
    expect(
      await prisma.externalBindingDriver.count({ where: { externalDriverId: ids.extLandoId } }),
    ).toBe(1);
  });

  it("E) desvincula e permite reconfirmar", async () => {
    const result = await reconciliationService.unbindBinding(actor, landoBinding.id);
    expect(result).toMatchObject({ ok: true, kind: "DRIVER" });

    const listing = await reconciliationService.listCandidates(
      ids.userId,
      "DRIVER",
      driverQuery("lando-norris"),
    );
    expect(listing.currentBinding).toBeNull();

    const rebound = (await reconciliationService.confirmBinding(
      actor,
      "DRIVER",
      driverQuery("lando-norris"),
    )) as LandoBinding;
    expect(rebound.confidence).toBe("CONFIRMED");
    expect(rebound.id).not.toBe(landoBinding.id);
    landoBinding = rebound;
  });

  it("F) sync da fonte não remove nem altera o vínculo existente", async () => {
    const service = new JolpicaSyncService(makeDrivers2026Client());
    const report = await service.sync(2026, "DRIVERS");
    expect(report.counts.created).toBe(0);

    expect(
      await prisma.externalDriver.count({
        where: { source: JOLPICA_SOURCE, externalId: { in: ["lando-norris", "oscar-piastri", "reserve-x"] } },
      }),
    ).toBe(3);

    const saved = await prisma.externalBindingDriver.findUniqueOrThrow({
      where: { externalDriverId: ids.extLandoId },
    });
    expect(saved.confidence).toBe("CONFIRMED");
    expect(saved.characterId).toBe(ids.characterLandoId);
  });

  it("G) sync não substitui o vínculo CONFIRMED por nova sugestão", async () => {
    await expect(
      reconciliationService.suggestBinding(
        actor,
        "DRIVER",
        driverQuery("lando-norris"),
        ids.characterLandoId,
      ),
    ).rejects.toMatchObject({ code: "ALREADY_BOUND" });

    const saved = await prisma.externalBindingDriver.findUniqueOrThrow({
      where: { externalDriverId: ids.extLandoId },
    });
    expect(saved.characterId).toBe(ids.characterLandoId);
    expect(saved.confidence).toBe("CONFIRMED");
  });
});

describe("ReconciliationService — diffs de roster, campeonato e resultados (2027)", () => {
  let ids: ReconFixtureIds;
  let cleanup: () => Promise<void>;
  const actor: Actor = { id: "", role: "ADMIN" };

  beforeAll(async () => {
    const fixture = await seedReconciliationFixture(2027);
    ids = fixture.ids;
    cleanup = fixture.cleanup;
    actor.id = ids.userId;
    const seasonDriverQuery = (externalId: string) =>
      ({ source: JOLPICA_SOURCE, seasonYear: 2027, externalId }) as const;

    await reconciliationService.confirmBinding(actor, "SEASON", seasonQuery(2027));
    await reconciliationService.confirmBinding(actor, "DRIVER", driverQuery("lando-norris"));
    await reconciliationService.suggestBinding(
      actor,
      "DRIVER",
      driverQuery("oscar-piastri"),
      ids.characterOscarId,
    );
    await reconciliationService.confirmBinding(actor, "DRIVER", driverQuery("oscar-piastri"));
    await reconciliationService.confirmBinding(actor, "DRIVER", driverQuery("reserve-x"));
    await reconciliationService.confirmBinding(actor, "RACE", raceQuery(2027));
    await reconciliationService.confirmBinding(
      actor,
      "DRIVER_SEASON",
      seasonDriverQuery("lando-norris"),
    );
    await reconciliationService.confirmBinding(
      actor,
      "DRIVER_SEASON",
      seasonDriverQuery("reserve-x"),
    );
    await reconciliationService.confirmBinding(
      actor,
      "STANDING",
      seasonDriverQuery("lando-norris"),
    );
    await reconciliationService.confirmBinding(actor, "RESULT", resultQuery(2027, "lando-norris"));
  });

  afterAll(async () => {
    await cleanup();
  });

  it("roster — Lando coincide, Oscar identificado sem vaga, Reserve X coincide", async () => {
    const diff = await reconciliationService.buildRosterDiff(ids.seasonId);
    expect(diff.externalSeason).not.toBeNull();
    expect(diff.externalSeason!.year).toBe(2027);

    const byId = new Map(diff.rows.map((row) => [row.external.externalId, row]));
    expect(byId.get("lando-norris")).toMatchObject({ status: "MATCHED", differences: [] });
    expect(byId.get("lando-norris")!.universe!.characterName).toBe("Lando Norris");
    expect(byId.get("oscar-piastri")).toMatchObject({
      status: "UNMATCHED",
      differences: ["identified-without-roster-entry"],
      universe: null,
    });
    expect(byId.get("reserve-x")).toMatchObject({ status: "MATCHED", differences: [] });
    expect(diff.universeOnly.map((u) => u.characterName)).toContain("Alicya Piastri");
  });

  it("roster — ocupação dos assentos: banco 2 divergente (Oscar externo x Alicya universo)", async () => {
    const diff = await reconciliationService.buildRosterDiff(ids.seasonId);
    const seat1 = diff.seatOccupancy.find((s) => s.seat === 1 && s.team === "McLaren");
    const seat2 = diff.seatOccupancy.find((s) => s.seat === 2 && s.team === "McLaren");
    expect(seat1).toMatchObject({ external: "Lando Norris", universe: "Lando Norris" });
    expect(seat2).toMatchObject({ external: "Oscar Piastri", universe: "Alicya Piastri" });
  });

  it("número divergente no espelho vira CONFLICT por 'number' no roster", async () => {
    await prisma.externalDriverSeason.update({
      where: { id: ids.extDsLandoId },
      data: { number: 99 },
    });
    try {
      const diff = await reconciliationService.buildRosterDiff(ids.seasonId);
      const row = new Map(diff.rows.map((r) => [r.external.externalId, r])).get("lando-norris")!;
      expect(row.status).toBe("CONFLICT");
      expect(row.differences).toContain("number");
    } finally {
      await prisma.externalDriverSeason.update({
        where: { id: ids.extDsLandoId },
        data: { number: 2 },
      });
    }
  });

  it("championship — Lando divergente (posição/pontos), Oscar sem standing, Alicya só no universo", async () => {
    const diff = await reconciliationService.buildChampionshipDiff(ids.seasonId);
    expect(diff.externalSeason!.year).toBe(2027);

    const byId = new Map(diff.rows.map((row) => [row.external.externalId, row]));
    const landoRow = byId.get("lando-norris")!;
    expect(landoRow.status).toBe("CONFLICT");
    expect(landoRow.differences).toEqual(
      expect.arrayContaining(["position", "points", "wins"]),
    );
    expect(landoRow.universe!.characterName).toBe("Lando Norris");
    expect(byId.get("oscar-piastri")).toMatchObject({
      status: "UNMATCHED",
      differences: ["identified-without-standing"],
      universe: null,
    });
    expect(diff.universeOnly.map((u) => u.characterName)).toContain("Alicya Piastri");
  });

  it("results — Lando coincide, Oscar sem resultado, Alicya só no universo", async () => {
    const diff = await reconciliationService.buildResultsDiff(ids.raceId);
    expect(diff.externalRace).toMatchObject({ seasonYear: 2027, round: 1 });

    const byId = new Map(diff.rows.map((row) => [row.external.externalId, row]));
    expect(byId.get("lando-norris")).toMatchObject({ status: "MATCHED", differences: [] });
    expect(byId.get("oscar-piastri")).toMatchObject({
      status: "UNMATCHED",
      differences: ["identified-without-result"],
      universe: null,
    });
    expect(diff.universeOnly.map((u) => u.characterName)).toContain("Alicya Piastri");
  });

  it("derivadas sem correspondência no universo → NO_CANDIDATES", async () => {
    const seasonDriverQuery = { source: JOLPICA_SOURCE, seasonYear: 2027, externalId: "oscar-piastri" };
    await expect(
      reconciliationService.confirmBinding(actor, "DRIVER_SEASON", seasonDriverQuery),
    ).rejects.toMatchObject({ code: "NO_CANDIDATES" });
    await expect(
      reconciliationService.confirmBinding(actor, "STANDING", seasonDriverQuery),
    ).rejects.toMatchObject({ code: "NO_CANDIDATES" });
    await expect(
      reconciliationService.confirmBinding(actor, "RESULT", resultQuery(2027, "oscar-piastri")),
    ).rejects.toMatchObject({ code: "NO_CANDIDATES" });
  });
});

describe("ReconciliationService — vínculos derivados exigem vínculos-mãe confirmados (2030)", () => {
  function derivedQuery(externalId: string) {
    return { source: JOLPICA_SOURCE, seasonYear: 2030, externalId };
  }

  it("STANDING sem piloto/temporada confirmados → PARENT_BINDING_REQUIRED", async () => {
    const fixture = await seedReconciliationFixture(2030);
    try {
      await expect(
        reconciliationService.confirmBinding(
          { id: fixture.ids.userId, role: "ADMIN" },
          "STANDING",
          derivedQuery("lando-norris"),
        ),
      ).rejects.toMatchObject({ code: "PARENT_BINDING_REQUIRED" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("DRIVER_SEASON sem piloto/temporada confirmados → PARENT_BINDING_REQUIRED", async () => {
    const fixture = await seedReconciliationFixture(2030);
    try {
      await expect(
        reconciliationService.confirmBinding(
          { id: fixture.ids.userId, role: "ADMIN" },
          "DRIVER_SEASON",
          derivedQuery("lando-norris"),
        ),
      ).rejects.toMatchObject({ code: "PARENT_BINDING_REQUIRED" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("RESULT sem corrida/piloto confirmados → PARENT_BINDING_REQUIRED", async () => {
    const fixture = await seedReconciliationFixture(2030);
    try {
      await expect(
        reconciliationService.confirmBinding(
          { id: fixture.ids.userId, role: "ADMIN" },
          "RESULT",
          resultQuery(2030, "lando-norris"),
        ),
      ).rejects.toMatchObject({ code: "PARENT_BINDING_REQUIRED" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("RACE sem temporada confirmada → NO_CANDIDATES", async () => {
    const fixture = await seedReconciliationFixture(2030);
    try {
      await expect(
        reconciliationService.confirmBinding(
          { id: fixture.ids.userId, role: "ADMIN" },
          "RACE",
          raceQuery(2030),
        ),
      ).rejects.toMatchObject({ code: "NO_CANDIDATES" });
    } finally {
      await fixture.cleanup();
    }
  });
});

describe("Reconciliation routes — endpoints (2028)", () => {
  let app: FastifyInstance;
  let ids: ReconFixtureIds;
  let adminCookie: string;
  let userCookie: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const fixture = await seedReconciliationFixture(2028);
    ids = fixture.ids;
    cleanup = fixture.cleanup;

    app = buildApp(undefined, undefined, makeDummyClient());
    await app.ready();

    const adminEmail = `recon-admin-${Date.now()}@f1nw.test`;
    adminCookie = await signUpGetCookie(app, adminEmail, "Recon Admin");
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });

    const userEmail = `recon-user-${Date.now()}@f1nw.test`;
    userCookie = await signUpGetCookie(app, userEmail, "Recon User");

    await prisma.character.updateMany({
      where: {
        id: {
          in: [
            ids.characterLandoId,
            ids.characterAlicyaId,
            ids.characterOscarId,
            ids.characterReserveXId,
          ],
        },
      },
      data: { userId: admin.id },
    });
  });

  afterAll(async () => {
    await app.close();
    await cleanup();
    await prisma.$disconnect();
  });

  it("sugerir vínculo sem sessão → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/reconciliation/bindings/suggest",
      payload: {
        kind: "DRIVER",
        source: JOLPICA_SOURCE,
        externalId: "lando-norris",
        candidateId: ids.characterLandoId,
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("sugerir vínculo como usuário comum → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/reconciliation/bindings/suggest",
      headers: { cookie: userCookie },
      payload: {
        kind: "DRIVER",
        source: JOLPICA_SOURCE,
        externalId: "lando-norris",
        candidateId: ids.characterLandoId,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("GET candidatos como usuário comum → 200 com somente leitura", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/reconciliation/candidates/DRIVER/lando-norris",
      headers: { cookie: userCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.listing.candidates)).toBe(true);
    expect(body.listing.external.label).toBe("Lando Norris");
  });

  it("admin sugere candidato inválido → 400 INVALID_CANDIDATE", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/reconciliation/bindings/suggest",
      headers: { cookie: adminCookie },
      payload: {
        kind: "DRIVER",
        source: JOLPICA_SOURCE,
        externalId: "lando-norris",
        candidateId: ids.characterAlicyaId,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("INVALID_CANDIDATE");
  });

  it("admin sugere candidato válido → 201 SUGGESTED", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/reconciliation/bindings/suggest",
      headers: { cookie: adminCookie },
      payload: {
        kind: "DRIVER",
        source: JOLPICA_SOURCE,
        externalId: "lando-norris",
        candidateId: ids.characterLandoId,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().binding.confidence).toBe("SUGGESTED");
  });

  it("admin confirma vínculo sugerido → 200 CONFIRMED (boundBy ADMIN)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/reconciliation/bindings/confirm",
      headers: { cookie: adminCookie },
      payload: {
        kind: "DRIVER",
        source: JOLPICA_SOURCE,
        externalId: "lando-norris",
      },
    });
    expect(res.statusCode).toBe(200);
    const binding = res.json().binding;
    expect(binding.confidence).toBe("CONFIRMED");
    expect(binding.boundBy).toBe("ADMIN");
  });

  it("listar vínculos inclui o vínculo confirmado", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/reconciliation/bindings",
      headers: { cookie: adminCookie },
      query: { source: JOLPICA_SOURCE },
    });
    expect(res.statusCode).toBe(200);
    const bindings = res.json().bindings;
    expect(bindings).toHaveLength(1);
    expect(bindings[0].confidence).toBe("CONFIRMED");
  });

  it("admin desvincula → 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/reconciliation/bindings",
      headers: { cookie: adminCookie },
      query: { source: JOLPICA_SOURCE },
    });
    const bindingId = res.json().bindings[0].id;

    const del = await app.inject({
      method: "DELETE",
      url: `/api/reconciliation/bindings/${bindingId}`,
      headers: { cookie: adminCookie },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toMatchObject({ ok: true });
  });

  it("GET roster sem sessão → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/reconciliation/seasons/${ids.seasonId}/roster`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET roster admin → 200 com diff (sem vínculo de temporada, linhas vazias)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/reconciliation/seasons/${ids.seasonId}/roster`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const diff = res.json().diff;
    expect(diff.seasonId).toBe(ids.seasonId);
    expect(diff.externalSeason).toBeNull();
    expect(diff.rows).toEqual([]);
  });
});

async function signUpGetCookie(
  app: FastifyInstance,
  email: string,
  name: string,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name, email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  return (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
}