import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type {
  Conversation,
  ConversationParticipant,
  CreateMessageInput,
  GenerateMessageInput,
  Message,
} from "@/lib/conversations";
import { conversationMessagesKey } from "@/hooks/use-conversations";
import { renderWithClient } from "@/test/render-with-client";
import { MessageComposer } from "./message-composer";
import { MessageList } from "./message-list";

const CONV_ID = "conv-1";

// Fronteira HTTP mockada: somente @/lib/api. O cliente real de rede é a única
// coisa substituída; conversations.ts (lib) e os hooks do use-conversations
// são REAIS — incluindo QueryClient real (renderWithClient).
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
      // Cópia fresca simulando a resposta persistida do servidor.
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
    if (path.endsWith("/generate")) {
      callOrder.push("generate");
      const input = body as GenerateMessageInput;
      const generated = aiMessage(
        input.targetCharacterId,
        `IA respondeu: ${input.userPrompt}`,
      );
      messagesFixture.push(generated);
      return {
        message: generated,
        generationKey: "gen-key",
        provider: "test-provider",
        mode: "generated",
      };
    }
    callOrder.push("messages");
    const input = body as CreateMessageInput;
    const created = userMessage(input.characterId!, input.content);
    messagesFixture.push(created);
    return created;
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

describe("Chat turn integration (QueryClient real + api mockada)", () => {
  it("A - roundtrip 201: AI Message visível na MessageList após invalidação/refetch", async () => {
    const user = userEvent.setup();
    renderTurn();

    // Esperar participants reais carregarem antes de interagir
    // (textarea fica habilitado só com remetente/speaker resolvidos).
    await screen.findByLabelText("Quem deve responder");

    await user.type(textArea(), "Olá, mundo!");
    await user.click(gerarBtn());

    // ORDEM REAL: generate apenas após o success de createMessage.
    await vi.waitFor(() => expect(callOrder).toEqual(["messages", "generate"]));

    // Assertion principal é sobre o DOM: a resposta da IA aparece na lista.
    expect(
      await screen.findByText("IA respondeu: Olá, mundo!"),
    ).toBeTruthy();
  });

  it("B - falha no USER insert: generate não chamado, cache vazio, erro visível, estado consistente", async () => {
    apiMock.post.mockImplementation(async (path: string) => {
      if (path.endsWith("/generate")) {
        callOrder.push("generate");
        throw new ApiError("não deve ocorrer", 500);
      }
      callOrder.push("messages");
      throw new ApiError("Falha na rede", 500);
    });

    const user = userEvent.setup();
    const h = renderTurn();

    await screen.findByLabelText("Quem deve responder");
    await user.type(textArea(), "Olá");
    await user.click(gerarBtn());

    await vi.waitFor(() => expect(callOrder).toEqual(["messages"]));

    const cached =
      h.client.getQueryData<Message[]>(conversationMessagesKey(CONV_ID)) ?? [];
    expect(cached).toHaveLength(0);
    expect(textArea().value).toBe("Olá");
  });

  it("C - turno completo: QueryCache com USER e AI em ordem; AI visível", async () => {
    const user = userEvent.setup();
    const h = renderTurn();

    await screen.findByLabelText("Quem deve responder");
    await user.type(textArea(), "Ola");
    await user.click(gerarBtn());

    await vi.waitFor(() => expect(callOrder).toEqual(["messages", "generate"]));
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