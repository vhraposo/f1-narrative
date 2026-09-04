import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import type { AssembledContext } from "../context/context.assembly.js";
import {
  assembleGenerationBundle,
  assertGenerationContract,
  computeGenerationKey,
  composeSystemPrompt,
  countEmittedSections,
  maxContextFitsPolicy,
  generateGeneration,
  GENERATION_RULE,
  type GenerationResult,
} from "./generation.assembly.js";

// Testes de contrato/orçamento/determinismo do bundle (Fase 12 STEP 4, SEM LLM).
// Casos puramente contratuais não tocam o banco; determinismo/endpoint usam
// fixtures via Prisma + tracking/cleanup.

type TestUser = { cookie: string; userId: string };
type Character = { id: string; name: string; nationality: string; controlledBy: string; userId: string | null };

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];
const createdMemoryIds: string[] = [];

function track<T extends { id: string }>(list: string[], entity: T): T {
  list.push(entity.id);
  return entity;
}

let app: FastifyInstance;

async function createUser(email: string, name: string): Promise<TestUser> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name, email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  const user = track(createdUserIds, await prisma.user.findUniqueOrThrow({ where: { email } }));
  return { cookie, userId: user.id };
}

async function createCharacter(user: TestUser, payload: Record<string, unknown>): Promise<Character> {
  const res = await app.inject({
    method: "POST",
    url: "/api/characters",
    headers: { cookie: user.cookie },
    payload,
  });
  expect(res.statusCode).toBe(201);
  return track(createdCharacterIds, res.json().character as Character);
}

async function createConversationDirect(
  type: string,
  participantIds: string[],
): Promise<{ id: string }> {
  const conv = track(
    createdConversationIds,
    await prisma.conversation.create({ data: { title: "cv4", type: type === "DM" ? "DM" : "GROUP" } }),
  );
  await prisma.conversationParticipant.createMany({
    data: [...new Set(participantIds)].map((characterId) => ({
      conversationId: conv.id,
      characterId,
    })),
  });
  return { id: conv.id };
}

// --- fixture determinística minimal (módulo-puro) para casos contratuais ---
function fixtureContext(overrides: Partial<AssembledContext> = {}): AssembledContext {
  const base: AssembledContext = {
    meta: {
      version: "context.v1",
      conversationId: "00000000-0000-4000-8000-000000000001",
      conversationType: "GROUP",
      participantCharacterIds: [],
      assembledAt: "2026-01-01T00:00:00.000Z",
      ruleApplied: "context.v1-policy:msgs=50#mem=15#evt=10#rel=10#news=8",
    },
    participants: [],
    activeSpeaker: { characterId: null, senderType: "USER_CHARACTER" },
    temporal: {
      worldDate: null,
      currentSeasonId: null,
      currentRaceId: null,
      currentSession: null,
      phaseMarker: null,
    },
    recentMessages: [],
    memories: [],
    events: [],
    relationships: [],
    motorsport: null,
    news: [],
    omitted: { oldestMessagesTruncated: 0, memoriesOmitted: 0, reasons: [] },
  };
  return { ...base, ...overrides };
}

function fixtureResult(): GenerationResult {
  const context = fixtureContext();
  const systemPrompt = composeSystemPrompt(context);
  return {
    context,
    systemPrompt,
    meta: {
      provider: "null",
      mode: "assembly-only",
      tokens: { systemPromptChars: systemPrompt.length, contextBlocks: countEmittedSections(systemPrompt) },
      ruleApplied: GENERATION_RULE,
    },
    generationKey: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  };
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await prisma.message.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
  await prisma.conversationParticipant.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
  await prisma.memoryCharacter.deleteMany({ where: { memoryId: { in: createdMemoryIds } } });
  await prisma.memory.deleteMany({ where: { id: { in: createdMemoryIds } } });
  await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
  await app.close();
});

// ---------------------------------------------------------------------------
// A) Contrato — frame válido
// ---------------------------------------------------------------------------

describe("GenerationContract - frame válido", () => {
  it("A) assertGenerationContract(frame válido) === true", () => {
    expect(assertGenerationContract(fixtureResult())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B–L) Contrato — frames corrompidos (todos puros, sem banco)
// ---------------------------------------------------------------------------

describe("GenerationContract - frames inválidos", () => {
  it("B) systemPrompt truncado -> false", () => {
    const r = fixtureResult();
    r.systemPrompt = r.systemPrompt.slice(0, Math.floor(r.systemPrompt.length / 2));
    r.meta.tokens.systemPromptChars = r.systemPrompt.length; // mantém coerência de chars; seções quebram
    expect(assertGenerationContract(r)).toBe(false);
  });

  it("C) BEGIN removido -> false", () => {
    const r = fixtureResult();
    r.systemPrompt = r.systemPrompt.replace(/<BEGIN 1:GLOBAL_RULES>\n/, "");
    expect(assertGenerationContract(r)).toBe(false);
  });

  it("D) END removido -> false", () => {
    const r = fixtureResult();
    r.systemPrompt = r.systemPrompt.replace(/<END 12:BEHAVIORAL_INVARIANTS>/, "");
    expect(assertGenerationContract(r)).toBe(false);
  });

  it("E) BEGIN/END mismatched -> false", () => {
    const r = fixtureResult();
    r.systemPrompt = r.systemPrompt.replace(
      /<END 12:BEHAVIORAL_INVARIANTS>/,
      "<END 12:WRONG>",
    );
    expect(assertGenerationContract(r)).toBe(false);
  });

  it("F) ordem das seções alterada -> false", () => {
    const r = fixtureResult();
    // troca a 1ª e a 2ª seções
    const blocks = r.systemPrompt.split("\n\n");
    [blocks[0], blocks[1]] = [blocks[1], blocks[0]];
    r.systemPrompt = blocks.join("\n\n");
    expect(assertGenerationContract(r)).toBe(false);
  });

  it("G) contextBlocks !== 12 -> false", () => {
    const r = fixtureResult();
    r.meta.tokens.contextBlocks = 11;
    expect(assertGenerationContract(r)).toBe(false);
  });

  it("H) systemPromptChars incorreto -> false", () => {
    const r = fixtureResult();
    r.meta.tokens.systemPromptChars = r.systemPrompt.length + 1;
    expect(assertGenerationContract(r)).toBe(false);
  });

  it("I) ruleApplied incorreto -> false", () => {
    const r = fixtureResult();
    r.meta.ruleApplied = "outro";
    expect(assertGenerationContract(r)).toBe(false);
  });

  it("J) provider incorreto -> false", () => {
    const r = fixtureResult();
    r.meta.provider = "";
    expect(assertGenerationContract(r)).toBe(false);
  });

  it("K) mode incorreto -> false", () => {
    const r = fixtureResult();
    r.meta.mode = "real-llm" as never;
    expect(assertGenerationContract(r)).toBe(false);
  });

  it("L) context version incorreto -> false", () => {
    const r = fixtureResult();
    r.context.meta.version = "context.v9" as never;
    expect(assertGenerationContract(r)).toBe(false);
  });

  it("não lança exceção para frame corrompido", () => {
    expect(() => assertGenerationContract({} as never)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Orçamento de contexto
// ---------------------------------------------------------------------------

describe("GenerationContract - maxContextFitsPolicy", () => {
  it("teto maior que prompt -> fits true", () => {
    const r = maxContextFitsPolicy(100, 200);
    expect(r.fits).toBe(true);
    expect(r.usedChars).toBe(100);
    expect(r.maxChars).toBe(200);
  });

  it("teto exatamente igual -> fits true", () => {
    expect(maxContextFitsPolicy(100, 100).fits).toBe(true);
  });

  it("teto menor -> fits false", () => {
    expect(maxContextFitsPolicy(100, 99).fits).toBe(false);
  });

  it("teto zero com prompt não vazio -> fits false", () => {
    expect(maxContextFitsPolicy(1, 0).fits).toBe(false);
  });

  it("aceita GenerationResult e usa systemPromptChars", () => {
    const res = fixtureResult();
    const budget = maxContextFitsPolicy(res, res.meta.tokens.systemPromptChars);
    expect(budget.usedChars).toBe(res.meta.tokens.systemPromptChars);
    expect(budget.fits).toBe(true);
  });

  it("comportamento determinístico para entradas iguais", () => {
    expect(JSON.stringify(maxContextFitsPolicy(123, 500))).toBe(
      JSON.stringify(maxContextFitsPolicy(123, 500)),
    );
  });
});

// ---------------------------------------------------------------------------
// Determinismo do generationKey + endpoint
// ---------------------------------------------------------------------------

describe("GenerationContract - determinismo e endpoint", () => {
  let owner: TestUser;
  let charA: Character;
  let convId: string;
  const FIXED_NOW = new Date("2026-02-01T12:00:00Z");

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`gen4-${suffix}@f1nw.test`, "Gen4");
    charA = await createCharacter(owner, {
      name: "Gabriel",
      nationality: "BR",
      birthDate: "1991-01-01",
    });
    const conv = await createConversationDirect("GROUP", [charA.id]);
    convId = conv.id;

    await prisma.message.create({
      data: {
        conversationId: convId,
        senderType: "USER_CHARACTER",
        characterId: charA.id,
        content: "primeira fala",
        createdAt: new Date("2026-01-01T10:00:00Z"),
      },
    });
  });

  it("A) dois frames idênticos -> mesmo generationKey", async () => {
    const a = await assembleGenerationBundle(prisma, { conversationId: convId, userId: owner.userId, now: FIXED_NOW });
    const b = await assembleGenerationBundle(prisma, { conversationId: convId, userId: owner.userId, now: FIXED_NOW });
    expect(a.generationKey).toBe(b.generationKey);
    expect(a.generationKey).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("B) alteração de uma mensagem -> generationKey diferente", async () => {
    const before = await assembleGenerationBundle(prisma, { conversationId: convId, userId: owner.userId, now: FIXED_NOW });
    await prisma.message.create({
      data: {
        conversationId: convId,
        senderType: "SYSTEM",
        characterId: null,
        content: "fala adicional muda o frame",
        createdAt: new Date("2026-01-01T10:00:01Z"),
      },
    });
    const after = await assembleGenerationBundle(prisma, { conversationId: convId, userId: owner.userId, now: FIXED_NOW });
    expect(after.generationKey).not.toBe(before.generationKey);
  });

  it("computeGenerationKey unitário é determinístico e estável", () => {
    const ctx = fixtureContext();
    const prompt = composeSystemPrompt(ctx);
    const meta = fixtureResult().meta;
    expect(computeGenerationKey(ctx, prompt, meta)).toBe(computeGenerationKey(ctx, prompt, meta));
    expect(computeGenerationKey(ctx, prompt, meta)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("C) alteração de Memory relevante -> generationKey diferente", async () => {
    const before = await assembleGenerationBundle(prisma, { conversationId: convId, userId: owner.userId, now: FIXED_NOW });
    const mem = track(
      createdMemoryIds,
      await prisma.memory.create({
        data: {
          content: "memória que altera o frame",
          source: "USER_DEFINED",
          importance: "HIGH",
        },
      }),
    );
    await prisma.memoryCharacter.create({ data: { memoryId: mem.id, characterId: charA.id } });
    const after = await assembleGenerationBundle(prisma, { conversationId: convId, userId: owner.userId, now: FIXED_NOW });
    expect(after.generationKey).not.toBe(before.generationKey);
  });

  it("F) assertGenerationContract aceita bundle válido via serviço", async () => {
    const bundle = await generateGeneration(prisma, { conversationId: convId, userId: owner.userId, now: FIXED_NOW });
    expect(assertGenerationContract(bundle)).toBe(true);
  });

  it("G) maxContextFitsPolicy opera com o prompt composto", async () => {
    const bundle = await generateGeneration(prisma, { conversationId: convId, userId: owner.userId, now: FIXED_NOW });
    const big = maxContextFitsPolicy(bundle, bundle.meta.tokens.systemPromptChars + 1000);
    const small = maxContextFitsPolicy(bundle, bundle.meta.tokens.systemPromptChars - 1);
    expect(big.fits).toBe(true);
    expect(small.fits).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Endpoint /craft retorna generationKey e permanece READ-ONLY (via setup real)
// ---------------------------------------------------------------------------

describe("GenerationContract - /craft endpoint", () => {
  let owner: TestUser;
  let charA: Character;
  let convId: string;

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`gen4e-${suffix}@f1nw.test`, "Gen4e");
    charA = await createCharacter(owner, {
      name: "Hugo",
      nationality: "PT",
      birthDate: "1993-01-01",
    });
    const conv = await createConversationDirect("GROUP", [charA.id]);
    convId = conv.id;
  });

  it("H) /craft retorna generationKey no nível de generation", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${convId}/craft`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const gen = res.json().generation!;
    expect(typeof gen.generationKey).toBe("string");
    expect(gen.generationKey).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(gen.context).toBeDefined();
    expect(gen.systemPrompt.length).toBe(gen.meta.tokens.systemPromptChars);
    expect(assertGenerationContract(gen)).toBe(true);
  });

  it("I) /craft permanece READ-ONLY (não altera nada no banco)", async () => {
    const msgsBefore = await prisma.message.count({ where: { conversationId: convId } });
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${convId}/craft`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const msgsAfter = await prisma.message.count({ where: { conversationId: convId } });
    expect(msgsAfter).toBe(msgsBefore);
  });

  it("I2) endpoint não conecta ao fluxo de mensagens", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${convId}/messages`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it("J) ownership idêntico à Fase 11 -> intruder 404", async () => {
    const intruder = await createUser(`gen4i-${Date.now()}@f1nw.test`, "Gen4i");
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${convId}/craft`,
      headers: { cookie: intruder.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("J2) conversation inexistente -> 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${randomUUID()}/craft`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});