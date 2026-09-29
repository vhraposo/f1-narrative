import type { FastifyInstance } from "fastify";
import { afterAll, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import type {
  GenerationProvider,
  ProviderAbortSignal,
  ProviderInput,
  ProviderOutput,
  ProviderStreamHandlers,
} from "../generation/generation.assembly.js";
import { OllamaProviderError } from "../generation/ollama-provider.js";
import { getActiveStreamCount } from "./conversation-turn-stream.routes.js";

type TestUser = { cookie: string; userId: string };
type SseEvent = { event: string; data: Record<string, unknown> };

const createdUserIds: string[] = [];
const createdConversationIds: string[] = [];

function stats(input: ProviderInput) {
  return {
    systemPromptChars: input.systemPrompt.length,
    contextBlocks: 1,
  };
}

type ProviderConfig = {
  deltas: string[];
  delayMs?: number;
  failAtDelta?: number;
  failError?: Error;
  withoutStream?: boolean;
  onSignal?: (signal: ProviderAbortSignal | undefined) => void;
};

function fakeProvider(config: ProviderConfig): GenerationProvider {
  const text = config.deltas.join("");
  const base: GenerationProvider = {
    name: "fake-stream",
    async run(input): Promise<ProviderOutput> {
      return {
        provider: "fake-stream",
        mode: "generated",
        text,
        tokenStats: stats(input),
      };
    },
  };
  if (config.withoutStream) return base;

  return {
    ...base,
    async runStream(
      input: ProviderInput,
      handlers: ProviderStreamHandlers,
    ): Promise<ProviderOutput> {
      config.onSignal?.(handlers.signal);
      for (let index = 0; index < config.deltas.length; index += 1) {
        if (handlers.signal?.aborted) {
          throw new OllamaProviderError("abort", "stream abortado");
        }
        if (config.delayMs) {
          await new Promise((resolve) => setTimeout(resolve, config.delayMs));
        }
        if (config.failAtDelta !== undefined && index === config.failAtDelta) {
          throw config.failError ?? new OllamaProviderError("network", "falha simulada");
        }
        handlers.onDelta(config.deltas[index]);
      }
      if (handlers.signal?.aborted) {
        throw new OllamaProviderError("abort", "stream abortado");
      }
      return {
        provider: "fake-stream",
        mode: "generated",
        text,
        tokenStats: stats(input),
      };
    },
  };
}

async function startApp(provider: GenerationProvider): Promise<{
  app: FastifyInstance;
  base: string;
}> {
  const app = buildApp(undefined, provider);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("endereço inválido");
  }
  return { app, base: `http://127.0.0.1:${address.port}` };
}

async function signUp(app: FastifyInstance, name: string): Promise<TestUser> {
  const email = `sse-${name}-${Date.now()}-${Math.random()}@f1nw.test`;
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name, email, password: "senha-segura-123" },
  });
  expect(response.statusCode).toBe(200);
  const cookie = response.cookies
    .map((item) => `${item.name}=${item.value}`)
    .join("; ");
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  createdUserIds.push(user.id);
  return { cookie, userId: user.id };
}

async function createConversationFixture(
  userId: string,
  aiName = "SpeakerAlpha",
): Promise<{ conversationId: string; userCharacterId: string; aiCharacterId: string }> {
  const userCharacter = await prisma.character.create({
    data: {
      name: `UserChar ${Math.random()}`,
      nationality: "Brazil",
      birthDate: new Date("2000-01-01"),
      userId,
      controlledBy: "USER",
    },
  });
  const aiCharacter = await prisma.character.create({
    data: {
      name: aiName,
      nationality: "Brazil",
      birthDate: new Date("2000-01-01"),
      userId,
      controlledBy: "AI",
    },
  });
  const conversation = await prisma.conversation.create({
    data: { type: "GROUP", title: "SSE" },
  });
  createdConversationIds.push(conversation.id);
  await prisma.conversationParticipant.createMany({
    data: [
      { conversationId: conversation.id, characterId: userCharacter.id },
      { conversationId: conversation.id, characterId: aiCharacter.id },
    ],
  });
  return {
    conversationId: conversation.id,
    userCharacterId: userCharacter.id,
    aiCharacterId: aiCharacter.id,
  };
}

async function seedSecretMemory(aiCharacterId: string): Promise<void> {
  const memory = await prisma.memory.create({
    data: {
      content: "MEMORIA_SECRETA_XYZ",
      source: "USER_DEFINED",
      importance: "LOW",
    },
  });
  await prisma.memoryCharacter.create({
    data: { memoryId: memory.id, characterId: aiCharacterId },
  });
}

function parseFrame(frame: string): SseEvent | null {
  let event = "";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!event || dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

async function readSse(
  response: Response,
  options: {
    stopAfterEvent?: string;
    onEvent?: (event: SseEvent) => void;
    maxEvents?: number;
  } = {},
): Promise<SseEvent[]> {
  const reader = response.body!.getReader();
  const decoder = new globalThis.TextDecoder();
  const events: SseEvent[] = [];
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const event = parseFrame(frame);
        if (!event) continue;
        events.push(event);
        options.onEvent?.(event);
        if (options.stopAfterEvent && event.event === options.stopAfterEvent) {
          await reader.cancel().catch(() => undefined);
          return events;
        }
        if (options.maxEvents && events.length >= options.maxEvents) {
          await reader.cancel().catch(() => undefined);
          return events;
        }
      }
    }
  } catch {
    // desconexão deliberada
  }
  return events;
}

type RequestSignal = NonNullable<Parameters<typeof fetch>[1]>["signal"];

function streamRequest(
  base: string,
  cookie: string,
  conversationId: string,
  payload: Record<string, unknown> = { userPrompt: "Fala, SpeakerAlpha!" },
  signal?: RequestSignal,
): Promise<Response> {
  return fetch(`${base}/api/conversations/${conversationId}/turn/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(payload),
    signal,
  });
}

async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 3000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timeout aguardando condição");
}

describe("Conversation turn SSE (Fase 8)", () => {
  afterAll(async () => {
    await prisma.conversation.deleteMany({
      where: { id: { in: createdConversationIds } },
    });
    await prisma.memoryCharacter.deleteMany({
      where: { memory: { content: "MEMORIA_SECRETA_XYZ" } },
    });
    await prisma.memory.deleteMany({
      where: { content: "MEMORIA_SECRETA_XYZ" },
    });
    await prisma.character.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it("exige autenticação e ownership da conversa", async () => {
    const { app, base } = await startApp(fakeProvider({ deltas: ["a"] }));
    const owner = await signUp(app, "owner");
    const intruder = await signUp(app, "intruder");
    const fixture = await createConversationFixture(owner.userId);

    const unauthenticated = await fetch(
      `${base}/api/conversations/${fixture.conversationId}/turn/stream`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userPrompt: "oi" }),
      },
    );
    expect(unauthenticated.status).toBe(401);

    const forbidden = await streamRequest(
      base,
      intruder.cookie,
      fixture.conversationId,
    );
    expect(forbidden.status).toBe(404);

    await app.close();
  });

  it("emite started/delta/completed, persiste a mensagem final e não vaza contexto", async () => {
    const deltas = ["Ola", ", ", "mundo", "!"];
    const provider = fakeProvider({ deltas });
    const { app, base } = await startApp(provider);
    const owner = await signUp(app, "stream");
    const fixture = await createConversationFixture(owner.userId);
    await seedSecretMemory(fixture.aiCharacterId);

    const response = await streamRequest(base, owner.cookie, fixture.conversationId);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const raw = await response.text();
    const events = raw
      .split("\n\n")
      .map(parseFrame)
      .filter((item): item is SseEvent => item !== null);

    expect(events[0].event).toBe("generation.started");
    expect(events[0].data.speakers).toEqual([fixture.aiCharacterId]);
    const deltaEvents = events.filter((item) => item.event === "generation.delta");
    expect(deltaEvents.map((item) => item.data.delta)).toEqual(deltas);
    for (const item of deltaEvents) {
      expect(item.data.characterId).toBe(fixture.aiCharacterId);
    }
    const completed = events.at(-1);
    expect(completed?.event).toBe("generation.completed");
    expect(completed?.data.requestId).toBe(events[0].data.requestId);
    const result = completed!.data as {
      userMessage: { content: string };
      messages: Array<{ id: string; content: string }>;
      failedSpeakers: unknown[];
    };
    expect(result.userMessage.content).toBe("Fala, SpeakerAlpha!");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe(deltas.join(""));
    expect(result.failedSpeakers).toEqual([]);

    const rows = await prisma.message.findMany({
      where: { conversationId: fixture.conversationId },
    });
    expect(rows).toHaveLength(2);
    const aiRow = rows.find((row) => row.senderType === "AI_CHARACTER");
    expect(aiRow?.content).toBe(deltas.join(""));

    expect(raw).not.toContain("MEMORIA_SECRETA_XYZ");
    expect(raw).not.toContain("<BEGIN");
    expect(raw).not.toContain("GLOBAL_RULES");
    expect(raw).not.toContain('"systemPrompt"');
    expect(raw).not.toContain("stack");
    expect(getActiveStreamCount()).toBe(0);

    await app.close();
  });

  it("mantém equivalência semântica com o endpoint tradicional e faz fallback sem streaming", async () => {
    const provider = fakeProvider({ deltas: ["resposta completa"], withoutStream: true });
    const { app, base } = await startApp(provider);
    const owner = await signUp(app, "fallback");
    const first = await createConversationFixture(owner.userId);
    const second = await createConversationFixture(owner.userId);

    const traditional = await app.inject({
      method: "POST",
      url: `/api/conversations/${first.conversationId}/turn`,
      headers: { cookie: owner.cookie },
      payload: { userPrompt: "Fala, SpeakerAlpha!" },
    });
    expect(traditional.statusCode).toBe(201);
    const traditionalText = traditional.json().messages[0].content;

    const response = await streamRequest(base, owner.cookie, second.conversationId);
    const events = await readSse(response);
    const deltaEvents = events.filter((item) => item.event === "generation.delta");
    expect(deltaEvents).toHaveLength(1);
    expect(deltaEvents[0].data.delta).toBe(traditionalText);
    expect(events.at(-1)?.event).toBe("generation.completed");
    expect(
      (events.at(-1)!.data as { messages: Array<{ content: string }> }).messages[0]
        .content,
    ).toBe(traditionalText);

    await app.close();
  });

  it("emite generation.error em falha do provider sem persistir mensagem de IA", async () => {
    const provider = fakeProvider({
      deltas: ["parcial", "mais"],
      failAtDelta: 1,
      failError: new OllamaProviderError("network", "rede caiu (interno)"),
    });
    const { app, base } = await startApp(provider);
    const owner = await signUp(app, "fail");
    const fixture = await createConversationFixture(owner.userId);

    const response = await streamRequest(base, owner.cookie, fixture.conversationId);
    const events = await readSse(response);
    expect(events.map((item) => item.event)).toEqual([
      "generation.started",
      "generation.delta",
      "generation.error",
    ]);
    const error = events.at(-1)!.data as { code: string; message: string };
    expect(error.code).toBe("PROVIDER_ERROR");
    expect(error.message).not.toContain("interno");

    const rows = await prisma.message.findMany({
      where: { conversationId: fixture.conversationId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].senderType).toBe("USER_CHARACTER");
    expect(getActiveStreamCount()).toBe(0);

    await app.close();
  });

  it("mapeia timeout do provider e erro de payload malformado", async () => {
    const timeoutProvider = fakeProvider({
      deltas: ["x"],
      failAtDelta: 0,
      failError: new OllamaProviderError("timeout", "timeout interno"),
    });
    const first = await startApp(timeoutProvider);
    const owner = await signUp(first.app, "timeout");
    const fixture = await createConversationFixture(owner.userId);
    const timeoutEvents = await readSse(
      await streamRequest(first.base, owner.cookie, fixture.conversationId),
    );
    expect(timeoutEvents.at(-1)!.data.code).toBe("PROVIDER_TIMEOUT");
    await first.app.close();

    const malformedProvider = fakeProvider({
      deltas: ["x"],
      failAtDelta: 0,
      failError: new OllamaProviderError("malformed_response", "chunk inválido"),
    });
    const second = await startApp(malformedProvider);
    const fixtureSecond = await createConversationFixture(owner.userId);
    const malformedEvents = await readSse(
      await streamRequest(second.base, owner.cookie, fixtureSecond.conversationId),
    );
    expect(malformedEvents.at(-1)!.data.code).toBe("PROVIDER_ERROR");
    await second.app.close();
  });

  it("aborta a geração quando o cliente desconecta e limpa o listener", async () => {
    let aborted = false;
    const provider = fakeProvider({
      deltas: ["a", "b", "c", "d", "e"],
      delayMs: 40,
      onSignal: (signal) => {
        signal?.addEventListener("abort", () => {
          aborted = true;
        });
      },
    });
    const { app, base } = await startApp(provider);
    const owner = await signUp(app, "disconnect");
    const fixture = await createConversationFixture(owner.userId);

    const controller = new AbortController();
    const response = await streamRequest(
      base,
      owner.cookie,
      fixture.conversationId,
      { userPrompt: "Fala, SpeakerAlpha!" },
      controller.signal,
    );
    await readSse(response, { stopAfterEvent: "generation.delta" });
    controller.abort();

    await waitFor(() => aborted);
    await waitFor(async () => {
      const ai = await prisma.message.count({
        where: {
          conversationId: fixture.conversationId,
          senderType: "AI_CHARACTER",
        },
      });
      return ai === 0 && getActiveStreamCount() === 0;
    });

    const rows = await prisma.message.findMany({
      where: { conversationId: fixture.conversationId },
    });
    expect(rows.filter((row) => row.senderType === "AI_CHARACTER")).toHaveLength(0);

    await app.close();
  });

  it("isola gerações concorrentes em duas conversas do mesmo usuário", async () => {
    const provider: GenerationProvider = {
      name: "fake-stream",
      async run(input) {
        return {
          provider: "fake-stream",
          mode: "generated",
          text: "x",
          tokenStats: stats(input),
        };
      },
      async runStream(input, handlers) {
        const marker = (input.userPrompt ?? "").includes("SpeakerAlpha")
          ? "ALFA"
          : "BETA";
        for (const piece of [marker, `-${marker}`]) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          handlers.onDelta(piece);
        }
        return {
          provider: "fake-stream",
          mode: "generated",
          text: `${marker}-${marker}`,
          tokenStats: stats(input),
        };
      },
    };
    const { app, base } = await startApp(provider);
    const owner = await signUp(app, "concurrent");
    const first = await createConversationFixture(owner.userId, "SpeakerAlpha");
    const second = await createConversationFixture(owner.userId, "SpeakerBeta");

    const [firstResponse, secondResponse] = await Promise.all([
      streamRequest(base, owner.cookie, first.conversationId, {
        userPrompt: "SpeakerAlpha!",
      }),
      streamRequest(base, owner.cookie, second.conversationId, {
        userPrompt: "SpeakerBeta!",
      }),
    ]);
    const [firstEvents, secondEvents] = await Promise.all([
      readSse(firstResponse),
      readSse(secondResponse),
    ]);

    const text = (events: SseEvent[]) => {
      const deltas = events
        .filter((item) => item.event === "generation.delta")
        .map((item) => item.data.delta as string);
      return deltas.join("");
    };
    const firstText = text(firstEvents);
    const secondText = text(secondEvents);
    expect(firstText).toBe("ALFA-ALFA");
    expect(secondText).toBe("BETA-BETA");

    for (const fixture of [first, second]) {
      const ai = await prisma.message.findMany({
        where: {
          conversationId: fixture.conversationId,
          senderType: "AI_CHARACTER",
        },
      });
      expect(ai).toHaveLength(1);
    }
    expect(getActiveStreamCount()).toBe(0);

    await app.close();
  });

  it("rejeita cookie de sessão inválido", async () => {
    const { app, base } = await startApp(fakeProvider({ deltas: ["x"] }));
    const owner = await signUp(app, "forged");
    const fixture = await createConversationFixture(owner.userId);

    const response = await streamRequest(
      base,
      "f1nw.session_token=cookie-invalido.assinatura-invalida",
      fixture.conversationId,
    );
    expect(response.status).toBe(401);

    await app.close();
  });
});
