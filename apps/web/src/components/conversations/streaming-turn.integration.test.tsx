import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { conversationMessagesKey } from "@/hooks/use-conversations";
import { ApiError } from "@/lib/api";
import {
  GenerationStreamError,
  type Conversation,
  type ConversationParticipant,
  type GenerationStreamEvent,
  type Message,
  type TurnResponse,
} from "@/lib/conversations";
import { renderWithClient } from "@/test/render-with-client";
import { MessageComposer } from "./message-composer";
import { MessageList } from "./message-list";

const CONV_ID = "conv-stream";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
  streamTurnMessage: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    get: apiMock.get,
    post: apiMock.post,
    patch: apiMock.patch,
    put: apiMock.put,
    remove: apiMock.remove,
  };
});

vi.mock("@/lib/conversations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/conversations")>();
  return {
    ...actual,
    streamTurnMessage: apiMock.streamTurnMessage,
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const conversationFixture: Conversation = {
  id: CONV_ID,
  title: "Streaming",
  type: "GROUP",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  participants: [],
  messageCount: 0,
};

const participantsFixture: ConversationParticipant[] = [
  {
    id: "user-1",
    name: "Usuario",
    nationality: "BR",
    imageUrl: null,
    controlledBy: "USER",
    userId: "u-1",
  },
  {
    id: "ai-1",
    name: "IA Um",
    nationality: "BR",
    imageUrl: null,
    controlledBy: "AI",
    userId: null,
  },
];

let messagesFixture: Message[];
let messageFetches: number;

function makeMessages(prompt: string): { userMessage: Message; ai: Message } {
  return {
    userMessage: {
      id: "m-user-1",
      conversationId: CONV_ID,
      senderType: "USER_CHARACTER",
      characterId: "user-1",
      content: prompt,
      createdAt: "2026-01-01T00:00:01Z",
    },
    ai: {
      id: "m-ai-1",
      conversationId: CONV_ID,
      senderType: "AI_CHARACTER",
      characterId: "ai-1",
      content: "resposta final",
      createdAt: "2026-01-01T00:00:02Z",
    },
  };
}

beforeEach(() => {
  messagesFixture = [];
  messageFetches = 0;
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.streamTurnMessage.mockReset();

  apiMock.get.mockImplementation(async (path: string) => {
    if (path.endsWith("/participants")) {
      return { participants: [...participantsFixture] };
    }
    if (path.endsWith("/messages")) {
      messageFetches += 1;
      return { messages: [...messagesFixture] };
    }
    if (path === `/api/conversations/${CONV_ID}`) {
      return { conversation: conversationFixture };
    }
    if (path === "/api/conversations") {
      return { conversations: [conversationFixture] };
    }
    throw new ApiError("Não encontrado", 404);
  });
  apiMock.post.mockImplementation(async (path: string, body: unknown) => {
    if (path.endsWith("/turn")) {
      const input = body as { userPrompt: string };
      const { userMessage, ai } = makeMessages(input.userPrompt);
      messagesFixture.push(userMessage, ai);
      return { userMessage, messages: [ai], failedSpeakers: [] };
    }
    throw new ApiError("Não encontrado", 404);
  });
  apiMock.patch.mockImplementation(async () => undefined);
  apiMock.put.mockImplementation(async () => undefined);
  apiMock.remove.mockImplementation(async () => undefined);
});

function renderComposer(onError = vi.fn()) {
  const utils = renderWithClient(
    <div>
      <MessageComposer conversationId={CONV_ID} onError={onError} />
      <MessageList conversationId={CONV_ID} />
    </div>,
  );
  return { ...utils, onError };
}

const textArea = () =>
  screen.getByPlaceholderText(/escreva/i) as HTMLTextAreaElement;
const gerarBtn = () =>
  screen.getByRole("button", { name: "Gerar resposta IA" }) as HTMLButtonElement;

async function waitComposerReady() {
  await vi.waitFor(() => expect(textArea().disabled).toBe(false));
}

describe("Streaming turn no composer (Fase 8)", () => {
  it("mostra placeholder, aplica deltas e consolida o resultado sem duplicar", async () => {
    const gate = deferred<void>();
    const events: GenerationStreamEvent[] = [
      {
        type: "generation.started",
        requestId: "r1",
        conversationId: CONV_ID,
        speakers: ["ai-1"],
      },
      { type: "generation.delta", requestId: "r1", characterId: "ai-1", delta: "Ola" },
      {
        type: "generation.delta",
        requestId: "r1",
        characterId: "ai-1",
        delta: " mundo",
      },
    ];
    apiMock.streamTurnMessage.mockImplementation(
      async (_id: string, input: { userPrompt: string }, handlers: { onEvent?: (e: GenerationStreamEvent) => void }) => {
        for (const event of events) {
          handlers.onEvent?.(event);
        }
        await gate.promise;
        const { userMessage, ai } = makeMessages(input.userPrompt);
        ai.content = "Ola mundo";
        messagesFixture.push(userMessage, ai);
        const result: TurnResponse = {
          userMessage,
          messages: [ai],
          failedSpeakers: [],
        };
        return result;
      },
    );

    const user = userEvent.setup();
    const h = renderComposer();
    await waitComposerReady();
    await user.type(textArea(), "Pergunta");
    await user.click(gerarBtn());

    expect(await screen.findByText("Ola mundo")).toBeTruthy();

    const during = h.client.getQueryData<Message[]>(
      conversationMessagesKey(CONV_ID),
    );
    expect(during?.some((m) => m.id.startsWith("stream-"))).toBe(true);

    gate.resolve();

    await waitFor(() => {
      const cached =
        h.client.getQueryData<Message[]>(conversationMessagesKey(CONV_ID)) ?? [];
      expect(cached).toHaveLength(2);
      expect(cached.filter((m) => m.content === "Ola mundo")).toHaveLength(1);
      expect(cached.every((m) => !m.id.startsWith("stream-"))).toBe(true);
    });
  });

  it("remove placeholder, reporta erro e refaz o fetch quando o stream falha após deltas", async () => {
    apiMock.streamTurnMessage.mockImplementation(
      async (_id: string, _input: unknown, handlers: { onEvent?: (e: GenerationStreamEvent) => void }) => {
        handlers.onEvent?.({
          type: "generation.started",
          requestId: "r2",
          conversationId: CONV_ID,
          speakers: ["ai-1"],
        });
        handlers.onEvent?.({
          type: "generation.delta",
          requestId: "r2",
          characterId: "ai-1",
          delta: "parcial",
        });
        throw new GenerationStreamError("Falha no meio do stream.");
      },
    );

    const user = userEvent.setup();
    const h = renderComposer();
    await waitComposerReady();
    await user.type(textArea(), "Pergunta");
    const fetchesBefore = messageFetches;
    await user.click(gerarBtn());

    await waitFor(() => {
      expect(h.onError).toHaveBeenCalledWith("Falha no meio do stream.");
    });
    const cached =
      h.client.getQueryData<Message[]>(conversationMessagesKey(CONV_ID)) ?? [];
    expect(cached.every((m) => !m.id.startsWith("stream-"))).toBe(true);
    await waitFor(() => expect(messageFetches).toBeGreaterThan(fetchesBefore));
  });

  it("usa o fallback tradicional quando o SSE falha antes de produzir conteúdo", async () => {
    apiMock.streamTurnMessage.mockRejectedValue(
      new GenerationStreamError("SSE indisponível."),
    );

    const user = userEvent.setup();
    const h = renderComposer();
    await waitComposerReady();
    await user.type(textArea(), "Fallback");
    await user.click(gerarBtn());

    await waitFor(() => {
      expect(apiMock.streamTurnMessage).toHaveBeenCalledTimes(1);
      expect(apiMock.post).toHaveBeenCalledWith(
        `/api/conversations/${CONV_ID}/turn`,
        { userPrompt: "Fallback" },
      );
    });
    const cached =
      h.client.getQueryData<Message[]>(conversationMessagesKey(CONV_ID)) ?? [];
    expect(cached).toHaveLength(2);
    expect(cached[1].content).toBe("resposta final");
    expect(h.onError).not.toHaveBeenCalled();
  });

  it("não entra em loop quando o fallback também falha", async () => {
    apiMock.streamTurnMessage.mockRejectedValue(
      new GenerationStreamError("SSE indisponível."),
    );
    apiMock.post.mockRejectedValue(new ApiError("Falha no turn", 500));

    const user = userEvent.setup();
    const h = renderComposer();
    await waitComposerReady();
    await user.type(textArea(), "Erro");
    await user.click(gerarBtn());

    await waitFor(() => {
      expect(h.onError).toHaveBeenCalledWith(
        "Não foi possível gerar a resposta. Tente novamente.",
      );
    });
    expect(apiMock.streamTurnMessage).toHaveBeenCalledTimes(1);
    expect(apiMock.post).toHaveBeenCalledTimes(1);
  });

  it("mantém loading e ignora segundo clique durante o streaming", async () => {
    const gate = deferred<TurnResponse>();
    apiMock.streamTurnMessage.mockImplementation(async () => gate.promise);

    const user = userEvent.setup();
    const h = renderComposer();
    await waitComposerReady();
    await user.type(textArea(), "Concorrente");
    await user.click(gerarBtn());

    await waitFor(() => expect(gerarBtn().disabled).toBe(true));
    await user.click(gerarBtn());
    expect(apiMock.streamTurnMessage).toHaveBeenCalledTimes(1);

    const { userMessage, ai } = makeMessages("Concorrente");
    messagesFixture.push(userMessage, ai);
    gate.resolve({ userMessage, messages: [ai], failedSpeakers: [] });

    await waitFor(() => {
      const cached =
        h.client.getQueryData<Message[]>(conversationMessagesKey(CONV_ID)) ?? [];
      expect(cached).toHaveLength(2);
    });
    await user.type(textArea(), "Nova");
    await waitFor(() => expect(gerarBtn().disabled).toBe(false));
  });

  it("aborta o stream ao desmontar sem reportar erro", async () => {
    let seenSignal: AbortSignal | undefined;
    const gate = deferred<TurnResponse>();
    apiMock.streamTurnMessage.mockImplementation(
      async (_id: string, _input: unknown, handlers: { signal?: AbortSignal }) => {
        seenSignal = handlers.signal;
        return gate.promise;
      },
    );

    const user = userEvent.setup();
    const h = renderComposer();
    await waitComposerReady();
    await user.type(textArea(), "Sair");
    await user.click(gerarBtn());
    await waitFor(() => expect(apiMock.streamTurnMessage).toHaveBeenCalledTimes(1));

    h.unmount();
    expect(seenSignal?.aborted).toBe(true);
    expect(h.onError).not.toHaveBeenCalled();
    gate.resolve({ userMessage: makeMessages("Sair").userMessage, messages: [], failedSpeakers: [] });
  });
});
