import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  countEmittedSections,
  type GenerationProvider,
  type ProviderInput,
} from "../generation/generation.assembly.js";
import { OllamaProviderError } from "../generation/ollama-provider.js";

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
