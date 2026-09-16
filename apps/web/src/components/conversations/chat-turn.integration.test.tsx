import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type {
  Conversation,
  ConversationParticipant,
  CreateMessageInput,
  Message,
  TurnResponse,
} from "@/lib/conversations";
import { conversationMessagesKey } from "@/hooks/use-conversations";
import { renderWithClient } from "@/test/render-with-client";
import { MessageComposer } from "./message-composer";
import { MessageList } from "./message-list";

const CONV_ID = "conv-1";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
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

function participant(
  id: string,
  controlledBy: "USER" | "AI",
): ConversationParticipant {
  return {
    id,
    name: `${controlledBy === "USER" ? "Usuario" : "IA"} ${id}`,
    nationality: "BR",
    imageUrl: null,
    controlledBy,
    userId: controlledBy === "USER" ? "u-1" : null,
  };
}

function userMessage(characterId: string, content: string): Message {
  return {
    id: `m-user-${content.length}`,
    conversationId: CONV_ID,
    senderType: "USER_CHARACTER",
    characterId,
    content,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function aiMessage(characterId: string, content: string): Message {
  return {
    id: `m-ai-${content.length}`,
    conversationId: CONV_ID,
    senderType: "AI_CHARACTER",
    characterId,
    content,
    createdAt: "2026-01-01T00:00:01Z",
  };
}

const conversationFixture: Conversation = {
  id: CONV_ID,
  title: "Conversa de teste",
  type: "GROUP",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  participants: [],
  messageCount: 0,
};

let participantsFixture: ConversationParticipant[];
let messagesFixture: Message[];
let callOrder: string[];

beforeEach(() => {
  participantsFixture = [participant("user-1", "USER"), participant("ai-1", "AI")];
  messagesFixture = [];
  callOrder = [];

  apiMock.get.mockImplementation(async (path: string) => {
    if (path.endsWith("/participants")) {
      return { participants: [...participantsFixture] };
    }
    if (path.endsWith("/messages")) {
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
      callOrder.push("turn");
      const input = body as { userPrompt: string };
      const userMsg = userMessage("user-1", input.userPrompt);
      const ai = aiMessage("ai-1", `IA respondeu: ${input.userPrompt}`);
      messagesFixture.push(userMsg, ai);
      const response: TurnResponse = {
        userMessage: userMsg,
        messages: [ai],
        failedSpeakers: [],
      };
      return response;
    }
    callOrder.push("messages");
    const input = body as CreateMessageInput;
    const created = userMessage(input.characterId!, input.content);
    messagesFixture.push(created);
    return { message: created };
  });

  apiMock.patch.mockImplementation(async () => undefined);
  apiMock.put.mockImplementation(async () => undefined);
  apiMock.remove.mockImplementation(async () => undefined);
});

function renderTurn() {
  return renderWithClient(
    <div>
      <MessageComposer conversationId={CONV_ID} onError={() => undefined} />
      <MessageList conversationId={CONV_ID} />
    </div>,
  );
}

const textArea = () => screen.getByPlaceholderText(/escreva/i) as HTMLTextAreaElement;
const gerarBtn = () =>
  screen.getByRole("button", { name: "Gerar resposta IA" }) as HTMLButtonElement;

// O composer habilita a digitação quando os participantes carregam e há um
// character USER do usuário (sem mais select de speaker — o backend decide).
async function waitComposerReady() {
  await vi.waitFor(() => expect(textArea().disabled).toBe(false));
}

describe("Chat turn integration (QueryClient real + api mockada)", () => {
  it("A - turno 201: USER + AI Messages visíveis na MessageList após refetch", async () => {
    const user = userEvent.setup();
    const h = renderTurn();
    await waitComposerReady();

    await user.type(textArea(), "Olá, mundo!");
    await user.click(gerarBtn());

    await vi.waitFor(() => expect(callOrder).toEqual(["turn"]));

    expect(
      await screen.findByText("IA respondeu: Olá, mundo!"),
    ).toBeTruthy();

    const cached =
      h.client.getQueryData<Message[]>(conversationMessagesKey(CONV_ID)) ?? [];
    expect(cached).toHaveLength(2);
    expect(cached[0].senderType).toBe("USER_CHARACTER");
    expect(cached[1].senderType).toBe("AI_CHARACTER");
  });

  it("B - falha no turn (500): um único request, cache vazio, texto preservado", async () => {
    apiMock.post.mockImplementation(async (path: string) => {
      if (path.endsWith("/turn")) {
        callOrder.push("turn");
        throw new ApiError("Falha na rede", 500);
      }
      callOrder.push("messages");
      throw new ApiError("Falha na rede", 500);
    });

    const user = userEvent.setup();
    const h = renderTurn();
    await waitComposerReady();

    await user.type(textArea(), "Olá");
    await user.click(gerarBtn());

    await vi.waitFor(() => expect(callOrder).toEqual(["turn"]));

    const cached =
      h.client.getQueryData<Message[]>(conversationMessagesKey(CONV_ID)) ?? [];
    expect(cached).toHaveLength(0);
    expect(textArea().value).toBe("Olá");
  });

  it("C - turno único: QueryCache com USER e AI em ordem; AI visível", async () => {
    const user = userEvent.setup();
    const h = renderTurn();
    await waitComposerReady();

    await user.type(textArea(), "Ola");
    await user.click(gerarBtn());

    await vi.waitFor(() => expect(callOrder).toEqual(["turn"]));
    expect(await screen.findByText("IA respondeu: Ola")).toBeTruthy();

    const cached =
      h.client.getQueryData<Message[]>(conversationMessagesKey(CONV_ID)) ?? [];
    expect(cached).toHaveLength(2);
    expect(cached[0].senderType).toBe("USER_CHARACTER");
    expect(cached[0].content).toBe("Ola");
    expect(cached[1].senderType).toBe("AI_CHARACTER");
    expect(cached[1].content).toBe("IA respondeu: Ola");
  });
});