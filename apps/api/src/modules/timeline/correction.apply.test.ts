import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { applyCorrection } from "./correction.apply.js";
import { previewCorrection } from "./correction.preview.js";
import {
  submitCorrection,
  type RaceResultCorrectionCommand,
} from "./correction.service.js";
import { seedCorrectionFixture, type CorrectionFixture } from "./correction.fixtures.js";

let app: FastifyInstance;
let fixture: CorrectionFixture;
let apiUser: { id: string; cookie: string };

const RACE_COMMAND = (f: CorrectionFixture): RaceResultCorrectionCommand => ({
  kind: "RACE_RESULT_CORRECTED",
  worldDate: f.worldDate,
  raceId: f.raceId,
  driverProfileId: f.driver2Id,
  position: 4,
});

beforeAll(async () => {
  app = buildApp();
  await app.ready();

  fixture = await seedCorrectionFixture("apply", 2092);

  const email = `corr-apply-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@f1nw.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: "Corr Apply", email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  apiUser = { id: user.id, cookie };
});

afterAll(async () => {
  await fixture.cleanup();
  await prisma.user.delete({ where: { id: apiUser.id } });
  await prisma.$disconnect();
  await app.close();
});

describe("correction apply", () => {
  it("1) aplica com token válido e recomputa derivados", async () => {
    const preview = await previewCorrection(fixture.universeId, RACE_COMMAND(fixture));
    const event = await applyCorrection(
      fixture.universeId,
      RACE_COMMAND(fixture),
      preview.previewToken,
    );
    expect(event.kind).toBe("RACE_RESULT_CORRECTED");

    const result = await prisma.raceResult.findFirstOrThrow({
      where: { raceId: fixture.raceId, driverProfileId: fixture.driver2Id },
    });
    expect(result.position).toBe(4);

    const standings = await prisma.championshipStanding.findMany({
      where: { seasonId: fixture.seasonId },
      orderBy: { position: "asc" },
    });
    expect(standings[0]!.driverProfileId).toBe(fixture.driver1Id);
  });

  it("2) token obsoleto → 409 PREVIEW_STALE sem escrever", async () => {
    const preview = await previewCorrection(fixture.universeId, RACE_COMMAND(fixture));
    const eventsBefore = await prisma.timelineEvent.count({
      where: { universeId: fixture.universeId },
    });
    await submitCorrection(fixture.universeId, {
      kind: "NUMBER_CORRECTED",
      worldDate: fixture.worldDate,
      seasonId: fixture.seasonId,
      driverProfileId: fixture.driver1Id,
      number: 44,
    });
    await expect(
      applyCorrection(fixture.universeId, RACE_COMMAND(fixture), preview.previewToken),
    ).rejects.toMatchObject({ code: "PREVIEW_STALE", statusCode: 409 });
    expect(
      await prisma.timelineEvent.count({ where: { universeId: fixture.universeId } }),
    ).toBe(eventsBefore + 1);
  });

  it("3) reaplicar o mesmo token → 409", async () => {
    const preview = await previewCorrection(fixture.universeId, RACE_COMMAND(fixture));
    await applyCorrection(fixture.universeId, RACE_COMMAND(fixture), preview.previewToken);
    await expect(
      applyCorrection(fixture.universeId, RACE_COMMAND(fixture), preview.previewToken),
    ).rejects.toMatchObject({ code: "PREVIEW_STALE", statusCode: 409 });
  });

  it("4) applies concorrentes com o mesmo token: exatamente um vence", async () => {
    const preview = await previewCorrection(fixture.universeId, {
      ...RACE_COMMAND(fixture),
      position: 5,
    });
    const results = await Promise.allSettled([
      applyCorrection(fixture.universeId, { ...RACE_COMMAND(fixture), position: 5 }, preview.previewToken),
      applyCorrection(fixture.universeId, { ...RACE_COMMAND(fixture), position: 5 }, preview.previewToken),
    ]);
    const fulfilled = results.filter((item) => item.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    const events = await prisma.timelineEvent.findMany({
      where: {
        universeId: fixture.universeId,
        kind: "RACE_RESULT_CORRECTED",
        payload: { path: ["position"], equals: 5 },
      },
    });
    expect(events).toHaveLength(1);
  });

  it("5) falha de validação no apply não deixa estado parcial", async () => {
    const statusCommand: RaceResultCorrectionCommand = {
      ...RACE_COMMAND(fixture),
      status: "DSQ",
    };
    const preview = await previewCorrection(fixture.universeId, statusCommand);
    await prisma.raceResult.deleteMany({
      where: { raceId: fixture.raceId, driverProfileId: fixture.driver2Id },
    });
    const eventsBefore = await prisma.timelineEvent.count({
      where: { universeId: fixture.universeId },
    });
    await expect(
      applyCorrection(fixture.universeId, statusCommand, preview.previewToken),
    ).rejects.toMatchObject({ code: "RESULT_NOT_FOUND", statusCode: 404 });
    expect(
      await prisma.timelineEvent.count({ where: { universeId: fixture.universeId } }),
    ).toBe(eventsBefore);
  });
});

describe("correction routes", () => {
  it("6) 401 sem sessão", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/timeline/corrections/preview",
      payload: { kind: "RACE_RESULT_CORRECTED" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("7) preview + apply via HTTP com DERIVED_FIELD e stale", async () => {
    const routeFixture = await seedCorrectionFixture("apply-routes", 2093, {
      userId: apiUser.id,
      universeId: (
        await prisma.universe.upsert({
          where: { userId: apiUser.id },
          update: {},
          create: { userId: apiUser.id, status: "READY" },
        })
      ).id,
    });
    try {
      const command = {
        kind: "RACE_RESULT_CORRECTED",
        worldDate: routeFixture.worldDate.toISOString(),
        raceId: routeFixture.raceId,
        driverProfileId: routeFixture.driver2Id,
        position: 4,
      };

      const derived = await app.inject({
        method: "POST",
        url: "/api/timeline/corrections/preview",
        headers: { cookie: apiUser.cookie },
        payload: { ...command, points: 25 },
      });
      expect(derived.statusCode).toBe(400);
      expect(derived.json().code).toBe("DERIVED_FIELD");

      const invalid = await app.inject({
        method: "POST",
        url: "/api/timeline/corrections/preview",
        headers: { cookie: apiUser.cookie },
        payload: { ...command, driverProfileId: "não-uuid" },
      });
      expect(invalid.statusCode).toBe(400);

      const preview = await app.inject({
        method: "POST",
        url: "/api/timeline/corrections/preview",
        headers: { cookie: apiUser.cookie },
        payload: command,
      });
      expect(preview.statusCode).toBe(200);
      const previewToken = preview.json().preview.previewToken as string;
      expect(previewToken).toMatch(/^sha256:/);

      const apply = await app.inject({
        method: "POST",
        url: "/api/timeline/corrections/apply",
        headers: { cookie: apiUser.cookie },
        payload: { command, previewToken },
      });
      expect(apply.statusCode).toBe(200);
      expect(apply.json().event.kind).toBe("RACE_RESULT_CORRECTED");

      const stale = await app.inject({
        method: "POST",
        url: "/api/timeline/corrections/apply",
        headers: { cookie: apiUser.cookie },
        payload: { command, previewToken },
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().code).toBe("PREVIEW_STALE");
    } finally {
      await routeFixture.cleanup();
    }
  });
});
