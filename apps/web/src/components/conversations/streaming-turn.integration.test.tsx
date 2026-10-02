import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationThread } from "@/components/conversations/conversation-thread";
import { ApiError } from "@/lib/api";
import type { Message } from "@/lib/conversations";
import { renderWithClient } from "@/test/render-with-client";

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

const PARTICIPANTS = [
  { id: "user-1", name: "Alicya", controlledBy: "USER", nationality: "BRA" },
  { id: "ai-1", name: "Andrea Kimi Antonelli", controlledBy: "AI", nationality: "ITA" },
];

let messages: Message[] = [];

beforeEach(() => {
  messages = [
    {
      id: "m-1",
      conversationId: "c1",
      senderType: "AI_CHARACTER",
      characterId: "ai-1",
      content: "Vamos treinar amanhã?",
      createdAt: "2026-10-01T12:00:00.000Z",
    },
  ];
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/conversations/c1") {
      return {
        conversation: {
          id: "c1",
          title: "Driver Group",
          type: "GROUP",
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
        },
      };
    }
    if (path === "/api/conversations/c1/participants") return { participants: PARTICIPANTS };
    if (path === "/api/conversations/c1/messages") return { messages };
    throw new ApiError("Não encontrado", 404);
  });
  apiMock.post.mockImplementation(async (path: string) => {
    if (path === "/api/conversations/c1/messages") {
      messages = [
        ...messages,
        {
          id: "m-user",
          conversationId: "c1",
          senderType: "USER_CHARACTER",
          characterId: "user-1",
          content: "Bom dia",
          createdAt: "2026-10-01T12:10:00.000Z",
        },
      ];
      return { message: messages[messages.length - 1] };
    }
    if (path === "/api/conversations/c1/autonomous-turn") {
      messages = [
        ...messages,
        {
          id: "m-ai",
          conversationId: "c1",
          senderType: "AI_CHARACTER",
          characterId: "ai-1",
          content: "Bom dia! Como você está?",
          createdAt: "2026-10-01T12:11:00.000Z",
        },
      ];
      return {
        turn: {
          executed: true,
          reasonCode: "EXECUTED",
          decisionId: "d1",
          messageId: "m-ai",
          speakerCharacterId: "ai-1",
          language: { provider: "deterministic", model: "behavior-language.v1", fallback: true },
        },
      };
    }
    throw new ApiError("Não encontrado", 404);
  });
});

describe("ConversationThread — envio sem botão de geração", () => {
  it("1) não usa o pipeline legado /turn nem /turn/stream", async () => {
    const user = userEvent.setup();
    renderWithClient(<ConversationThread conversationId="c1" />);
    await screen.findByPlaceholderText("Escreva sua mensagem...");
    await waitFor(() => expect(apiMock.get).toHaveBeenCalled());

    await user.type(screen.getByPlaceholderText("Escreva sua mensagem..."), "Bom dia");
    await user.click(screen.getByRole("button", { name: "Enviar mensagem" }));

    await screen.findByText("Bom dia! Como você está?");
    const paths = apiMock.post.mock.calls.map((call) => String(call[0]));
    expect(paths).toContain("/api/conversations/c1/autonomous-turn");
    expect(paths.some((path) => path.endsWith("/turn"))).toBe(false);
    expect(paths.some((path) => path.endsWith("/turn/stream"))).toBe(false);
    expect(screen.queryByRole("button", { name: /Gerar resposta IA/i })).toBeNull();
  });

  it("2) mostra indicador de digitação enquanto a IA responde", async () => {
    let resolveTurn: ((value: unknown) => void) | undefined;
    apiMock.post.mockImplementation(async (path: string) => {
      if (path === "/api/conversations/c1/messages") {
        messages = [
          ...messages,
          {
            id: "m-user",
            conversationId: "c1",
            senderType: "USER_CHARACTER",
            characterId: "user-1",
            content: "Bom dia",
            createdAt: "2026-10-01T12:10:00.000Z",
          },
        ];
        return { message: messages[messages.length - 1] };
      }
      return new Promise((resolve) => {
        resolveTurn = resolve;
      });
    });
    const user = userEvent.setup();
    renderWithClient(<ConversationThread conversationId="c1" />);
    await screen.findByPlaceholderText("Escreva sua mensagem...");
    await waitFor(() => expect(apiMock.get).toHaveBeenCalled());

    await user.type(screen.getByPlaceholderText("Escreva sua mensagem..."), "Bom dia");
    await user.click(screen.getByRole("button", { name: "Enviar mensagem" }));

    expect(await screen.findByText(/está digitando…/)).toBeDefined();
    resolveTurn?.({
      turn: {
        executed: false,
        reasonCode: "NO_AI_PARTICIPANT",
        plan: null,
        decisionId: null,
      },
    });
    await waitFor(() => expect(screen.queryByText(/está digitando…/)).toBeNull());
  });
});
