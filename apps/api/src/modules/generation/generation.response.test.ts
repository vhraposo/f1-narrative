import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import type { AssembledContext } from "../context/context.assembly.js";
import {
  assembleGenerationBundle,
  assemblyOnlyResponseComposer,
  assertGenerationContract,
  composerBudget,
  computeGenerationKey,
  composeSystemPrompt,
  countEmittedSections,
  generateGeneration,
  GENERATION_RULE,
  INTEGRATION_PLAN_VERSION,
  planIntegration,
  RESPONSE_SECTION_IDS,
  type GenerationResult,
} from "./generation.assembly.js";

// Testes do ResponseSkeleton / composer / plano de integração (Fase 12 STEP 5,
// SEM LLM). Os casos puramente estruturais não tocam o banco; o endpoint e o
// determinismo via serviço usam fixtures Prisma + tracking/cleanup.

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
    await prisma.conversation.create({ data: { title: "cv5", type: type === "DM" ? "DM" : "GROUP" } }),
  );
  await prisma.conversationParticipant.createMany({
    data: [...new Set(participantIds)].map((characterId) => ({
      conversationId: conv.id,
      characterId,
    })),
  });
  return { id: conv.id };
}

// --- fixture determinística minimal (módulo-puro) ---
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
    generationKey: computeGenerationKey(context, systemPrompt, {
      provider: "null",
      mode: "assembly-only",
      tokens: { systemPromptChars: systemPrompt.length, contextBlocks: countEmittedSections(systemPrompt) },
      ruleApplied: GENERATION_RULE,
    }),
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
// ResponseComposer — pureza/determinismo/imutabilidade/estrutura
// ---------------------------------------------------------------------------

describe("ResponseComposer - assemblyOnly", () => {
  it("composer é puro: mesmo GenerationResult -> mesmo skeleton (serializado)", () => {
    const r = fixtureResult();
    const a = assemblyOnlyResponseComposer.compose(r);
    const b = assemblyOnlyResponseComposer.compose(r);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("status é assembly-only", () => {
    const skeleton = assemblyOnlyResponseComposer.compose(fixtureResult());
    expect(skeleton.status).toBe("assembly-only");
  });

  it("generationKey do skeleton repassa o do GenerationResult", () => {
    const r = fixtureResult();
    const skeleton = assemblyOnlyResponseComposer.compose(r);
    expect(skeleton.generationKey).toBe(r.generationKey);
  });

  it("sections seguem a ordem centralizada RESPONSE_SECTION_IDS", () => {
    const skeleton = assemblyOnlyResponseComposer.compose(fixtureResult());
    expect(skeleton.sections.map((s) => s.id)).toEqual([...RESPONSE_SECTION_IDS]);
  });

  it("composer NÃO altera o input (imutabilidade)", () => {
    const r = fixtureResult();
    const snapshot = JSON.stringify(r);
    assemblyOnlyResponseComposer.compose(r);
    expect(JSON.stringify(r)).toBe(snapshot);
  });

  it("skeleton não contém texto de IA inventado (nenhum conteúdo narrativo)", () => {
    const skeleton = assemblyOnlyResponseComposer.compose(fixtureResult());
    for (const section of skeleton.sections) {
      expect(section.source).toBe("generation");
      expect("content" in section).toBe(false);
    }
    // nenhuma nota deve simular fala do personagem
    const notes = skeleton.sections.map((s) => s.note).join(" ");
    expect(notes).not.toMatch(/resposta\s*:\s*["'“]/i);
  });

  it("contexto marcado ready; resposta/provider/persistência claramente não produzidos", () => {
    const skeleton = assemblyOnlyResponseComposer.compose(fixtureResult());
    const byId = Object.fromEntries(skeleton.sections.map((s) => [s.id, s]));
    expect(byId.generation_context.status).toBe("ready");
    expect(byId.generation_context.implemented).toBe(true);
    expect(byId.narrative_response.status).toBe("awaiting-provider");
    expect(byId.narrative_response.implemented).toBe(false);
    expect(byId.provider_output.status).toBe("awaiting-provider");
    expect(byId.provider_output.implemented).toBe(false);
    expect(byId.persistence.status).toBe("future");
    expect(byId.persistence.implemented).toBe(false);
  });

  it("depende de generationKey: skeletons com keys diferentes são diferentes", () => {
    const a = fixtureResult();
    const b = fixtureResult();
    b.generationKey = "sha256:" + "b".repeat(64);
    const skeletonA = assemblyOnlyResponseComposer.compose(a);
    const skeletonB = assemblyOnlyResponseComposer.compose(b);
    expect(JSON.stringify(skeletonA)).not.toBe(JSON.stringify(skeletonB));
    expect(skeletonA.generationKey).not.toBe(skeletonB.generationKey);
  });
});

// ---------------------------------------------------------------------------
// composerBudget
// ---------------------------------------------------------------------------

describe("composerBudget", () => {
  it("teto maior que input -> fits true", () => {
    const r = fixtureResult();
    const budget = composerBudget(r, r.systemPrompt.length + 100);
    expect(budget.inputChars).toBe(r.systemPrompt.length);
    expect(budget.outputCeilingChars).toBeGreaterThan(budget.inputChars);
    expect(budget.fits).toBe(true);
  });

  it("teto igual ao input -> fits true", () => {
    const r = fixtureResult();
    expect(composerBudget(r, r.systemPrompt.length).fits).toBe(true);
  });

  it("teto menor que input -> fits false", () => {
    const r = fixtureResult();
    expect(composerBudget(r, r.systemPrompt.length - 1).fits).toBe(false);
  });

  it("teto 0 com prompt não vazio -> fits false", () => {
    expect(composerBudget(fixtureResult(), 0).fits).toBe(false);
  });

  it("inputChars corresponde a systemPrompt.length (mesma fonte do contrato)", () => {
    const r = fixtureResult();
    const budget = composerBudget(r, 1);
    expect(budget.inputChars).toBe(r.meta.tokens.systemPromptChars);
  });

  it("comportamento determinístico para entradas iguais", () => {
    const r = fixtureResult();
    expect(JSON.stringify(composerBudget(r, 5000))).toBe(
      JSON.stringify(composerBudget(fixtureResult(), 5000)),
    );
  });
});

// ---------------------------------------------------------------------------
// planIntegration
// ---------------------------------------------------------------------------

describe("planIntegration", () => {
  const REQ = { userId: "u-1", conversationId: "c-1" };

  it("A) mesmo request -> mesmo plano serializado", () => {
    expect(JSON.stringify(planIntegration(REQ))).toBe(JSON.stringify(planIntegration(REQ)));
  });

  it("B) ordem de stages estável (7 estágios na ordem canônica)", () => {
    const plan = planIntegration(REQ);
    expect(plan.stages.map((s) => s.id)).toEqual([
      "conversation-access",
      "context-assembly",
      "generation-bundle",
      "prompt-composition",
      "provider-boundary",
      "response-composer",
      "persistence-boundary",
    ]);
    expect(plan.stages).toHaveLength(7);
  });

  it("C) versions e rules são estáveis", () => {
    const a = planIntegration(REQ);
    const b = planIntegration(REQ);
    expect(a.version).toBe(INTEGRATION_PLAN_VERSION);
    expect(JSON.stringify(a.stages.map((s) => [s.id, s.version, s.ruleApplied]))).toBe(
      JSON.stringify(b.stages.map((s) => [s.id, s.version, s.ruleApplied])),
    );
  });

  it("D) nenhum stage futuro aparece como implementado", () => {
    const plan = planIntegration(REQ);
    const future = plan.stages.filter((s) => !s.implemented);
    expect(future.length).toBeGreaterThanOrEqual(2);
    for (const s of future) {
      expect(s.ruleApplied).toBeNull();
    }
  });

  it("E) provider real marcado como futuro (mode future-provider, implemented false)", () => {
    const provider = planIntegration(REQ).stages.find((s) => s.id === "provider-boundary")!;
    expect(provider.implemented).toBe(false);
    expect(provider.mode).toBe("future-provider");
    expect(provider.version).toBe("provider.future");
  });

  it("F) persistence marcada como futura (implemented false)", () => {
    const persistence = planIntegration(REQ).stages.find((s) => s.id === "persistence-boundary")!;
    expect(persistence.implemented).toBe(false);
    expect(persistence.version).toBe("persistence.future");
  });

  it("G) RAG/External Research separado como Fase 13 (sem dependência executável)", () => {
    const plan = planIntegration(REQ);
    expect(plan.externalResearch).toBe("Fase 13");
    expect(plan.stages.some((s) => s.id === "rag" || s.id === "external-research")).toBe(false);
  });

  it("estágios implementados usam ruleApplied coerente com a Fase 12", () => {
    const implemented = planIntegration(REQ).stages.filter((s) => s.implemented);
    for (const s of implemented) {
      expect(s.ruleApplied).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Regression de contrato via serviço + endpoint (fixtures reais)
// ---------------------------------------------------------------------------

describe("ResponseSkeleton - via serviço e endpoint", () => {
  let owner: TestUser;
  let charA: Character;
  let convId: string;
  const FIXED_NOW = new Date("2026-03-01T12:00:00Z");

  beforeAll(async () => {
    const suffix = Date.now();
    owner = await createUser(`gen5-${suffix}@f1nw.test`, "Gen5");
    charA = await createCharacter(owner, {
      name: "Rui",
      nationality: "PT",
      birthDate: "1992-02-02",
    });
    const conv = await createConversationDirect("GROUP", [charA.id]);
    convId = conv.id;

    await prisma.message.create({
      data: {
        conversationId: convId,
        senderType: "USER_CHARACTER",
        characterId: charA.id,
        content: "primeira fala do step 5",
        createdAt: new Date("2026-02-01T10:00:00Z"),
      },
    });
  });

  it("assertGenerationContract permanece true antes e depois do composer", async () => {
    const bundle = await generateGeneration(prisma, { conversationId: convId, userId: owner.userId, now: FIXED_NOW });
    expect(assertGenerationContract(bundle)).toBe(true);
    const skeleton = assemblyOnlyResponseComposer.compose(bundle);
    expect(assertGenerationContract(bundle)).toBe(true);
    expect(skeleton.status).toBe("assembly-only");
  });

  it("composer não modifica o GenerationResult produzido pelo serviço", async () => {
    const bundle = await assembleGenerationBundle(prisma, { conversationId: convId, userId: owner.userId, now: FIXED_NOW });
    const snapshot = JSON.stringify(bundle);
    assemblyOnlyResponseComposer.compose(bundle);
    expect(JSON.stringify(bundle)).toBe(snapshot);
  });

  it("/craft expõe responseSkeleton derivado do generation (mesma generationKey)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${convId}/craft`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const gen = body.generation!;
    const skeleton = body.responseSkeleton!;
    expect(assertGenerationContract(gen)).toBe(true);
    expect(skeleton.status).toBe("assembly-only");
    expect(skeleton.generationKey).toBe(gen.generationKey);
    expect(skeleton.sections.map((s: { id: string }) => s.id)).toEqual([...RESPONSE_SECTION_IDS]);
  });

  it("/craft com responseSkeleton permanece READ-ONLY", async () => {
    const msgsBefore = await prisma.message.count({ where: { conversationId: convId } });
    const res = await app.inject({
      method: "GET",
      url: `/api/conversations/${convId}/craft`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().responseSkeleton).toBeDefined();
    const msgsAfter = await prisma.message.count({ where: { conversationId: convId } });
    expect(msgsAfter).toBe(msgsBefore);
  });
});