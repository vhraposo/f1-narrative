import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";

const PREFIX = "champ-override";

let app: FastifyInstance;
let userA: { id: string; cookie: string };
let userB: { id: string; cookie: string };
let universeAId: string;
let universeBId: string;
let alicyaProfileId: string;
let secondProfileId: string;

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];

function remoteAddress(): string {
  return `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
}

async function signUp(label: string) {
  const email = `${PREFIX}-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@f1nw.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: `Override ${label}`, email, password: "senha-segura-123" },
    remoteAddress: remoteAddress(),
  });
  expect(res.statusCode).toBe(200);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  createdUserIds.push(user.id);
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  return { id: user.id, cookie };
}

async function createDriver(universeId: string, name: string) {
  const character = await prisma.character.create({
    data: {
      name,
      nationality: "BR",
      birthDate: new Date("1995-01-01"),
      controlledBy: "USER",
      universeId,
    },
  });
  createdCharacterIds.push(character.id);
  const profile = await prisma.driverProfile.create({
    data: { characterId: character.id },
  });
  return profile.id;
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();

  userA = await signUp("a");
  userB = await signUp("b");

  const universeA = await prisma.universe.upsert({
    where: { userId: userA.id },
    update: { status: "READY" },
    create: { userId: userA.id, status: "READY" },
  });
  const universeB = await prisma.universe.upsert({
    where: { userId: userB.id },
    update: { status: "READY" },
    create: { userId: userB.id, status: "READY" },
  });
  universeAId = universeA.id;
  universeBId = universeB.id;

  const worldDate = new Date("2026-09-30T00:00:00.000Z");
  await prisma.worldState.create({
    data: { universeId: universeAId, key: "default", currentDate: worldDate },
  });
  await prisma.worldState.create({
    data: { universeId: universeBId, key: "default", currentDate: worldDate },
  });

  alicyaProfileId = await createDriver(universeAId, `${PREFIX} Alicya Kucharski`);
  secondProfileId = await createDriver(universeAId, `${PREFIX} Segundo Piloto`);
  await createDriver(universeBId, `${PREFIX} Piloto B`);
});

afterAll(async () => {
  const universes = [universeAId, universeBId].filter(Boolean);
  await prisma.timelineEvent.deleteMany({ where: { universeId: { in: universes } } });
  await prisma.worldSnapshot.deleteMany({ where: { universeId: { in: universes } } });
  await prisma.historicalChampionOverride.deleteMany({
    where: { universeId: { in: universes } },
  });
  await prisma.driverProfile.deleteMany({
    where: { character: { universeId: { in: universes } } },
  });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.worldState.deleteMany({ where: { universeId: { in: universes } } });
  await prisma.universe.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await app.close();
  await prisma.$disconnect();
});

function auth(cookie: string) {
  return { cookie };
}

async function listChampions(cookie: string) {
  const res = await app.inject({
    method: "GET",
    url: "/api/timeline/champions",
    headers: auth(cookie),
    remoteAddress: remoteAddress(),
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { champions: Array<Record<string, unknown>> }).champions;
}

type Entry = {
  year: number;
  seasonId: string | null;
  state: string;
  origin: string;
  baseline: boolean;
  canEditOverride: boolean;
  canRestoreOverride: boolean;
  blockedReason: string | null;
  externalChampion: { name: string } | null;
  universeChampion: { name: string } | null;
};

describe("override histórico de campeão sem Season", () => {
  it("1) baseline 2024 mostra externo real e permissão de override", async () => {
    const champions = (await listChampions(userA.cookie)) as unknown as Entry[];
    const entry = champions.find((row) => row.year === 2024)!;
    expect(entry.seasonId).toBeNull();
    expect(entry.baseline).toBe(true);
    expect(entry.state).toBe("MATCH");
    expect(entry.externalChampion?.name).toBe("Max Verstappen");
    expect(entry.universeChampion).toBeNull();
    expect(entry.canEditOverride).toBe(true);
    expect(entry.canRestoreOverride).toBe(false);
  });

  it("2) preview é zero-write e mostra antes/depois", async () => {
    const preview = await app.inject({
      method: "POST",
      url: "/api/timeline/champions/historical/2024/preview",
      headers: auth(userA.cookie),
      payload: { mode: "EDIT", driverProfileId: alicyaProfileId },
      remoteAddress: remoteAddress(),
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json() as {
      preview: {
        previewToken: string;
        mode: string;
        before: { name: string } | null;
        after: { name: string } | null;
        externalChampion: { name: string } | null;
        commandCount: number;
      };
    };
    expect(body.preview.before).toBeNull();
    expect(body.preview.after?.name).toContain("Alicya Kucharski");
    expect(body.preview.externalChampion?.name).toBe("Max Verstappen");
    expect(body.preview.commandCount).toBe(1);

    const overrides = await prisma.historicalChampionOverride.count({
      where: { universeId: universeAId },
    });
    expect(overrides).toBe(0);
    const events = await prisma.timelineEvent.count({
      where: { universeId: universeAId, kind: "HISTORICAL_CHAMPION_OVERRIDE_SET" },
    });
    expect(events).toBe(0);
  });

  it("3) apply cria override divergente e restore volta ao baseline", async () => {
    const previewRes = await app.inject({
      method: "POST",
      url: "/api/timeline/champions/historical/2024/preview",
      headers: auth(userA.cookie),
      payload: { mode: "EDIT", driverProfileId: alicyaProfileId },
      remoteAddress: remoteAddress(),
    });
    const token = (previewRes.json() as { preview: { previewToken: string } }).preview
      .previewToken;

    const applied = await app.inject({
      method: "POST",
      url: "/api/timeline/champions/historical/2024/apply",
      headers: auth(userA.cookie),
      payload: { mode: "EDIT", driverProfileId: alicyaProfileId, previewToken: token },
      remoteAddress: remoteAddress(),
    });
    expect(applied.statusCode).toBe(200);
    const events = (applied.json() as { events: Array<{ kind: string }> }).events;
    expect(events[0]?.kind).toBe("HISTORICAL_CHAMPION_OVERRIDE_SET");

    let entry = ((await listChampions(userA.cookie)) as unknown as Entry[]).find(
      (row) => row.year === 2024,
    )!;
    expect(entry.state).toBe("DIVERGENT");
    expect(entry.origin).toBe("OVERRIDE");
    expect(entry.baseline).toBe(false);
    expect(entry.universeChampion?.name).toContain("Alicya Kucharski");
    expect(entry.externalChampion?.name).toBe("Max Verstappen");
    expect(entry.canRestoreOverride).toBe(true);
    expect(entry.blockedReason).toBeNull();

    const restorePreview = await app.inject({
      method: "POST",
      url: "/api/timeline/champions/historical/2024/preview",
      headers: auth(userA.cookie),
      payload: { mode: "RESTORE" },
      remoteAddress: remoteAddress(),
    });
    expect(restorePreview.statusCode).toBe(200);
    const restoreBody = restorePreview.json() as {
      preview: { after: unknown; before: { name: string } | null };
    };
    expect(restoreBody.preview.after).toBeNull();
    expect(restoreBody.preview.before?.name).toContain("Alicya Kucharski");

    const restored = await app.inject({
      method: "POST",
      url: "/api/timeline/champions/historical/2024/apply",
      headers: auth(userA.cookie),
      payload: {
        mode: "RESTORE",
        previewToken: (
          restorePreview.json() as { preview: { previewToken: string } }
        ).preview.previewToken,
      },
      remoteAddress: remoteAddress(),
    });
    expect(restored.statusCode).toBe(200);
    expect((restored.json() as { events: Array<{ kind: string }> }).events[0]?.kind).toBe(
      "HISTORICAL_CHAMPION_OVERRIDE_CLEARED",
    );

    entry = ((await listChampions(userA.cookie)) as unknown as Entry[]).find(
      (row) => row.year === 2024,
    )!;
    expect(entry.state).toBe("MATCH");
    expect(entry.baseline).toBe(true);
    expect(entry.universeChampion).toBeNull();
    const overrides = await prisma.historicalChampionOverride.count({
      where: { universeId: universeAId },
    });
    expect(overrides).toBe(0);
  });

  it("4) supersession mantém histórico e projeção única", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/timeline/champions/historical/2023/preview",
      headers: auth(userA.cookie),
      payload: { mode: "EDIT", driverProfileId: alicyaProfileId },
      remoteAddress: remoteAddress(),
    });
    const firstToken = (first.json() as { preview: { previewToken: string } }).preview
      .previewToken;
    await app.inject({
      method: "POST",
      url: "/api/timeline/champions/historical/2023/apply",
      headers: auth(userA.cookie),
      payload: { mode: "EDIT", driverProfileId: alicyaProfileId, previewToken: firstToken },
      remoteAddress: remoteAddress(),
    });

    const second = await app.inject({
      method: "POST",
      url: "/api/timeline/champions/historical/2023/preview",
      headers: auth(userA.cookie),
      payload: { mode: "EDIT", driverProfileId: secondProfileId },
      remoteAddress: remoteAddress(),
    });
    const secondToken = (second.json() as { preview: { previewToken: string } }).preview
      .previewToken;
    const applied = await app.inject({
      method: "POST",
      url: "/api/timeline/champions/historical/2023/apply",
      headers: auth(userA.cookie),
      payload: { mode: "EDIT", driverProfileId: secondProfileId, previewToken: secondToken },
      remoteAddress: remoteAddress(),
    });
    expect(applied.statusCode).toBe(200);

    const projection = await prisma.historicalChampionOverride.findMany({
      where: { universeId: universeAId, year: 2023 },
    });
    expect(projection).toHaveLength(1);
    expect(projection[0]?.driverProfileId).toBe(secondProfileId);

    const events = await prisma.timelineEvent.findMany({
      where: {
        universeId: universeAId,
        kind: "HISTORICAL_CHAMPION_OVERRIDE_SET",
        payload: { path: ["year"], equals: 2023 },
      },
      orderBy: { sequence: "asc" },
    });
    expect(events).toHaveLength(2);
    expect(events[0]?.supersedesId).toBeNull();
    expect(events[1]?.supersedesId).toBe(events[0]?.id);

    const entry = ((await listChampions(userA.cookie)) as unknown as Entry[]).find(
      (row) => row.year === 2023,
    )!;
    expect(entry.universeChampion?.name).toContain("Segundo Piloto");
  });

  it("5) token stale é rejeitado e restore sem override explica", async () => {
    const preview = await app.inject({
      method: "POST",
      url: "/api/timeline/champions/historical/2022/preview",
      headers: auth(userA.cookie),
      payload: { mode: "EDIT", driverProfileId: alicyaProfileId },
      remoteAddress: remoteAddress(),
    });
    const token = (preview.json() as { preview: { previewToken: string } }).preview
      .previewToken;
    const first = await app.inject({
      method: "POST",
      url: "/api/timeline/champions/historical/2022/apply",
      headers: auth(userA.cookie),
      payload: { mode: "EDIT", driverProfileId: alicyaProfileId, previewToken: token },
      remoteAddress: remoteAddress(),
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: "POST",
      url: "/api/timeline/champions/historical/2022/apply",
      headers: auth(userA.cookie),
      payload: { mode: "EDIT", driverProfileId: alicyaProfileId, previewToken: token },
      remoteAddress: remoteAddress(),
    });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { code: string }).code).toBe("PREVIEW_STALE");

    const restore = await app.inject({
      method: "POST",
      url: "/api/timeline/champions/historical/2001/preview",
      headers: auth(userA.cookie),
      payload: { mode: "RESTORE" },
      remoteAddress: remoteAddress(),
    });
    expect(restore.statusCode).toBe(409);
    expect((restore.json() as { code: string }).code).toBe("NOTHING_TO_RESTORE");

    const invalidYear = await app.inject({
      method: "POST",
      url: "/api/timeline/champions/historical/1999/preview",
      headers: auth(userA.cookie),
      payload: { mode: "EDIT", driverProfileId: alicyaProfileId },
      remoteAddress: remoteAddress(),
    });
    expect(invalidYear.statusCode).toBe(400);
    expect((invalidYear.json() as { code: string }).code).toBe("INVALID_YEAR");
  });

  it("6) isolamento entre universos e espelho externo intacto", async () => {
    const championsB = (await listChampions(userB.cookie)) as unknown as Entry[];
    const entryB = championsB.find((row) => row.year === 2024)!;
    expect(entryB.baseline).toBe(true);
    expect(entryB.universeChampion).toBeNull();
    expect(entryB.canRestoreOverride).toBe(false);

    const overridesB = await prisma.historicalChampionOverride.count({
      where: { universeId: universeBId },
    });
    expect(overridesB).toBe(0);

    const externalForFixtureYears = await prisma.externalStanding.count({
      where: {
        seasonYear: { in: [2022, 2023, 2024] },
        externalDriver: { name: { startsWith: PREFIX } },
      },
    });
    expect(externalForFixtureYears).toBe(0);
  });
});
