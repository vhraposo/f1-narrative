import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { createHash } from "node:crypto";

const PREFIX = "bio-life";
const TEST_STARTED_AT = new Date();

let app: FastifyInstance;
let cookie: string;
let userId: string;
let universeId: string;
let seasonId: string;
let characterIds: string[] = [];
let pilotNumber = 30;

function remoteAddress(): string {
  return `10.12.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
}

const providerCalls = { total: 0 };

function stubGenerationProvider(): {
  name: string;
  run: (input: { systemPrompt: string; userPrompt?: string }) => Promise<{
    provider: string;
    mode: "generated";
    text: string;
    tokenStats: { systemPromptChars: number; contextBlocks: number };
  }>;
} {
  return {
    name: "stub-llm",
    async run(input) {
      providerCalls.total += 1;
      const ids = [...(input.userPrompt ?? "").matchAll(/(CLAIM-\d{3})/g)].map((match) => match[1]);
      const displays = [...(input.userPrompt ?? "").matchAll(/\[[A-Z_]+\]\s(.+)$/gm)].map(
        (match) => match[1]!.replace(/[.;]+$/u, ""),
      );
      const pick = (index: number) =>
        (displays[index % Math.max(displays.length, 1)] ?? "Piloto prompt").replace(/[.;]+$/u, "");
      const sentenceTexts = [
        pick(0),
        pick(1),
        `${pick(0)} ${pick(1)}`,
        `${pick(1)} ${pick(0)}`,
      ];
      const sentenceFrom = (index: number) => ({
        text: `${sentenceTexts[index]!.slice(0, 190)}.`,
        claimIds: [ids[index] ?? ids[0] ?? "CLAIM-001"],
      });
      const text = JSON.stringify({
        language: "pt-BR",
        paragraphs: [
          { sentences: [sentenceFrom(0), sentenceFrom(1)] },
          { sentences: [sentenceFrom(2), sentenceFrom(3)] },
        ],
      });
      return {
        provider: "stub-llm",
        mode: "generated" as const,
        text,
        tokenStats: { systemPromptChars: input.systemPrompt.length, contextBlocks: 1 },
      };
    },
  };
}

async function createPilot(label: string) {
  pilotNumber += 1;
  const driver = await prisma.externalDriver.create({
    data: {
      source: "f1db",
      externalId: `${PREFIX}-${label}`,
      name: `Piloto ${label}`,
      nationality: "NED",
      number: pilotNumber,
      contentHash: `hash-${label}`,
    },
  });
  const character = await prisma.character.create({
    data: {
      universeId,
      controlledBy: "AI",
      name: `PK ${label}`,
      nationality: "NED",
      birthDate: new Date("1997-09-30T00:00:00.000Z"),
      driverProfile: { create: { number: pilotNumber } },
    },
  });
  characterIds.push(character.id);
  await prisma.externalBindingDriver.create({
    data: { universeId, externalDriverId: driver.id, characterId: character.id },
  });
  await prisma.seasonDriverEntry.create({
    data: {
      seasonId,
      driverProfileId: (
        await prisma.driverProfile.findUniqueOrThrow({ where: { characterId: character.id } })
      ).id,
      number: pilotNumber,
    },
  });
  return character;
}

async function waitTerminal(runId: string): Promise<string> {
  let status = "PENDING";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const run = await prisma.biographyGenerationRun.findUniqueOrThrow({
      where: { id: runId },
      select: { status: true },
    });
    status = run.status;
    if (["SUCCEEDED", "SUCCEEDED_FALLBACK", "FAILED"].includes(status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return status;
}

beforeAll(async () => {
  app = buildApp(undefined, stubGenerationProvider() as never);
  await app.ready();
  const email = `${PREFIX}-${Date.now()}@f1nw.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: "Bio Life", email, password: "senha-segura-123" },
    remoteAddress: remoteAddress(),
  });
  expect(res.statusCode).toBe(200);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  userId = user.id;
  cookie = (res.cookies ?? []).map((entry) => `${entry.name}=${entry.value}`).join("; ");
  const universe = await prisma.universe.upsert({
    where: { userId },
    update: { status: "READY" },
    create: { userId, status: "READY" },
  });
  universeId = universe.id;
  const season = await prisma.season.create({
    data: { universeId, year: 2030, status: "ACTIVE" },
  });
  seasonId = season.id;
  await prisma.worldState.create({
    data: {
      universeId,
      key: "default",
      currentDate: new Date("2030-03-01T00:00:00.000Z"),
      currentSeasonId: seasonId,
    },
  });
});

afterAll(async () => {
  await prisma.biographyGenerationRun.deleteMany({ where: { characterId: { in: characterIds } } });
  await prisma.seasonDriverEntry.deleteMany({ where: { seasonId } });
  await prisma.pilotExperience.deleteMany({ where: { characterId: { in: characterIds } } });
  await prisma.memory.deleteMany({ where: { participants: { some: { characterId: { in: characterIds } } } } });
  await prisma.externalDriverEvent.deleteMany({
    where: { externalDriver: { bindings: { some: { characterId: { in: characterIds } } } } },
  });
  await prisma.externalDriverProfile.deleteMany({
    where: { externalDriver: { bindings: { some: { characterId: { in: characterIds } } } } },
  });
  await prisma.externalBindingDriver.deleteMany({ where: { characterId: { in: characterIds } } });
  await prisma.character.deleteMany({ where: { id: { in: characterIds } } });
  await prisma.externalDriver.deleteMany({ where: { externalId: { startsWith: PREFIX } } });
  await prisma.season.deleteMany({ where: { id: seasonId } });
  await prisma.worldState.deleteMany({ where: { universeId } });
  await prisma.externalKnowledgeSource.deleteMany({
    where: {
      createdAt: { gte: TEST_STARTED_AT },
      driverProfiles: { none: {} },
    },
  });
  await prisma.universe.deleteMany({ where: { id: universeId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await app.close();
  await prisma.$disconnect();
});

describe("biography lifecycle e backfill", () => {
  it("1) geração com LLM persiste prompt final, hash, provider/model e fingerprint", async () => {
    const character = await createPilot("prompt");
    const response = await app.inject({
      method: "POST",
      url: `/api/pilot-knowledge/drivers/${character.id}/biography/generation`,
      headers: { cookie },
      remoteAddress: remoteAddress(),
    });
    expect(response.statusCode).toBe(202);
    const runId = (response.json() as { generation: { runId: string } }).generation.runId;
    const status = await waitTerminal(runId);
    expect(status).toBe("SUCCEEDED");

    const run = await prisma.biographyGenerationRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.provider).toBe("stub-llm");
    expect(run.model).toBe("stub-llm");
    expect(run.mode).toBe("LLM");
    expect(run.prompt).not.toBeNull();
    const prompt = run.prompt as { systemPrompt?: string; userPrompt?: string };
    expect(prompt.systemPrompt).toContain("editor biográfico");
    expect(prompt.userPrompt).toContain("CLAIM-001");
    expect(run.promptHash).toBe(
      createHash("sha256")
        .update(JSON.stringify({ systemPrompt: prompt.systemPrompt, userPrompt: prompt.userPrompt }))
        .digest("hex"),
    );
    expect(run.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(run.evidenceVersion).not.toBeNull();
    expect(run.outputSourceId).not.toBeNull();
    expect(run.timings).not.toBeNull();
  });

  it("2) READY é leitura pura: GET não chama provider nem cria run", async () => {
    const character = await createPilot("ready");
    const created = await app.inject({
      method: "POST",
      url: `/api/pilot-knowledge/drivers/${character.id}/biography/generation`,
      headers: { cookie },
      remoteAddress: remoteAddress(),
    });
    await waitTerminal((created.json() as { generation: { runId: string } }).generation.runId);

    const runsBefore = await prisma.biographyGenerationRun.count({
      where: { characterId: character.id },
    });
    const callsBefore = providerCalls.total;
    const started = Date.now();
    const read = await app.inject({
      method: "GET",
      url: `/api/pilot-knowledge/drivers/${character.id}`,
      headers: { cookie },
      remoteAddress: remoteAddress(),
    });
    const elapsed = Date.now() - started;
    expect(read.statusCode).toBe(200);
    const body = read.json() as {
      biographyStatus: { status: string; display: string | null };
    };
    expect(["READY", "READY_FALLBACK"]).toContain(body.biographyStatus.status);
    expect(body.biographyStatus.display).not.toBeNull();
    expect(providerCalls.total).toBe(callsBefore);
    expect(
      await prisma.biographyGenerationRun.count({ where: { characterId: character.id } }),
    ).toBe(runsBefore);
    expect(elapsed).toBeLessThan(2000);
  });

  it("3) STALE devolve texto antigo e revalida em background", async () => {
    const character = await createPilot("stale");
    const created = await app.inject({
      method: "POST",
      url: `/api/pilot-knowledge/drivers/${character.id}/biography/generation`,
      headers: { cookie },
      remoteAddress: remoteAddress(),
    });
    await waitTerminal((created.json() as { generation: { runId: string } }).generation.runId);

    const profile = await prisma.externalDriverProfile.findFirstOrThrow({
      where: { externalDriver: { bindings: { some: { characterId: character.id } } } },
      select: { id: true },
    });
    const legacySource = await prisma.externalKnowledgeSource.create({
      data: {
        provider: "CURATED",
        sourceKind: "BIOGRAPHY_PAGE",
        url: null,
        title: "Bio antiga v2",
        license: "UNKNOWN",
        metadata: {
          generator: "biography-composer",
          generatorVersion: "biography-composer.v2",
        },
      },
    });
    await prisma.externalDriverProfile.update({
      where: { id: profile.id },
      data: { biographySourceId: legacySource.id },
    });

    const read = await app.inject({
      method: "GET",
      url: `/api/pilot-knowledge/drivers/${character.id}`,
      headers: { cookie },
      remoteAddress: remoteAddress(),
    });
    const body = read.json() as {
      biographyStatus: { status: string; display: string | null };
    };
    expect(body.biographyStatus.status).toBe("STALE");
    expect(body.biographyStatus.display).not.toBeNull();
  });

  it("4) dois pedidos simultâneos reutilizam o mesmo run (single-flight)", async () => {
    const character = await createPilot("single");
    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/pilot-knowledge/drivers/${character.id}/biography/generation`,
        headers: { cookie },
        remoteAddress: remoteAddress(),
      }),
      app.inject({
        method: "POST",
        url: `/api/pilot-knowledge/drivers/${character.id}/biography/generation`,
        headers: { cookie },
        remoteAddress: remoteAddress(),
      }),
    ]);
    const firstBody = first.json() as { generation: { runId: string; reused: boolean } };
    const secondBody = second.json() as { generation: { runId: string; reused: boolean } };
    expect(firstBody.generation.runId).toBe(secondBody.generation.runId);
    expect([firstBody.generation.reused, secondBody.generation.reused].sort()).toEqual([false, true]);
    await waitTerminal(firstBody.generation.runId);
    expect(
      await prisma.biographyGenerationRun.count({ where: { characterId: character.id } }),
    ).toBe(1);
  });

  it("5) backfill cobre o grid atual descoberto e protege o Universe", async () => {
    const before = {
      standings: await prisma.championshipStanding.count(),
      timeline: await prisma.timelineEvent.count(),
      results: await prisma.raceResult.count(),
    };
    const response = await app.inject({
      method: "POST",
      url: "/api/pilot-knowledge/biography/backfill",
      headers: { cookie },
      remoteAddress: remoteAddress(),
    });
    expect(response.statusCode).toBe(403);

    const adminUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await prisma.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
    void adminUser;
    const backfill = await app.inject({
      method: "POST",
      url: "/api/pilot-knowledge/biography/backfill",
      headers: { cookie },
      remoteAddress: remoteAddress(),
    });
    expect(backfill.statusCode).toBe(200);
    const summary = (backfill.json() as {
      backfill: { targets: number; succeeded: number; fallback: number; failed: number; skipped: number };
    }).backfill;
    expect(summary.targets).toBeGreaterThanOrEqual(4);
    expect(summary.failed).toBe(0);
    expect(summary.succeeded + summary.fallback + summary.skipped).toBeGreaterThanOrEqual(4);

    const profiles = await prisma.externalDriverProfile.findMany({
      where: { externalDriver: { bindings: { some: { characterId: { in: characterIds } } } } },
      select: { biographyDisplay: true },
    });
    expect(profiles.length).toBeGreaterThanOrEqual(4);
    expect(profiles.every((profile) => (profile.biographyDisplay ?? "").length > 0)).toBe(true);

    expect(await prisma.championshipStanding.count()).toBe(before.standings);
    expect(await prisma.timelineEvent.count()).toBe(before.timeline);
    expect(await prisma.raceResult.count()).toBe(before.results);
    await prisma.user.update({ where: { id: userId }, data: { role: "USER" } });
  });

  it("6) sanitização remove chaves de API do prompt persistido", async () => {
    const { sanitizePromptPayload } = await import("./biography.generation.js");
    const sanitized = sanitizePromptPayload({
      systemPrompt: "prompt com Bearer abcdef.12345 e api_key='minha-chave-secreta'",
      userPrompt: "OPENAI_API_KEY=sk-1234567890abcdef",
    }) as {
      systemPrompt: string;
      userPrompt: string;
    };
    expect(sanitized.systemPrompt).not.toContain("minha-chave-secreta");
    expect(sanitized.systemPrompt).toContain("[REDACTED]");
    expect(sanitized.userPrompt).not.toContain("sk-1234567890abcdef");
  });
});
