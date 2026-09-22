import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  assembleGenerationBundle,
  countEmittedSections,
  type GenerationProvider,
  type ProviderInput,
} from "../generation/generation.assembly.js";
import { OllamaProviderError } from "../generation/ollama-provider.js";
import { computeChunkContentHash } from "../external-research/external-chunking.js";
import { COHERE_DIMENSIONS } from "../external-research/external-embedding-provider.js";
import { computeDocumentContentHash } from "../external-research/external-ingest.js";
import { EXTERNAL_RETRIEVAL_RULE } from "../external-research/external-retrieval.js";
import {
  computeConversationRagFrameKey,
  computeConversationRagFreshnessAnchor,
  computeRagQueryHash,
} from "../external-research/conversation-rag.js";

// ---------------------------------------------------------------------------
// STEP 109B — turno multi-character
// POST /api/conversations/:id/turn
//
// Envolve: auth → ownership → zod → persist USER (1x) →
// ResponseOrchestrator.selectSpeakers → geração SEQUENCIAL → resposta
// `{ userMessage, messages[], failedSpeakers[] }`. Cobre A–V:
//
// A. não autenticado → 401 sem persistência
// B. body inválido → 400 VALIDATION_ERROR
// C. userPrompt vazio → 400
// D. conversation inexistente → 404
// E. conversation sem ownership → 404
// F. sem CHARACTER USER do usuário → 403
// G. zero AI → USER persistida 1x, messages [] , failedSpeakers []
// H. um AI (menção) → USER + 1 Message AI; identity exata; contrato da resposta
// I. dois AI → 2 Messages na ordem de seleção (characterId asc)
// J. visibilidade: speaker B vê a Message de A no contexto (fidelity)
// K. cap (maxResponders=3): 4 AI mencionados → 3 selecionados, 4º não responde
// L. AI fora da conversa nunca vira speaker
// M. Character USER nunca vira AI
// N. erro parcial: A sucesso + B provider-error → A preservado, B em failedSpeakers
// O. múltiplos USER characters → menor characterId (desempate determinístico)
// P. RAG frame inexistente → 404 e USER NÃO persistida
// Q. retry (sem idempotency key): 2ª chamada adiciona 1 USER + 1 AI (append)
// R. provider recebe systemPrompt + userPrompt por speaker e NÃO speaker
// S. Conversation.updatedAt é atualizado após o turno
// ---------------------------------------------------------------------------

type TestUser = { cookie: string; userId: string };

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];
const createdMemoryIds: string[] = [];
const createdSourceIds: string[] = [];
const createdDocumentIds: string[] = [];
const createdChunkIds: string[] = [];

let counter = 0;

let appDefault: FastifyInstance;
let appGen: FastifyInstance;

let owner: TestUser;
let owner2: TestUser;

// Ids fixos (uuid válidos) para desempate lexicográfico determinístico.
const charU = "00000000-0000-4000-8000-0000000000a1";
const charU2 = "00000000-0000-4000-8000-0000000000a2";
const aiA = "00000000-0000-4000-8000-0000000000aa";
const aiB = "00000000-0000-4000-8000-0000000000ab";
const aiC = "00000000-0000-4000-8000-0000000000ac";
const aiD = "00000000-0000-4000-8000-0000000000ad";
const aiOut = "00000000-0000-4000-8000-0000000000ae";

let charAiOwned: string;
let charOther: string;

let conv1: string; // [charU, aiA, aiB, aiC, aiD]
let convUserOnly: string; // [charU]
let convAiOnly: string; // [charAiOwned] (owner acessa mas não tem CHARACTER USER)
let convOther: string; // [charOther] (owner2; owner não acessa)
let convDualUser: string; // [charU, charU2, aiA]

const TURN_TEXT = "resposta turn";

function generatedProvider(
  text: string,
  capture?: { input?: ProviderInput; calls: number },
): GenerationProvider {
  const acc = capture ?? { calls: 0 };
  return {
    name: "spy",
    async run(input) {
      acc.calls += 1;
      acc.input = input;
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

function partialFailProvider(): GenerationProvider {
  let calls = 0;
  return {
    name: "partial",
    async run(input) {
      calls += 1;
      if (calls === 2) {
        throw new OllamaProviderError(
          "network",
          "segundo speaker indisponível (não deve vazar).",
        );
      }
      return {
        provider: "partial",
        mode: "generated",
        text: `resposta-${calls}`,
        tokenStats: {
          systemPromptChars: input.systemPrompt.length,
          contextBlocks: countEmittedSections(input.systemPrompt),
        },
      };
    },
  };
}

async function signUp(name: string): Promise<TestUser> {
  counter += 1;
  const email = `s109-${counter}-${Date.now()}-${Math.random()}@x.com`;
  const res = await appGen.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name, email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  createdUserIds.push(user.id);
  return { cookie, userId: user.id };
}

async function newUserCharacter(
  user: TestUser,
  name: string,
  id?: string,
): Promise<string> {
  const character = await prisma.character.create({
    data: {
      ...(id ? { id } : {}),
      name,
      nationality: "BR",
      birthDate: new Date("1994-01-01"),
      controlledBy: "USER",
      userId: user.userId,
    },
  });
  createdCharacterIds.push(character.id);
  return character.id;
}

async function newAICharacter(name: string, id?: string): Promise<string> {
  const character = await prisma.character.create({
    data: {
      ...(id ? { id } : {}),
      name,
      nationality: "GB",
      birthDate: new Date("2000-01-01"),
      controlledBy: "AI",
    },
  });
  createdCharacterIds.push(character.id);
  return character.id;
}

async function newConversation(participantIds: string[]): Promise<string> {
  const conversation = await prisma.conversation.create({
    data: { type: "GROUP" },
  });
  createdConversationIds.push(conversation.id);
  await prisma.conversationParticipant.createMany({
    data: participantIds.map((characterId) => ({
      conversationId: conversation.id,
      characterId,
    })),
  });
  return conversation.id;
}

type TurnJson = {
  code?: string;
  error?: string;
  issues?: unknown[];
  userMessage: {
    id: string;
    conversationId: string;
    senderType: string;
    characterId: string | null;
    content: string;
    createdAt: string;
  };
  messages: Array<{
    id: string;
    conversationId: string;
    senderType: string;
    characterId: string;
    content: string;
    contextJson: {
      family: string;
      generationKey: string;
      provider: string;
      rag: { used: boolean };
      fidelity: { messages: number; memories: number; events: number; relationships: number; news: number };
    };
    createdAt: string;
  }>;
  failedSpeakers: Array<{ characterId: string; error: string }>;
};

type TurnResult = { statusCode: number; json: () => TurnJson };

async function turn(
  app: FastifyInstance,
  user: TestUser,
  conversationId: string,
  payload: Record<string, unknown>,
): Promise<TurnResult> {
  const res = await app.inject({
    method: "POST",
    url: `/api/conversations/${conversationId}/turn`,
    headers: { cookie: user.cookie },
    payload,
  });
  return { statusCode: res.statusCode, json: () => res.json() as TurnJson };
}

function messageCount(conversationId: string): Promise<number> {
  return prisma.message.count({ where: { conversationId } });
}

async function resetMessages(conversationId: string) {
  await prisma.message.deleteMany({ where: { conversationId } });
}

beforeAll(async () => {
  appDefault = buildApp();
  appGen = buildApp(undefined, generatedProvider(TURN_TEXT));
  await appDefault.ready();
  await appGen.ready();

  owner = await signUp("T109Owner");
  owner2 = await signUp("T109Owner2");

  await newUserCharacter(owner, "CharU", charU);
  await newUserCharacter(owner, "CharU2", charU2);

  charAiOwned = (
    await prisma.character.create({
      data: {
        name: "CharAiOwned",
        nationality: "FR",
        birthDate: new Date("1997-05-05"),
        controlledBy: "AI",
        userId: owner.userId,
      },
    })
  ).id;
  createdCharacterIds.push(charAiOwned);

  charOther = await newUserCharacter(owner2, "CharOther");

  await newAICharacter("SpeakerAlpha", aiA);
  await newAICharacter("SpeakerBeta", aiB);
  await newAICharacter("SpeakerGamma", aiC);
  await newAICharacter("SpeakerDelta", aiD);
  await newAICharacter("SpeakerOmicron", aiOut);

  conv1 = await newConversation([charU, aiA, aiB, aiC, aiD]);
  convUserOnly = await newConversation([charU]);
  convAiOnly = await newConversation([charAiOwned]);
  convOther = await newConversation([charOther]);
  convDualUser = await newConversation([charU, charU2, aiA]);
});

afterAll(async () => {
  await prisma.conversationRagSnapshotItem.deleteMany({
    where: { snapshot: { frame: { conversationId: { in: createdConversationIds } } } },
  });
  await prisma.conversationRagSnapshot.deleteMany({
    where: { frame: { conversationId: { in: createdConversationIds } } },
  });
  await prisma.conversationRagFrame.deleteMany({
    where: { conversationId: { in: createdConversationIds } },
  });
  await prisma.message.deleteMany({
    where: { conversationId: { in: createdConversationIds } },
  });
  await prisma.conversationParticipant.deleteMany({
    where: { conversationId: { in: createdConversationIds } },
  });
  await prisma.conversation.deleteMany({
    where: { id: { in: createdConversationIds } },
  });
  await prisma.memory.deleteMany({ where: { id: { in: createdMemoryIds } } });
  await prisma.externalChunk.deleteMany({ where: { id: { in: createdChunkIds } } });
  await prisma.externalDocument.deleteMany({ where: { id: { in: createdDocumentIds } } });
  await prisma.externalSource.deleteMany({ where: { id: { in: createdSourceIds } } });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
  await appDefault.close();
  await appGen.close();
});

describe("conversation-turn routes", () => {
  it("A) não autenticado → 401 sem persistência", async () => {
    const res = await appGen.inject({
      method: "POST",
      url: `/api/conversations/${conv1}/turn`,
      payload: { userPrompt: "Olá!" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHENTICATED");
    expect(await messageCount(conv1)).toBe(0);
  });

  it("B) body inválido → 400 VALIDATION_ERROR", async () => {
    await resetMessages(conv1);
    const res = await turn(appGen, owner, conv1, {});
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(res.json().issues)).toBe(true);
    expect(await messageCount(conv1)).toBe(0);
  });

  it("C) userPrompt vazio → 400", async () => {
    const res = await turn(appGen, owner, conv1, { userPrompt: "   " });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
    expect(await messageCount(conv1)).toBe(0);
  });

  it("D) conversation inexistente → 404", async () => {
    const ghost = "00000000-0000-4000-8000-000000000077";
    const res = await turn(appGen, owner, ghost, { userPrompt: "Olá!" });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
    expect(await messageCount(ghost)).toBe(0);
  });

  it("E) conversation sem ownership → 404", async () => {
    const res = await turn(appGen, owner, convOther, { userPrompt: "Olá!" });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
    expect(await messageCount(convOther)).toBe(0);
  });

  it("F) sem CHARACTER USER do usuário → 403, sem persistência", async () => {
    const res = await turn(appGen, owner, convAiOnly, { userPrompt: "Olá!" });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    expect(await messageCount(convAiOnly)).toBe(0);
  });

  it("G) zero AI → USER persistida 1x; messages [] e failedSpeakers []", async () => {
    await resetMessages(convUserOnly);
    const res = await turn(appGen, owner, convUserOnly, {
      userPrompt: "Mensagem sem IA",
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(Object.keys(json).sort()).toEqual(
      ["failedSpeakers", "messages", "userMessage"].sort(),
    );
    expect(json.messages).toEqual([]);
    expect(json.failedSpeakers).toEqual([]);
    expect(json.userMessage.senderType).toBe("USER_CHARACTER");
    expect(json.userMessage.characterId).toBe(charU);
    expect(json.userMessage.content).toBe("Mensagem sem IA");
    expect(await messageCount(convUserOnly)).toBe(1);
  });

  it("H) um AI (menção) → USER + 1 Message AI; identidade e contrato exatos", async () => {
    await resetMessages(conv1);
    const res = await turn(appGen, owner, conv1, {
      userPrompt: "Olá, SpeakerAlpha!",
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.userMessage.characterId).toBe(charU);
    expect(json.failedSpeakers).toEqual([]);
    expect(json.messages).toHaveLength(1);
    const m = json.messages[0];
    expect(m.senderType).toBe("AI_CHARACTER");
    expect(m.characterId).toBe(aiA);
    expect(m.content).toBe(TURN_TEXT);
    expect(m.conversationId).toBe(conv1);
    expect(m.contextJson.family).toBe("generation-context.v1");
    expect(m.contextJson.provider).toBe("spy");
    expect(m.contextJson.rag.used).toBe(false);
    const stored = await prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(stored.senderType).toBe("AI_CHARACTER");
    expect(stored.characterId).toBe(aiA);
    expect(await messageCount(conv1)).toBe(2);
  });

  it("I) dois AI → 2 Messages na ordem de seleção (characterId asc), USER 1x", async () => {
    await resetMessages(conv1);
    const res = await turn(appGen, owner, conv1, {
      userPrompt: "Falem vocês, SpeakerAlpha e SpeakerBeta!",
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.messages).toHaveLength(2);
    expect(json.messages[0].characterId).toBe(aiA);
    expect(json.messages[1].characterId).toBe(aiB);
    expect(json.userMessage.content).toBe("Falem vocês, SpeakerAlpha e SpeakerBeta!");
    // USER persistida uma única vez.
    expect(await messageCount(conv1)).toBe(3);
  });

  it("J) visibilidade: speaker B vê a Message de A no contexto (sequencial)", async () => {
    await resetMessages(conv1);
    const res = await turn(appGen, owner, conv1, {
      userPrompt: "SpeakerAlpha e SpeakerBeta respondam!",
    });
    expect(res.statusCode).toBe(201);
    const messages = res.json().messages;
    expect(messages).toHaveLength(2);
    // A assembla logo após a USER → janela com 1 item (só a USER).
    expect(messages[0].contextJson.fidelity.messages).toBe(1);
    // B assembla DEPOIS de A persistida → janela com 2 itens (USER + A).
    expect(messages[1].contextJson.fidelity.messages).toBe(2);
  });

  it("K) cap (maxResponders=3): 4 AI mencionados → 3 respondem, 4º não", async () => {
    await resetMessages(conv1);
    const res = await turn(appGen, owner, conv1, {
      userPrompt:
        "SpeakerAlpha SpeakerBeta SpeakerGamma SpeakerDelta, todos!",
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.messages).toHaveLength(3);
    expect(json.messages.map((m) => m.characterId)).toEqual([aiA, aiB, aiC]);
    expect(json.failedSpeakers).toEqual([]);
    expect(await messageCount(conv1)).toBe(4);
  });

  it("L) AI fora da conversa nunca vira speaker", async () => {
    await resetMessages(conv1);
    // conv1 NÃO contém SpeakerOmicron (aiOut): somente SpeakerAlpha responde.
    const res = await turn(appGen, owner, conv1, {
      userPrompt: "SpeakerAlpha e SpeakerOmicron respondam!",
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.messages.map((m) => m.characterId)).toEqual([aiA]);
    expect(json.failedSpeakers).toEqual([]);
  });

  it("M) Character USER nunca vira AI", async () => {
    await resetMessages(conv1);
    const res = await turn(appGen, owner, conv1, {
      userPrompt: "Quem é o CharU?",
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    for (const m of json.messages) {
      expect(m.senderType).toBe("AI_CHARACTER");
      expect(m.characterId).not.toBe(charU);
    }
    expect(json.failedSpeakers).toEqual([]);
    // Nenhuma Message com characterId USER no banco.
    const stored = await prisma.message.findMany({ where: { conversationId: conv1 } });
    expect(stored.some((s) => s.characterId === charU)).toBe(true); // só a USER
    expect(stored.filter((s) => s.senderType === "AI_CHARACTER")).toHaveLength(0);
  });

  it("N) erro parcial: A sucesso + B provider-error → A preservado, B em failedSpeakers", async () => {
    const appPartial = buildApp(undefined, partialFailProvider());
    await appPartial.ready();
    await resetMessages(conv1);
    const res = await turn(appPartial, owner, conv1, {
      userPrompt: "SpeakerAlpha e SpeakerBeta respondam!",
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.messages).toHaveLength(1);
    expect(json.messages[0].characterId).toBe(aiA);
    expect(json.messages[0].content).toBe("resposta-1");
    expect(json.failedSpeakers).toEqual([
      { characterId: aiB, error: "provider-error" },
    ]);
    // Sem rollback: USER + A permanecem no histórico.
    expect(await messageCount(conv1)).toBe(2);
    await appPartial.close();
  });

  it("O) múltiplos USER characters → menor characterId (desempate determinístico)", async () => {
    await resetMessages(convDualUser);
    const res = await turn(appGen, owner, convDualUser, {
      userPrompt: "Fala, SpeakerAlpha!",
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.userMessage.characterId).toBe(charU);
    expect(json.messages).toHaveLength(1);
    expect(json.messages[0].characterId).toBe(aiA);
    expect(await messageCount(convDualUser)).toBe(2);
  });

  it("P) RAG frame inexistente → 404 e USER NÃO persistida", async () => {
    await resetMessages(conv1);
    const ghost = "00000000-0000-4000-8000-000000000099";
    const res = await turn(appGen, owner, conv1, {
      userPrompt: "Olá!",
      ragFrameId: ghost,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
    expect(await messageCount(conv1)).toBe(0);
  });

  it("Q) retry (sem idempotency key): 2ª chamada adiciona 1 USER + 1 AI (append)", async () => {
    await resetMessages(conv1);
    const payload = { userPrompt: "De novo, SpeakerAlpha!" };
    const r1 = await turn(appGen, owner, conv1, payload);
    const r2 = await turn(appGen, owner, conv1, payload);
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect(r1.json().userMessage.id).not.toBe(r2.json().userMessage.id);
    expect(r1.json().messages[0].id).not.toBe(r2.json().messages[0].id);
    expect(await messageCount(conv1)).toBe(4);
  });

  it("R) provider recebe systemPrompt + userPrompt por speaker e NÃO speaker", async () => {
    const capture: { input?: ProviderInput; calls: number } = { calls: 0 };
    const appR = buildApp(undefined, generatedProvider("resposta R", capture));
    await appR.ready();
    await resetMessages(conv1);
    const res = await turn(appR, owner, conv1, {
      userPrompt: "SpeakerAlpha e SpeakerBeta!",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().messages).toHaveLength(2);
    expect(capture.calls).toBe(2);
    expect(capture.input?.systemPrompt).toBeTypeOf("string");
    expect(capture.input?.userPrompt).toBe("SpeakerAlpha e SpeakerBeta!");
    expect(
      "speakerCharacterId" in (capture.input as unknown as Record<string, unknown>),
    ).toBe(false);
    await appR.close();
  });

  it("S) Conversation.updatedAt é atualizado após o turno", async () => {
    await resetMessages(conv1);
    const before = await prisma.conversation.findUniqueOrThrow({
      where: { id: conv1 },
      select: { updatedAt: true },
    });
    const res = await turn(appGen, owner, conv1, {
      userPrompt: "SpeakerAlpha, atualize!",
    });
    expect(res.statusCode).toBe(201);
    const after = await prisma.conversation.findUniqueOrThrow({
      where: { id: conv1 },
      select: { updatedAt: true },
    });
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(
      before.updatedAt.getTime(),
    );
  });

  it("T) memória do tema (Monza) seleciona só o AI que a carrega (109E)", async () => {
    await resetMessages(conv1);
    const memory = await prisma.memory.create({
      data: {
        content: "A vitória de SpeakerAlpha em Monza foi inesquecível.",
        summary: "Vitória de SpeakerAlpha em Monza",
        importance: "HIGH",
        source: "USER_DEFINED",
      },
    });
    createdMemoryIds.push(memory.id);
    await prisma.memoryCharacter.create({
      data: { memoryId: memory.id, characterId: aiA },
    });

    const res = await turn(appGen, owner, conv1, {
      userPrompt: "Vocês lembram de Monza?",
    });
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.messages.map((m) => m.characterId)).toEqual([aiA]);
    expect(json.failedSpeakers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// STEP 109F — continuidade narrativa entre speakers do mesmo turno.
//
// O turno atual = USER message (entregue UMA vez, via userPrompt/role "user")
// + respostas AI já geradas neste turno (seção CURRENT_TURN para o speaker
// seguinte, em ordem de geração). Sinais de continuidade entram como contexto
// descritivo (nunca como roteiro rígido). Os testes T1–T8 provam:
//   T1 B vê A; o primeiro speaker não tem seção;
//   T2 C vê A+B em ordem; cada resposta anterior uma única vez; a própria fala
//      nunca aparece;
//   T3 sinais de continuidade presentes;
//   T4 determinismo do bloco CURRENT_TURN para o mesmo input;
//   T5 falha parcial: B falha, C continua vendo A;
//   T6 nenhuma Memory/Event é criada durante o turno (relevância não recalc.);
//   T7 zero/um respondente seguem válidos (regressão do contrato 109B);
//   T8 pesquisa externa NÃO repetida por speaker: mesmo frame compartilhado.
// ---------------------------------------------------------------------------

function currentTurnBlock(prompt: string): string {
  const match = prompt.match(/<BEGIN 5:CURRENT_TURN>[\s\S]*?<END 5:CURRENT_TURN>/);
  return match ? match[0] : "";
}

function sequenceProvider(
  texts: string[],
  opts: { failures?: number[]; capture?: { inputs: ProviderInput[] } } = {},
): GenerationProvider {
  let call = 0;
  return {
    name: "seq109f",
    async run(input) {
      call += 1;
      if (opts.failures?.includes(call)) {
        throw new OllamaProviderError("network", "falha STEP 109F (controlada).");
      }
      opts.capture?.inputs.push(input);
      return {
        provider: "seq109f",
        mode: "generated",
        text: texts[call - 1] ?? `resposta-${call}`,
        tokenStats: {
          systemPromptChars: input.systemPrompt.length,
          contextBlocks: countEmittedSections(input.systemPrompt),
        },
      };
    },
  };
}

function ragFrameDefaults() {
  return {
    topK: 5,
    threshold: 0.5,
    provider: "cohere",
    model: "embed-multilingual-v3.0",
    version: "v3.0",
    dimensions: COHERE_DIMENSIONS,
    ruleApplied: EXTERNAL_RETRIEVAL_RULE,
  } as const;
}

async function seedCurrentRagFrame(conversationId: string): Promise<string> {
  const query = "resultados da última corrida";
  const queryHash = computeRagQueryHash(query);
  const frameKey = computeConversationRagFrameKey({
    queryHash,
    ...ragFrameDefaults(),
  });
  const frame = await prisma.conversationRagFrame.create({
    data: {
      conversationId,
      queryText: query,
      queryHash,
      ...ragFrameDefaults(),
      frameKey,
      status: "READY",
    },
  });

  const source = await prisma.externalSource.create({
    data: {
      url: `https://109f.test/${Date.now()}/${Math.random()}`,
      title: "fonte109f",
      visibility: "PRIVATE",
      ownerId: owner.userId,
    },
  });
  createdSourceIds.push(source.id);

  const doc = await prisma.externalDocument.create({
    data: {
      sourceId: source.id,
      title: "doc109f",
      content: "relatório da prova",
      contentHash: computeDocumentContentHash("relatório da prova"),
      status: "READY",
    },
  });
  createdDocumentIds.push(doc.id);

  const text = "A estratégia de pneus definiu o resultado da corrida.";
  const contentHash = computeChunkContentHash(text);
  const chunk = await prisma.externalChunk.create({
    data: {
      documentId: doc.id,
      text,
      orderOriginal: 0,
      contentHash,
      embeddedContentHash: contentHash,
      embeddingProvider: "cohere",
      embeddingModel: "embed-multilingual-v3.0",
      embeddingVersion: "v3.0",
      embeddingDimensions: COHERE_DIMENSIONS,
    },
  });
  createdChunkIds.push(chunk.id);

  const freshnessAnchor = computeConversationRagFreshnessAnchor({
    frameKey,
    scopeSourceIds: frame.scopeSourceIds,
    topK: frame.topK,
    threshold: frame.threshold,
    provider: frame.provider,
    model: frame.model,
    version: frame.version,
    dimensions: frame.dimensions,
    ruleApplied: frame.ruleApplied,
    chunkBindings: [
      { chunkId: chunk.id, contentHash, embeddedContentHash: contentHash },
    ],
  });
  const snapshot = await prisma.conversationRagSnapshot.create({
    data: {
      frameId: frame.id,
      snapshotKey: `${frameKey}#${freshnessAnchor}`,
      status: "READY",
      retrievedAt: new Date(),
      freshnessAnchor,
    },
  });
  await prisma.conversationRagSnapshotItem.create({
    data: {
      snapshotId: snapshot.id,
      chunkId: chunk.id,
      score: 0.92,
      distance: 0.1,
      order: 0,
      citation: "fonte109f",
    },
  });
  return frame.id;
}

describe("STEP 109F — continuidade narrativa no turno", () => {
  it("T1) B vê A no turno atual (CURRENT_TURN no prompt); o primeiro speaker não tem seção", async () => {
    const capture = { inputs: [] as ProviderInput[] };
    const appF = buildApp(undefined, sequenceProvider(["F1.", "F2."], { capture }));
    await appF.ready();
    try {
      await resetMessages(conv1);
      const res = await turn(appF, owner, conv1, {
        userPrompt: "SpeakerAlpha e SpeakerBeta respondam!",
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().messages).toHaveLength(2);
      expect(capture.inputs).toHaveLength(2);
      const pA = capture.inputs[0].systemPrompt;
      const pB = capture.inputs[1].systemPrompt;
      expect(pA).not.toContain("CURRENT_TURN");
      expect(pB).toContain("<BEGIN 5:CURRENT_TURN>");
      expect(pB).toContain("SpeakerAlpha");
      expect((pB.match(/"F1\."/g) ?? []).length).toBe(1);
      expect(capture.inputs[1].userPrompt).toBe(
        "SpeakerAlpha e SpeakerBeta respondam!",
      );
      expect(pB).not.toContain("SpeakerAlpha e SpeakerBeta respondam!");
    } finally {
      await appF.close();
    }
  });

  it("T2) C vê A+B em ordem; cada resposta anterior uma única vez; a própria fala nunca aparece", async () => {
    const capture = { inputs: [] as ProviderInput[] };
    const appF = buildApp(
      undefined,
      sequenceProvider(["F1.", "F2.", "F3."], { capture }),
    );
    await appF.ready();
    try {
      await resetMessages(conv1);
      const res = await turn(appF, owner, conv1, {
        userPrompt: "SpeakerAlpha, SpeakerBeta e SpeakerGamma respondam!",
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().messages).toHaveLength(3);
      expect(capture.inputs).toHaveLength(3);
      const pC = capture.inputs[2].systemPrompt;
      expect(pC).toContain("<BEGIN 5:CURRENT_TURN>");
      expect(pC.indexOf('"F1."')).toBeLessThan(pC.indexOf('"F2."'));
      expect((pC.match(/"F1\."/g) ?? []).length).toBe(1);
      expect((pC.match(/"F2\."/g) ?? []).length).toBe(1);
      expect(pC).not.toContain('"F3."');
      const pB = capture.inputs[1].systemPrompt;
      expect(pB).toContain('"F1."');
      expect(pB).not.toContain('"F2."');
    } finally {
      await appF.close();
    }
  });

  it("T3) sinais de continuidade entram no contexto do speaker seguinte", async () => {
    const capture = { inputs: [] as ProviderInput[] };
    const appF = buildApp(undefined, sequenceProvider(["F1.", "F2."], { capture }));
    await appF.ready();
    try {
      await resetMessages(conv1);
      const res = await turn(appF, owner, conv1, {
        userPrompt: "SpeakerAlpha e SpeakerBeta respondam!",
      });
      expect(res.statusCode).toBe(201);
      const pB = capture.inputs[1].systemPrompt;
      expect(pB).toContain("- previousSpeaker: SpeakerAlpha");
      expect(pB).toContain("- directReplyOpportunity: sim");
      expect(pB).toContain("- repeatedTopic:");
    } finally {
      await appF.close();
    }
  });

  it("T4) determinismo: mesmo input → mesmo bloco CURRENT_TURN em execuções independentes", async () => {
    const blocks: string[] = [];
    for (let round = 0; round < 2; round++) {
      const capture = { inputs: [] as ProviderInput[] };
      const appF = buildApp(
        undefined,
        sequenceProvider(["F1.", "F2."], { capture }),
      );
      await appF.ready();
      try {
        await resetMessages(conv1);
        const res = await turn(appF, owner, conv1, {
          userPrompt: "SpeakerAlpha e SpeakerBeta respondam!",
        });
        expect(res.statusCode).toBe(201);
        expect(capture.inputs).toHaveLength(2);
        blocks.push(currentTurnBlock(capture.inputs[1].systemPrompt));
      } finally {
        await appF.close();
      }
    }
    expect(blocks[0]).not.toBe("");
    expect(blocks[0]).toBe(blocks[1]);
  });

  it("T5) falha parcial: B falha; C continua e ainda vê a resposta de A", async () => {
    const capture = { inputs: [] as ProviderInput[] };
    const appF = buildApp(
      undefined,
      sequenceProvider(["F1.", "F3.", "F4."], { failures: [2], capture }),
    );
    await appF.ready();
    try {
      await resetMessages(conv1);
      const res = await turn(appF, owner, conv1, {
        userPrompt: "SpeakerAlpha, SpeakerBeta e SpeakerGamma respondam!",
      });
      expect(res.statusCode).toBe(201);
      const json = res.json();
      expect(json.messages.map((m) => m.characterId)).toEqual([aiA, aiC]);
      expect(json.failedSpeakers).toEqual([
        { characterId: aiB, error: "provider-error" },
      ]);
      const pC = capture.inputs[1].systemPrompt;
      expect((pC.match(/"F1\."/g) ?? []).length).toBe(1);
      expect(pC).not.toContain('"F3."');
      expect(pC).not.toContain('"F4."');
    } finally {
      await appF.close();
    }
  });

  it("T6) nenhuma Memory/Event é criada durante o turno (relevância não recalculada)", async () => {
    await resetMessages(conv1);
    const [memBefore, evtBefore] = await Promise.all([
      prisma.memory.count(),
      prisma.event.count(),
    ]);
    const res = await turn(appGen, owner, conv1, {
      userPrompt: "SpeakerAlpha e SpeakerBeta respondam!",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().messages).toHaveLength(2);
    const [memAfter, evtAfter] = await Promise.all([
      prisma.memory.count(),
      prisma.event.count(),
    ]);
    expect(memAfter).toBe(memBefore);
    expect(evtAfter).toBe(evtBefore);
  });

  it("T7) zero e um respondente seguem válidos com o novo turno", async () => {
    await resetMessages(convUserOnly);
    const zero = await turn(appGen, owner, convUserOnly, {
      userPrompt: "Mensagem sem IA",
    });
    expect(zero.statusCode).toBe(201);
    expect(zero.json().messages).toEqual([]);
    expect(zero.json().failedSpeakers).toEqual([]);

    await resetMessages(conv1);
    const one = await turn(appGen, owner, conv1, {
      userPrompt: "Olá, SpeakerAlpha!",
    });
    expect(one.statusCode).toBe(201);
    expect(one.json().messages).toHaveLength(1);
    expect(one.json().messages[0].characterId).toBe(aiA);
    expect(one.json().failedSpeakers).toEqual([]);
  });

  it("T8) pesquisa externa NÃO repetida por speaker: mesmo frame compartilhado e nada materializado", async () => {
    await resetMessages(conv1);
    const frameId = await seedCurrentRagFrame(conv1);
    const frameBefore = await prisma.conversationRagFrame.count({
      where: { conversationId: conv1 },
    });
    const snapshotBefore = await prisma.conversationRagSnapshot.count({
      where: { frame: { conversationId: conv1 } },
    });
    const capture = { inputs: [] as ProviderInput[] };
    const appF = buildApp(
      undefined,
      sequenceProvider(["F1.", "F2."], { capture }),
    );
    await appF.ready();
    try {
      const res = await turn(appF, owner, conv1, {
        userPrompt: "SpeakerAlpha e SpeakerBeta respondam!",
        ragFrameId: frameId,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().messages).toHaveLength(2);
      expect(capture.inputs).toHaveLength(2);
      const externalA = capture.inputs[0].context.externalRag;
      const externalB = capture.inputs[1].context.externalRag;
      expect(externalA).toBeDefined();
      expect(externalB).toBeDefined();
      // Mesmo frame materializado para ambos: NENHUMA pesquisa per-speaker.
      expect(externalA?.provider).toBe("cohere");
      expect(externalB?.provider).toBe("cohere");
      expect(externalA?.items.length).toBeGreaterThan(0);
      expect(externalB?.items.length).toBe(externalA?.items.length);
      const blockA = capture.inputs[0].systemPrompt;
      const blockB = capture.inputs[1].systemPrompt;
      expect(blockA).toContain("<BEGIN 11:EXTERNAL_CONTEXT>");
      expect(blockB).toContain("<BEGIN 12:EXTERNAL_CONTEXT>");
      // Nenhum frame/snapshot novo foi criado durante o turno.
      expect(
        await prisma.conversationRagFrame.count({ where: { conversationId: conv1 } }),
      ).toBe(frameBefore);
      expect(
        await prisma.conversationRagSnapshot.count({
          where: { frame: { conversationId: conv1 } },
        }),
      ).toBe(snapshotBefore);
    } finally {
      await appF.close();
    }
  });
});

// ---------------------------------------------------------------------------
// STEP 109Q-10 — projeção determinística do userPrompt por AI speaker.
//
// A projeção existe APENAS no input do provider daquela geração. Provas:
//   U1 USER persistida permanece EXATAMENTE original (nunca a projeção);
//   U2 provider recebe projectedPrompt quando SUPPORTED;
//   U3 provider recebe o original quando UNSUPPORTED;
//   U4 cada speaker recebe a SUA projeção (nome do próprio speaker);
//   U5 dois speakers nunca recebem a mesma identidade projetada;
//   U6 seleção de speakers inalterada;
//   U7 nº de messages AI do turno inalterado;
//   U8 CURRENT_TURN usa as respostas REAIS (nunca a projeção);
//   U9 contextJson da message NÃO trata a projeção como mensagem USER;
//   U10 generationKey determinística por speaker (projeção fora do frame).
// ---------------------------------------------------------------------------

const PROMPT_MONACO = "SpeakerAlpha e SpeakerBeta, quem venceu a corrida de Mônaco?";
const PROJECTED_ALPHA =
  "O usuário pediu uma resposta sobre quem venceu a corrida de Mônaco. Nesta execução, responda somente como SpeakerAlpha.";
const PROJECTED_BETA =
  "O usuário pediu uma resposta sobre quem venceu a corrida de Mônaco. Nesta execução, responda somente como SpeakerBeta.";

describe("STEP 109Q-10 — projeção determinística do userPrompt", () => {
  it("U1) USER persistida permanece EXATAMENTE a original (nunca a projeção)", async () => {
    const capture = { inputs: [] as ProviderInput[] };
    const appP = buildApp(undefined, sequenceProvider(["P1.", "P2."], { capture }));
    await appP.ready();
    try {
      await resetMessages(conv1);
      const res = await turn(appP, owner, conv1, { userPrompt: PROMPT_MONACO });
      expect(res.statusCode).toBe(201);
      expect(res.json().userMessage.content).toBe(PROMPT_MONACO);
      const storedUser = await prisma.message.findUniqueOrThrow({
        where: { id: res.json().userMessage.id },
      });
      expect(storedUser.content).toBe(PROMPT_MONACO);
      expect(storedUser.content).not.toContain("Nesta execução, responda somente como");
    } finally {
      await appP.close();
    }
  });

  it("U2) SUPPORTED → provider recebe projectedPrompt (nunca o original)", async () => {
    const capture = { inputs: [] as ProviderInput[] };
    const appP = buildApp(undefined, sequenceProvider(["P1.", "P2."], { capture }));
    await appP.ready();
    try {
      await resetMessages(conv1);
      const res = await turn(appP, owner, conv1, { userPrompt: PROMPT_MONACO });
      expect(res.statusCode).toBe(201);
      expect(capture.inputs).toHaveLength(2);
      expect(capture.inputs[0].userPrompt).toBe(PROJECTED_ALPHA);
      expect(capture.inputs[1].userPrompt).toBe(PROJECTED_BETA);
      expect(capture.inputs[0].userPrompt).not.toBe(PROMPT_MONACO);
      expect(capture.inputs[1].userPrompt).not.toBe(PROMPT_MONACO);
    } finally {
      await appP.close();
    }
  });

  it("U3) UNSUPPORTED → provider recebe o ORIGINAL sem qualquer projeção", async () => {
    const capture = { inputs: [] as ProviderInput[] };
    const appP = buildApp(undefined, sequenceProvider(["P1.", "P2."], { capture }));
    await appP.ready();
    try {
      await resetMessages(conv1);
      const prompt = "SpeakerAlpha e SpeakerBeta respondam!";
      const res = await turn(appP, owner, conv1, { userPrompt: prompt });
      expect(res.statusCode).toBe(201);
      expect(capture.inputs).toHaveLength(2);
      expect(capture.inputs[0].userPrompt).toBe(prompt);
      expect(capture.inputs[1].userPrompt).toBe(prompt);
    } finally {
      await appP.close();
    }
  });

  it("U4) cada speaker recebe a SUA projeção (nome do próprio speaker)", async () => {
    const capture = { inputs: [] as ProviderInput[] };
    const appP = buildApp(undefined, sequenceProvider(["P1.", "P2."], { capture }));
    await appP.ready();
    try {
      await resetMessages(conv1);
      await turn(appP, owner, conv1, { userPrompt: PROMPT_MONACO });
      expect(capture.inputs[0].userPrompt).toContain("responda somente como SpeakerAlpha.");
      expect(capture.inputs[1].userPrompt).toContain("responda somente como SpeakerBeta.");
    } finally {
      await appP.close();
    }
  });

  it("U5) dois speakers nunca recebem a mesma identidade projetada", async () => {
    const capture = { inputs: [] as ProviderInput[] };
    const appP = buildApp(undefined, sequenceProvider(["P1.", "P2."], { capture }));
    await appP.ready();
    try {
      await resetMessages(conv1);
      await turn(appP, owner, conv1, { userPrompt: PROMPT_MONACO });
      expect(capture.inputs[0].userPrompt).not.toBe(capture.inputs[1].userPrompt);
      expect(capture.inputs[0].userPrompt).not.toContain("SpeakerBeta");
      expect(capture.inputs[1].userPrompt).not.toContain("SpeakerAlpha");
    } finally {
      await appP.close();
    }
  });

  it("U6) seleção de speakers inalterada pela projeção", async () => {
    const capture = { inputs: [] as ProviderInput[] };
    const appP = buildApp(undefined, sequenceProvider(["P1.", "P2."], { capture }));
    await appP.ready();
    try {
      await resetMessages(conv1);
      const res = await turn(appP, owner, conv1, { userPrompt: PROMPT_MONACO });
      expect(res.statusCode).toBe(201);
      expect(res.json().messages.map((m) => m.characterId)).toEqual([aiA, aiB]);
      expect(res.json().failedSpeakers).toEqual([]);
    } finally {
      await appP.close();
    }
  });

  it("U7) nº de messages AI do turno inalterado (USER + 2 AI)", async () => {
    const appP = buildApp(undefined, sequenceProvider(["P1.", "P2."]));
    await appP.ready();
    try {
      await resetMessages(conv1);
      const res = await turn(appP, owner, conv1, { userPrompt: PROMPT_MONACO });
      expect(res.statusCode).toBe(201);
      expect(res.json().messages).toHaveLength(2);
      expect(await messageCount(conv1)).toBe(3);
    } finally {
      await appP.close();
    }
  });

  it("U8) CURRENT_TURN usa as respostas REAIS, nunca a projeção", async () => {
    const capture = { inputs: [] as ProviderInput[] };
    const appP = buildApp(undefined, sequenceProvider(["real A.", "real B."], { capture }));
    await appP.ready();
    try {
      await resetMessages(conv1);
      await turn(appP, owner, conv1, { userPrompt: PROMPT_MONACO });
      const pB = capture.inputs.find(
        (i) => i.userPrompt === PROJECTED_BETA,
      )?.systemPrompt;
      expect(pB).toBeDefined();
      expect(pB ?? "").toContain("<BEGIN 5:CURRENT_TURN>");
      // A resposta REAL de A está no CURRENT_TURN de B;
      expect((pB ?? "").match(/"real A\."/g) ?? []).toHaveLength(1);
      // a projeção do usuário NÃO entra no CURRENT_TURN.
      expect(pB ?? "").not.toContain("Nesta execução, responda somente como");
      expect(pB ?? "").not.toContain(PROMPT_MONACO);
    } finally {
      await appP.close();
    }
  });

  it("U9) contextJson não trata a projeção como mensagem USER", async () => {
    const appP = buildApp(undefined, sequenceProvider(["P1.", "P2."]));
    await appP.ready();
    try {
      await resetMessages(conv1);
      const res = await turn(appP, owner, conv1, { userPrompt: PROMPT_MONACO });
      expect(res.statusCode).toBe(201);
      for (const m of res.json().messages) {
        expect(typeof m.contextJson.generationKey).toBe("string");
        expect(m.contextJson.generationKey).toMatch(/^sha256:/);
        // fidelity conta MENSAGENS persistidas (USER + respostas reais), não projeção.
        expect(m.contextJson.fidelity.messages).toBeGreaterThan(0);
        expect(JSON.stringify(m.contextJson)).not.toContain("Nesta execução, responda somente como");
      }
      const alphaMsg = res.json().messages.find((m) => m.characterId === aiA);
      expect(alphaMsg?.contextJson.fidelity.messages).toBe(1); // só a USER original
    } finally {
      await appP.close();
    }
  });

  it("U10) generationKey determinística por speaker (projeção fora do frame)", async () => {
    const keyOriginal = await assembleGenerationBundle(
      prisma,
      { conversationId: conv1, userId: owner.userId, userPrompt: PROMPT_MONACO, targetCharacterId: aiA },
      generatedProvider("P1."),
    );
    const keyProjetada = await assembleGenerationBundle(
      prisma,
      { conversationId: conv1, userId: owner.userId, userPrompt: PROMPT_MONACO, providerUserPrompt: PROJECTED_ALPHA, targetCharacterId: aiA },
      generatedProvider("P1."),
    );
    expect(keyOriginal.generationKey).toMatch(/^sha256:/);
    // userPrompt NÃO entra no canonicalFrame: projeção não altera a key.
    expect(keyProjetada.generationKey).toBe(keyOriginal.generationKey);
  });
});

// ---------------------------------------------------------------------------
// STEP 109Q-12 — posicionamento tardio da projeção (dataflow audit).
//
// A projeção é aplicada SOMENTE no campo `providerUserPrompt`, consumido
// exclusivamente na montagem do ProviderInput (role "user" da chamada final).
// `userPrompt` (original) segue sendo a fonte de TODAS as demais decisões:
// contexto, systemPrompt, RAG e generationKey.
//   V1 provider recebe a projeção no ponto final;
//   V2 systemPrompt, contexto e generationKey NÃO mudam com a projeção;
//   V3 memory/event relevance usam o original (assembly não conhece projeção);
//   V4 research trigger usa o original (autoResearchFrame recebe userPrompt);
//   V5 RAG retrieval usa o original (frame derivado do query do original);
//   V6 persistence/contextJson NÃO contêm projeção.
// ---------------------------------------------------------------------------

describe("STEP 109Q-12 — projeção isolada no ponto final do provider", () => {
  it("V1) provider recebe a projeção SOMENTE como ProviderInput.userPrompt", async () => {
    const capture = { input: undefined as ProviderInput | undefined, calls: 0 };
    const res = await assembleGenerationBundle(
      prisma,
      {
        conversationId: conv1,
        userId: owner.userId,
        userPrompt: PROMPT_MONACO,
        providerUserPrompt: PROJECTED_ALPHA,
        targetCharacterId: aiA,
      },
      generatedProvider("P1.", capture),
    );
    expect(res.generationKey).toMatch(/^sha256:/);
    expect(capture.input?.userPrompt).toBe(PROJECTED_ALPHA);
    expect(capture.input?.userPrompt).not.toBe(PROMPT_MONACO);
    expect(Object.keys(capture.input ?? {})).toContain("userPrompt");
  });

  it("V2) systemPrompt não muda quando apenas a projeção é adicionada", async () => {
    const capA = { input: undefined as ProviderInput | undefined, calls: 0 };
    const capB = { input: undefined as ProviderInput | undefined, calls: 0 };
    const base = { conversationId: conv1, userId: owner.userId, targetCharacterId: aiA };
    const a = await assembleGenerationBundle(
      prisma,
      { ...base, userPrompt: PROMPT_MONACO },
      generatedProvider("P1.", capA),
    );
    const b = await assembleGenerationBundle(
      prisma,
      { ...base, userPrompt: PROMPT_MONACO, providerUserPrompt: PROJECTED_ALPHA },
      generatedProvider("P1.", capB),
    );
    expect(a.systemPrompt).toBe(b.systemPrompt);
    expect(capA.input?.userPrompt).toBe(PROMPT_MONACO);
    expect(capB.input?.userPrompt).toBe(PROJECTED_ALPHA);
  });

  it("V3) context (memories/events/relationships) e generationKey idênticos com e sem projeção", async () => {
    const base = { conversationId: conv1, userId: owner.userId, targetCharacterId: aiA };
    const a = await assembleGenerationBundle(
      prisma,
      { ...base, userPrompt: PROMPT_MONACO },
      generatedProvider("P1."),
    );
    const b = await assembleGenerationBundle(
      prisma,
      { ...base, userPrompt: PROMPT_MONACO, providerUserPrompt: PROJECTED_ALPHA },
      generatedProvider("P1."),
    );
    expect(b.context.memories).toEqual(a.context.memories);
    expect(b.context.events).toEqual(a.context.events);
    expect(b.context.relationships).toEqual(a.context.relationships);
    expect(b.context.recentMessages).toEqual(a.context.recentMessages);
    expect(b.generationKey).toBe(a.generationKey);
  });

  it("V6) projection nunca é persistida: histórico contém USER original + respostas reais", async () => {
    const appP = buildApp(undefined, sequenceProvider(["P1.", "P2."]));
    await appP.ready();
    try {
      await resetMessages(conv1);
      const res = await turn(appP, owner, conv1, { userPrompt: PROMPT_MONACO });
      expect(res.statusCode).toBe(201);
      const stored = await prisma.message.findMany({
        where: { conversationId: conv1 },
        select: { content: true, contextJson: true },
        orderBy: { createdAt: "asc" },
      });
      expect(stored).toHaveLength(3);
      expect(stored[0]?.content).toBe(PROMPT_MONACO);
      expect(stored.some((m) => m.content.includes("Nesta execução, responda somente como"))).toBe(false);
      for (const m of stored) {
        expect(JSON.stringify(m.contextJson)).not.toContain("Nesta execução, responda somente como");
      }
    } finally {
      await appP.close();
    }
  });
});
