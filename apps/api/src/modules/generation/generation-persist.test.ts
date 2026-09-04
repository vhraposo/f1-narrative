import { afterAll, beforeAll, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import type { AssembledContext } from "../context/context.assembly.js";
import {
  assembleGenerationBundle,
  composeSystemPrompt,
  computeGenerationKey,
  countEmittedSections,
  GenerationSpeakerTargetError,
  type GenerationProvider,
  type GenerationResult,
  type ProviderInput,
} from "./generation.assembly.js";
import { persistGeneratedMessage } from "./generation-persist.js";

// ---------------------------------------------------------------------------
// Fase 14 STEP 36 — Message persistence para geração real.
//
// Prova que a saída `generated` (mode + speakerCharacterId + text, resoltvidas
// no STEP 35) é persistida como Message `AI_CHARACTER` usando EXATAMENTE o
// `speakerCharacterId` — sem re-resolver o speaker, sem histórico, sem
// participant[0], sem fallback, e que nenhum caso inválido/assembly-only produz
// INSERT. RAG permanece independente. Sem deduplicação/unique/índice novo.
// ---------------------------------------------------------------------------

type TestUser = { cookie: string; userId: string };

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];

let app: FastifyInstance;
let counter = 0;

let owner: TestUser;
let ownerCharId: string;
let aiAId: string;
let aiBId: string;
let conversationId: string;

type Capture = { input?: ProviderInput; calls: number };

function spyGeneratedProvider(text = "resposta spy"): GenerationProvider {
  return {
    name: "spy",
    async run(input) {
      return {
        provider: "spy",
        mode: "generated",
        text,
        tokenStats: {
          systemPromptChars: input.systemPrompt.length,
          contextBlocks: countEmittedSections(input.systemPrompt),
        },
      };
    },
  };
}

function fixturePureContext(conversationIdOverride: string): AssembledContext {
  return {
    meta: {
      version: "context.v1",
      conversationId: conversationIdOverride,
      conversationType: "GROUP",
      participantCharacterIds: [],
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

// Constrói um GenerationResult sintético (sem passar pelo bundle) para exercitar
// a persistência em casos em que o bundle já bloquearia (ex.: generated sem
// speaker, que o STEP 35 rejeita). Apenas os campos lidos por
// persistGeneratedMessage precisam ser coerentes.
function syntheticResult(overrides: {
  mode: "generated" | "assembly-only";
  conversationId: string;
  speakerCharacterId?: string;
  text?: string;
}): GenerationResult {
  const context = fixturePureContext(overrides.conversationId);
  const systemPrompt = composeSystemPrompt(context);
  const meta = {
    provider: "test",
    mode: overrides.mode,
    tokens: { systemPromptChars: systemPrompt.length, contextBlocks: countEmittedSections(systemPrompt) },
    ruleApplied: overrides.mode === "generated" ? "generation.v1-policy:mode=generated" : "generation.v1-policy:provider=null#mode=assembly-only",
  };
  return {
    context,
    systemPrompt,
    meta,
    ...(overrides.mode === "generated" ? { text: overrides.text ?? "texto sintético" } : {}),
    ...(overrides.speakerCharacterId !== undefined ? { speakerCharacterId: overrides.speakerCharacterId } : {}),
    generationKey: computeGenerationKey(context, systemPrompt, meta, overrides.speakerCharacterId),
  };
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();

  counter += 1;
  const email = `s36-${counter}-${Date.now()}-${Math.random()}@x.com`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: "S36", email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  createdUserIds.push(user.id);
  owner = { cookie: "", userId: user.id };

  const char = await prisma.character.create({
    data: {
      name: "S36Char",
      nationality: "BR",
      birthDate: new Date("1994-01-01"),
      controlledBy: "USER",
      userId: user.id,
    },
  });
  createdCharacterIds.push(char.id);
  ownerCharId = char.id;

  const aiA = await prisma.character.create({
    data: { name: "S36AI_A", nationality: "GB", birthDate: new Date("2000-01-01"), controlledBy: "AI" },
  });
  createdCharacterIds.push(aiA.id);
  aiAId = aiA.id;

  const aiB = await prisma.character.create({
    data: { name: "S36AI_B", nationality: "DE", birthDate: new Date("2001-06-15"), controlledBy: "AI" },
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
  await prisma.message.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
  await prisma.conversationParticipant.deleteMany({
    where: { conversationId: { in: createdConversationIds } },
  });
  await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
  await app.close();
});

async function messageCountFor(convId: string): Promise<number> {
  return prisma.message.count({ where: { conversationId: convId } });
}

// ---------------------------------------------------------------------------
// A) generated + speaker AI válido → exatamente 1 Message AI_CHARACTER
// ---------------------------------------------------------------------------

it("A) generated + speaker AI válido → 1 Message AI_CHARACTER com identidade exata", async () => {
  const result = await assembleGenerationBundle(
    prisma,
    { conversationId, userId: owner.userId, userPrompt: "pergunta A", targetCharacterId: aiAId },
    spyGeneratedProvider("texto A"),
  );
  expect(result.meta.mode).toBe("generated");
  expect(result.speakerCharacterId).toBe(aiAId);

  const decision = await persistGeneratedMessage(prisma, result, owner.userId);
  expect(decision.persisted).toBe(true);
  if (!decision.persisted) return;
  expect(decision.message.senderType).toBe("AI_CHARACTER");
  expect(decision.message.characterId).toBe(aiAId); // === speakerCharacterId
  expect(decision.message.content).toBe("texto A");
  expect(decision.message.conversationId).toBe(conversationId);
  expect(await messageCountFor(conversationId)).toBe(1);
});

// ---------------------------------------------------------------------------
// B) assembly-only → 0 Message
// ---------------------------------------------------------------------------

it("B) assembly-only → 0 Message", async () => {
  const result = syntheticResult({ mode: "assembly-only", conversationId });
  const decision = await persistGeneratedMessage(prisma, result, owner.userId);
  expect(decision.persisted).toBe(false);
  if (decision.persisted) throw new Error("esperava não persistir");
  expect(decision.reason).toBe("mode-not-generated");
  expect(await messageCountFor(conversationId)).toBe(1); // inalterado (só a A criou 1)
});

// ---------------------------------------------------------------------------
// C) generated sem speakerCharacterId → 0 Message
// ---------------------------------------------------------------------------

it("C) generated sem speakerCharacterId → 0 Message", async () => {
  const result = syntheticResult({ mode: "generated", conversationId, text: "sem speaker" });
  expect(result.speakerCharacterId).toBeUndefined();
  const decision = await persistGeneratedMessage(prisma, result, owner.userId);
  expect(decision.persisted).toBe(false);
  if (decision.persisted) throw new Error("esperava não persistir");
  expect(decision.reason).toBe("missing-speaker");
  expect(await messageCountFor(conversationId)).toBe(1); // inalterado
});

// ---------------------------------------------------------------------------
// D) generated sem text → 0 Message
// ---------------------------------------------------------------------------

it("D) generated sem text → 0 Message", async () => {
  const result = syntheticResult({ mode: "generated", conversationId, speakerCharacterId: aiAId, text: "  " });
  const decision = await persistGeneratedMessage(prisma, result, owner.userId);
  expect(decision.persisted).toBe(false);
  expect(decision.reason).toBe("missing-or-empty-text");
  expect(await messageCountFor(conversationId)).toBe(1); // inalterado
});

// ---------------------------------------------------------------------------
// E) target inválido (inexistente) → erro STEP 35 + 0 Message
// ---------------------------------------------------------------------------

it("E) target inexistente → GenerationSpeakerTargetError TARGET_NOT_FOUND + 0 Message", async () => {
  const fake = "00000000-0000-4000-8000-000000000088";
  await expect(
    assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, targetCharacterId: fake },
      spyGeneratedProvider(),
    ),
  ).rejects.toBeInstanceOf(GenerationSpeakerTargetError);
  expect(await messageCountFor(conversationId)).toBe(1); // inalterado
});

// ---------------------------------------------------------------------------
// F) target USER-controlled → TARGET_NOT_AI + 0 Message
// ---------------------------------------------------------------------------

it("F) target USER-controlled → TARGET_NOT_AI + 0 Message", async () => {
  await expect(
    assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, targetCharacterId: ownerCharId },
      spyGeneratedProvider(),
    ),
  ).rejects.toSatisfy((err: GenerationSpeakerTargetError) => {
    expect(err.code).toBe("TARGET_NOT_AI");
    return true;
  });
  expect(await messageCountFor(conversationId)).toBe(1); // inalterado
});

// ---------------------------------------------------------------------------
// G) target AI fora da conversation → TARGET_NOT_PARTICIPANT + 0 Message
// ---------------------------------------------------------------------------

it("G) target AI fora da conversation → TARGET_NOT_PARTICIPANT + 0 Message", async () => {
  const outsider = await prisma.character.create({
    data: { name: "S36Outsider", nationality: "US", birthDate: new Date("1999-01-01"), controlledBy: "AI" },
  });
  createdCharacterIds.push(outsider.id);
  await expect(
    assembleGenerationBundle(
      prisma,
      { conversationId, userId: owner.userId, targetCharacterId: outsider.id },
      spyGeneratedProvider(),
    ),
  ).rejects.toSatisfy((err: GenerationSpeakerTargetError) => {
    expect(err.code).toBe("TARGET_NOT_PARTICIPANT");
    return true;
  });
  expect(await messageCountFor(conversationId)).toBe(1); // inalterado
});

// ---------------------------------------------------------------------------
// H) conversation sem acesso/ownership → 0 Message
// ---------------------------------------------------------------------------

it("H) conversation sem ownership → 0 Message", async () => {
  const foreignConvId = "00000000-0000-4000-8000-000000000077";
  const result = syntheticResult({ mode: "generated", conversationId: foreignConvId, speakerCharacterId: aiAId });
  const decision = await persistGeneratedMessage(prisma, result, owner.userId);
  expect(decision.persisted).toBe(false);
  expect(decision.reason).toBe("no-conversation-access");
  expect(await prisma.message.count({ where: { conversationId: foreignConvId } })).toBe(0);
});

// ---------------------------------------------------------------------------
// I) speaker A vs speaker B → Messages com characterId distinto preservado
// ---------------------------------------------------------------------------

it("I) speaker A vs B → cada Message preserva exatamente seu speaker", async () => {
  const ra = await assembleGenerationBundle(
    prisma,
    { conversationId, userId: owner.userId, userPrompt: "pora A", targetCharacterId: aiAId },
    spyGeneratedProvider("resposta A"),
  );
  const rb = await assembleGenerationBundle(
    prisma,
    { conversationId, userId: owner.userId, userPrompt: "para B", targetCharacterId: aiBId },
    spyGeneratedProvider("resposta B"),
  );
  const da = await persistGeneratedMessage(prisma, ra, owner.userId);
  const db = await persistGeneratedMessage(prisma, rb, owner.userId);
  expect(da.persisted).toBe(true);
  expect(db.persisted).toBe(true);
  if (da.persisted && db.persisted) {
    expect(da.message.characterId).toBe(aiAId);
    expect(db.message.characterId).toBe(aiBId);
    expect(da.message.characterId).not.toBe(db.message.characterId);
  }
  // cada um com seu texto
  const messages = await prisma.message.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });
  expect(messages.some((m) => m.characterId === aiAId && m.content === "resposta A")).toBe(true);
  expect(messages.some((m) => m.characterId === aiBId && m.content === "resposta B")).toBe(true);
});

// ---------------------------------------------------------------------------
// J) RAG coexiste → persistência não modifica nem depende de RAG
// ---------------------------------------------------------------------------

it("J) RAG coexiste sem modificar nem depender de RAG", async () => {
  const before = await prisma.conversationRagFrame.count({ where: { conversationId } });
  const result = await assembleGenerationBundle(
    prisma,
    { conversationId, userId: owner.userId, userPrompt: "com rag", targetCharacterId: aiAId },
    spyGeneratedProvider("com rag"),
  );
  expect(result.context.externalRag).toBeUndefined(); // baseline sem ragFrameId
  const decision = await persistGeneratedMessage(prisma, result, owner.userId);
  expect(decision.persisted).toBe(true);
  const after = await prisma.conversationRagFrame.count({ where: { conversationId } });
  expect(after).toBe(before); // RAG intacto
});

// ---------------------------------------------------------------------------
// K) NullProvider → assembly-only, não começa a persistir
// ---------------------------------------------------------------------------

it("K) NullProvider assembly-only → não persiste Message", async () => {
  const base = await assembleGenerationBundle(
    prisma,
    { conversationId, userId: owner.userId },
  );
  expect(base.meta.mode).toBe("assembly-only");
  const decision = await persistGeneratedMessage(prisma, base, owner.userId);
  expect(decision.persisted).toBe(false);
  expect(decision.reason).toBe("mode-not-generated");
});

// ---------------------------------------------------------------------------
// L) determinismo: speaker persistido === GenerationResult.speakerCharacterId
// ---------------------------------------------------------------------------

it("L) speaker persistido é EXATAMENTE o valor do GenerationResult (sem recalcular)", async () => {
  const result = await assembleGenerationBundle(
    prisma,
    { conversationId, userId: owner.userId, userPrompt: "deu", targetCharacterId: aiAId },
    spyGeneratedProvider("determinístico"),
  );
  const expected = result.speakerCharacterId;
  const decision = await persistGeneratedMessage(prisma, result, owner.userId);
  expect(decision.persisted).toBe(true);
  if (decision.persisted) {
    expect(decision.message.characterId).toBe(expected);
    expect(decision.message.characterId).toBe(aiAId);
  }
});
