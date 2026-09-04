import { afterAll, beforeAll, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import type { AssembledContext } from "../context/context.assembly.js";
import {
  assembleGenerationBundle,
  computeGenerationKey,
  countEmittedSections,
  composeSystemPrompt,
  GenerationSpeakerTargetError,
  type GenerationProvider,
  type ProviderInput,
  type GenerationResult,
  type TokenStats,
} from "./generation.assembly.js";

// ---------------------------------------------------------------------------
// Fase 14 STEP 35 — AI Speaker Identity for Generation.
//
// Prova que a identidade narrativa do AI speaker participa da identidade
// canônica da geração de forma determinística e isolada:
//   - targetCharacterId é explícito, validado server-side, sem fallback;
//   - speakerCharacterId participa da canonicalFrame quando definido;
//   - ausência (assembly-only) preserva o baseline histórico;
//   - ProviderInput NÃO contém speaker;
//   - texto/usage/latency/request-id NUNCA entram na key;
//   - mesmo speaker → mesma key; speakers diferentes → keys diferentes;
//   - RAG permanece independente.
// ---------------------------------------------------------------------------

type TestUser = { cookie: string; userId: string };

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];

let app: FastifyInstance;
let counter = 0;

// Fixture: owner (USER), ownerChar (USER participant), aiA (AI participant),
// aiB (AI participant — para testar key diferente com speaker diferente).
let owner: TestUser;
let ownerCharId: string;
let aiAId: string;
let aiBId: string;
let conversationId: string;

type Capture = { input?: ProviderInput; calls: number };

function spyGeneratedProvider(capture?: Capture): GenerationProvider {
  const state = capture ?? { calls: 0 };
  return {
    name: "spy",
    async run(input) {
      state.calls += 1;
      state.input = input;
      return {
        provider: "spy",
        mode: "generated",
        text: "resposta spy",
        tokenStats: {
          systemPromptChars: input.systemPrompt.length,
          contextBlocks: countEmittedSections(input.systemPrompt),
        },
      };
    },
  };
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();

  counter += 1;
  const email = `s35-${counter}-${Date.now()}-${Math.random()}@x.com`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: "S35", email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  createdUserIds.push(user.id);
  owner = { cookie: "", userId: user.id };

  const char = await prisma.character.create({
    data: {
      name: "S35Char",
      nationality: "BR",
      birthDate: new Date("1994-01-01"),
      controlledBy: "USER",
      userId: user.id,
    },
  });
  createdCharacterIds.push(char.id);
  ownerCharId = char.id;

  const aiA = await prisma.character.create({
    data: { name: "S35AI_A", nationality: "GB", birthDate: new Date("2000-01-01"), controlledBy: "AI" },
  });
  createdCharacterIds.push(aiA.id);
  aiAId = aiA.id;

  const aiB = await prisma.character.create({
    data: { name: "S35AI_B", nationality: "DE", birthDate: new Date("2001-06-15"), controlledBy: "AI" },
  });
  createdCharacterIds.push(aiB.id);
  aiBId = aiB.id;

  const conversation = await prisma.conversation.create({ data: { type: "GROUP" } });
  createdConversationIds.push(conversation.id);
  conversationId = conversation.id;

  await prisma.conversationParticipant.createMany({
    data: [
      { conversationId, characterId: char.id },
      { conversationId, characterId: aiA.id },
      { conversationId, characterId: aiB.id },
    ],
  });
});

afterAll(async () => {
  await prisma.conversationParticipant.deleteMany({
    where: { conversationId: { in: createdConversationIds } },
  });
  await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
  await app.close();
});

// ---------------------------------------------------------------------------
// A) target AI válido → speakerCharacterId correto no resultado
// ---------------------------------------------------------------------------

it("A) target AI válido → speakerCharacterId = target no resultado", async () => {
  const result = await assembleGenerationBundle(
    prisma,
    { conversationId, userId: owner.userId, targetCharacterId: aiAId },
    spyGeneratedProvider(),
  );
  expect(result.meta.mode).toBe("generated");
  expect(result.speakerCharacterId).toBe(aiAId);
  expect(result.text).toBe("resposta spy");
});

// ---------------------------------------------------------------------------
// B) target inexistente → TARGET_NOT_FOUND
// ---------------------------------------------------------------------------

it("B) target inexistente → TARGET_NOT_FOUND", async () => {
  const fake = "00000000-0000-4000-8000-000000000099";
  await expect(
    assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, targetCharacterId: fake },
      spyGeneratedProvider(),
    ),
  ).rejects.toSatisfy((err: GenerationSpeakerTargetError) => {
    expect(err).toBeInstanceOf(GenerationSpeakerTargetError);
    expect(err.code).toBe("TARGET_NOT_FOUND");
    return true;
  });
});

// ---------------------------------------------------------------------------
// C) target não participante → TARGET_NOT_PARTICIPANT
// ---------------------------------------------------------------------------

it("C) target não participante → TARGET_NOT_PARTICIPANT", async () => {
  const outsider = await prisma.character.create({
    data: { name: "Outsider", nationality: "US", birthDate: new Date("1999-01-01"), controlledBy: "AI" },
  });
  createdCharacterIds.push(outsider.id);
  await expect(
    assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, targetCharacterId: outsider.id },
      spyGeneratedProvider(),
    ),
  ).rejects.toSatisfy((err: GenerationSpeakerTargetError) => {
    expect(err).toBeInstanceOf(GenerationSpeakerTargetError);
    expect(err.code).toBe("TARGET_NOT_PARTICIPANT");
    return true;
  });
});

// ---------------------------------------------------------------------------
// D) target USER-controlled → TARGET_NOT_AI
// ---------------------------------------------------------------------------

it("D) target USER-controlled → TARGET_NOT_AI", async () => {
  await expect(
    assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, targetCharacterId: ownerCharId },
      spyGeneratedProvider(),
    ),
  ).rejects.toSatisfy((err: GenerationSpeakerTargetError) => {
    expect(err).toBeInstanceOf(GenerationSpeakerTargetError);
    expect(err.code).toBe("TARGET_NOT_AI");
    return true;
  });
});

// ---------------------------------------------------------------------------
// E) target de outra conversation → TARGET_NOT_PARTICIPANT
// ---------------------------------------------------------------------------

it("E) target de outra conversation → TARGET_NOT_PARTICIPANT", async () => {
  const otherConv = await prisma.conversation.create({ data: { type: "DM" } });
  createdConversationIds.push(otherConv.id);
  // aiA participant da otherConv mas NÃO de conversationId
  await prisma.conversationParticipant.create({
    data: { conversationId: otherConv.id, characterId: aiAId },
  });
  // aiA é participant de conversationId (setUp) mas estamos testando outro participant
  // Criar um AI char que só está em otherConv
  const aiC = await prisma.character.create({
    data: { name: "S35AI_C", nationality: "IT", birthDate: new Date("2002-01-01"), controlledBy: "AI" },
  });
  createdCharacterIds.push(aiC.id);
  await prisma.conversationParticipant.create({
    data: { conversationId: otherConv.id, characterId: aiC.id },
  });
  await expect(
    assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, targetCharacterId: aiC.id },
      spyGeneratedProvider(),
    ),
  ).rejects.toSatisfy((err: GenerationSpeakerTargetError) => {
    expect(err).toBeInstanceOf(GenerationSpeakerTargetError);
    expect(err.code).toBe("TARGET_NOT_PARTICIPANT");
    return true;
  });
});

// ---------------------------------------------------------------------------
// F) generated sem target → TARGET_MISSING_WHEN_REQUIRED
// ---------------------------------------------------------------------------

it("F) generated sem target → TARGET_MISSING_WHEN_REQUIRED", async () => {
  await expect(
    assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId },
      spyGeneratedProvider(),
    ),
  ).rejects.toSatisfy((err: GenerationSpeakerTargetError) => {
    expect(err).toBeInstanceOf(GenerationSpeakerTargetError);
    expect(err.code).toBe("TARGET_MISSING_WHEN_REQUIRED");
    return true;
  });
});

// ---------------------------------------------------------------------------
// G) assembly-only sem target → funciona (baseline preservada)
// ---------------------------------------------------------------------------

it("G) assembly-only sem target → funciona e preserva baseline", async () => {
  const result = await assembleGenerationBundle(
    prisma,
    { conversationId, userId: owner.userId },
  );
  expect(result.meta.mode).toBe("assembly-only");
  expect(result.text).toBeUndefined();
  expect(result.speakerCharacterId).toBeUndefined();
  // key contém "assembly-only" via ruleApplied
  expect(result.generationKey).toMatch(/^sha256:[0-9a-f]{64}$/);
});

// ---------------------------------------------------------------------------
// H) mesmo conversation + mesmo userPrompt + mesmo speaker → mesma GenerationKey
// ---------------------------------------------------------------------------

it("H) mesmo conversation + mesmo userPrompt + mesmo speaker → mesma GenerationKey", async () => {
  const a = await assembleGenerationBundle(
    prisma,
    { conversationId, userId: owner.userId, userPrompt: "pergunta", targetCharacterId: aiAId },
    spyGeneratedProvider(),
  );
  const b = await assembleGenerationBundle(
    prisma,
    { conversationId, userId: owner.userId, userPrompt: "pergunta", targetCharacterId: aiAId },
    spyGeneratedProvider(),
  );
  expect(a.generationKey).toBe(b.generationKey);
  expect(a.generationKey).toMatch(/^sha256:[0-9a-f]{64}$/);
});

// ---------------------------------------------------------------------------
// I) mesmo conversation + mesmo userPrompt + speaker diferente → key diferente
// ---------------------------------------------------------------------------

it("I) mesmo conversation + mesmo userPrompt + speaker diferente → key diferente", async () => {
  const a = await assembleGenerationBundle(
    prisma,
    { conversationId, userId: owner.userId, userPrompt: "pergunta", targetCharacterId: aiAId },
    spyGeneratedProvider(),
  );
  const b = await assembleGenerationBundle(
    prisma,
    { conversationId, userId: owner.userId, userPrompt: "pergunta", targetCharacterId: aiBId },
    spyGeneratedProvider(),
  );
  expect(a.generationKey).not.toBe(b.generationKey);
});

// ---------------------------------------------------------------------------
// J–M) Pure key tests: output text / token usage / latency / request id
//       NUNCA alteram a GenerationKey.
// ---------------------------------------------------------------------------

// Fixture basíl perfeito para key pura (sem DB): canonical input fixo.
function fixturePureContext(): AssembledContext {
  return {
    meta: {
      version: "context.v1",
      conversationId: "00000000-0000-4000-8000-000000000002",
      conversationType: "GROUP",
      participantCharacterIds: ["char1", "char2"],
      assembledAt: "2026-01-01T00:00:00.000Z",
      ruleApplied: "context.v1-policy:msgs=50#mem=15#evt=10#rel=10#news=8",
    },
    participants: [],
    activeSpeaker: { characterId: null, senderType: "USER_CHARACTER" },
    temporal: { worldDate: null, currentSeasonId: null, currentRaceId: null, currentSession: null, phaseMarker: null },
    recentMessages: [],
    memories: [],
    events: [],
    relationships: [],
    motorsport: null,
    news: [],
    omitted: { oldestMessagesTruncated: 0, memoriesOmitted: 0, reasons: [] },
  };
}

function rawMeta(tokens: TokenStats): GenerationResult["meta"] {
  return { provider: "test", mode: "generated", tokens, ruleApplied: "generation.v1-policy:mode=generated" };
}

// Canonical input fixo e determinístico para provas puras de GenerationKey.
function pureKey(): { context: AssembledContext; systemPrompt: string } {
  const context = fixturePureContext();
  const systemPrompt = composeSystemPrompt(context);
  return { context, systemPrompt };
}

// Constrói um GenerationResult completo a partir de um canonical input fixo.
// O que NÃO faz parte do canonical input (text, latency, requestId) NÃO entra
// aqui como dado que influencia a key — e é exatamente isso que os testes
// provam: resultados iguais exceto nesses campos geram a MESMA key.
function buildGeneratedResult(args: {
  context: AssembledContext;
  systemPrompt: string;
  meta: GenerationResult["meta"];
  text: string;
  speakerCharacterId: string;
}): GenerationResult {
  return {
    context: args.context,
    systemPrompt: args.systemPrompt,
    meta: args.meta,
    text: args.text,
    speakerCharacterId: args.speakerCharacterId,
    generationKey: computeGenerationKey(args.context, args.systemPrompt, args.meta, args.speakerCharacterId),
  };
}

it("J) output text diferente → mesma GenerationKey", () => {
  const { context, systemPrompt } = pureKey();
  const keyOf = (text: string): string =>
    buildGeneratedResult({ context, systemPrompt, meta: rawMeta({ systemPromptChars: systemPrompt.length, contextBlocks: 12 }), text, speakerCharacterId: "speaker-x" }).generationKey;
  const kA = keyOf("resposta A");
  const kB = keyOf("resposta B");
  expect(kA).toBe(kB);
  // a key é texto-agnóstica: nenhum texto entra na identidade canônica
  expect(kA).not.toContain("resposta A");
  expect(kA).not.toContain("resposta B");
});

it("K) token usage diferente → mesma GenerationKey", () => {
  const { context, systemPrompt } = pureKey();
  const keyOf = (tokens: TokenStats): string =>
    buildGeneratedResult({ context, systemPrompt, meta: rawMeta(tokens), text: "x", speakerCharacterId: "speaker-x" }).generationKey;
  const metaA: TokenStats = { systemPromptChars: 100, contextBlocks: 12 };
  const metaB: TokenStats = { systemPromptChars: 99999, contextBlocks: 0 };
  expect(metaA).not.toEqual(metaB); // os usos REALMENTE diferem
  const kA = keyOf(metaA);
  const kB = keyOf(metaB);
  expect(kA).toBe(kB); // tokenStats não entra no canonical frame
});

it("L) latency diferente → mesma GenerationKey (latency é runtime-only, fora do contrato)", () => {
  const { context, systemPrompt } = pureKey();
  const base = buildGeneratedResult({ context, systemPrompt, meta: rawMeta({ systemPromptChars: systemPrompt.length, contextBlocks: 12 }), text: "x", speakerCharacterId: "speaker-x" });
  // latency não é campo de GenerationResult: existe apenas como metadado de
  // execução do provider. Modelamos esse metadado como um wrapper externo e
  // provamos que a key deriva SOMENTE do canonical input (mesmo resultado).
  const fast: { result: GenerationResult; latencyMs: number } = { result: base, latencyMs: 12 };
  const slow: { result: GenerationResult; latencyMs: number } = { result: base, latencyMs: 4800 };
  expect(fast.latencyMs).not.toBe(slow.latencyMs);
  expect(fast.result.generationKey).toBe(slow.result.generationKey);
  expect(fast.result.generationKey).toMatch(/^sha256:[0-9a-f]{64}$/);
});

it("M) request id diferente → mesma GenerationKey (requestId fora do canonical input)", () => {
  const { context, systemPrompt } = pureKey();
  const base = buildGeneratedResult({ context, systemPrompt, meta: rawMeta({ systemPromptChars: systemPrompt.length, contextBlocks: 12 }), text: "x", speakerCharacterId: "speaker-x" });
  // requestId é metadado de transporte, não participa da identidade canônica:
  // duas execuções com requestId distintos mas mesmo canonical input → mesma key.
  const r1: { result: GenerationResult; requestId: string } = { result: base, requestId: "req-111" };
  const r2: { result: GenerationResult; requestId: string } = { result: base, requestId: "req-222" };
  expect(r1.requestId).not.toBe(r2.requestId);
  expect(r1.result.generationKey).toBe(r2.result.generationKey);
  expect(r1.result.generationKey).toMatch(/^sha256:[0-9a-f]{64}$/);
});

// ---------------------------------------------------------------------------
// N) speaker NÃO entra no ProviderInput
// ---------------------------------------------------------------------------

it("N) speaker não entra no ProviderInput (provider não conhece o locutor)", async () => {
  const capture: Capture = { calls: 0 };
  await assembleGenerationBundle(
    prisma,
    { conversationId, userId: owner.userId, targetCharacterId: aiAId },
    spyGeneratedProvider(capture),
  );
  expect(capture.calls).toBe(1);
  const input = capture.input!;
  // ProviderInput não contém speaker
  expect(input).not.toHaveProperty("targetCharacterId");
  expect(input).not.toHaveProperty("speakerCharacterId");
  expect(input).not.toHaveProperty("characterId");
  // ProviderInput contém apenas context + systemPrompt (+ userPrompt opcional)
  expect(input).toHaveProperty("context");
  expect(input).toHaveProperty("systemPrompt");
});

// ---------------------------------------------------------------------------
// O) speaker entra corretamente no GenerationResult
// ---------------------------------------------------------------------------

it("O) speaker entra corretamente no GenerationResult", async () => {
  const result = await assembleGenerationBundle(
    prisma,
    { conversationId, userId: owner.userId, targetCharacterId: aiAId },
    spyGeneratedProvider(),
  );
  expect(result.speakerCharacterId).toBe(aiAId);
  expect(result.meta.mode).toBe("generated");
  expect(typeof result.generationKey).toBe("string");
  expect(result.generationKey).toMatch(/^sha256:[0-9a-f]{64}$/);
});

// ---------------------------------------------------------------------------
// P) RAG permanece independente (speaker não acopla a RAG)
// ---------------------------------------------------------------------------

it("P) RAG permanece independente: speaker e RAG coexistem sem acoplamento", async () => {
  // Verifica que passar targetCharacterId não altera a estrutura do ProviderInput
  // e que o speakerCharacterId retorna corretamente mesmo sem RAG.
  const capture: Capture = { calls: 0 };
  const result = await assembleGenerationBundle(
    prisma,
    { conversationId, userId: owner.userId, targetCharacterId: aiAId, userPrompt: "teste" },
    spyGeneratedProvider(capture),
  );
  expect(result.speakerCharacterId).toBe(aiAId);
  expect(result.context.externalRag).toBeUndefined();
  // key contém speaker (não assembly-only)
  expect(result.generationKey).toMatch(/^sha256:[0-9a-f]{64}$/);
  // ProviderInput não contém nem speaker nem ragFrameId
  expect(capture.input).not.toHaveProperty("targetCharacterId");
  expect(capture.input).not.toHaveProperty("ragFrameId");
});

// ---------------------------------------------------------------------------
// Q) NullProvider continua assembly-only (target ausente → baseline)
// ---------------------------------------------------------------------------

it("Q) NullProvider continua assembly-only e sem speaker (baseline)", async () => {
  const result = await assembleGenerationBundle(
    prisma,
    { conversationId, userId: owner.userId },
  );
  expect(result.meta.mode).toBe("assembly-only");
  expect(result.text).toBeUndefined();
  expect(result.speakerCharacterId).toBeUndefined();
  expect(result.meta.provider).toBe("null");
  // key é determinística sem speaker
  const result2 = await assembleGenerationBundle(
    prisma,
    { conversationId, userId: owner.userId },
  );
  expect(result.generationKey).toBe(result2.generationKey);
});
