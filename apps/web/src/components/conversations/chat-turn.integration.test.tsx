import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MessageComposer } from "@/components/conversations/message-composer";
import { MessageList } from "@/components/conversations/message-list";
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

function userMessage(id: string, content: string, minute: number): Message {
  return {
    id,
    conversationId: "c1",
    senderType: "USER_CHARACTER",
    characterId: "user-1",
    content,
    createdAt: `2026-10-01T12:${String(minute).padStart(2, "0")}:00.000Z`,
  };
}

function aiMessage(id: string, content: string, minute: number): Message {
  return {
    id,
    conversationId: "c1",
    senderType: "AI_CHARACTER",
    characterId: "ai-1",
    content,
    createdAt: `2026-10-01T12:${String(minute).padStart(2, "0")}:00.000Z`,
  };
}

function Harness() {
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      {error && (
        <p role="alert">{error}</p>
      )}
      <MessageList conversationId="c1" />
      <MessageComposer conversationId="c1" onError={setError} />
    </div>
  );
}

beforeEach(() => {
  messages = [];
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/conversations/c1/participants") return { participants: PARTICIPANTS };
    if (path === "/api/conversations/c1/messages") return { messages };
    throw new ApiError("Não encontrado", 404);
  });
  apiMock.post.mockImplementation(async (path: string) => {
    if (path === "/api/conversations/c1/messages") {
      messages = [...messages, userMessage(`m-user-${messages.length}`, "Bom dia", 10)];
      return { message: messages[messages.length - 1] };
    }
    if (path === "/api/conversations/c1/autonomous-turn") {
      messages = [...messages, aiMessage(`m-ai-${messages.length}`, "Bom dia! Como você está?", 11)];
      return {
        turn: {
          executed: true,
          reasonCode: "EXECUTED",
          decisionId: "d1",
          messageId: messages[messages.length - 1]?.id,
          speakerCharacterId: "ai-1",
          language: { provider: "deterministic", model: "behavior-language.v1", fallback: true },
        },
      };
    }
    throw new ApiError("Não encontrado", 404);
  });
});

describe("Chat send → autonomous response (integração)", () => {
  it("A) enviar mostra a mensagem do usuário e a resposta da IA", async () => {
    const user = userEvent.setup();
    renderWithClient(<Harness />);
    await screen.findByPlaceholderText("Escreva sua mensagem...");
    await waitFor(() => expect(apiMock.get).toHaveBeenCalled());

    await user.type(screen.getByPlaceholderText("Escreva sua mensagem..."), "Bom dia");
    await user.click(screen.getByRole("button", { name: "Enviar mensagem" }));

    expect(await screen.findByText("Bom dia")).toBeDefined();
    expect(await screen.findByText("Bom dia! Como você está?")).toBeDefined();
    expect(screen.getByText("Andrea Kimi Antonelli")).toBeDefined();
    expect(apiMock.post).toHaveBeenCalledWith(
      "/api/conversations/c1/autonomous-turn",
      {},
    );
  });

  it("B) falha do autonomous turn mantém a mensagem do usuário e mostra erro não destrutivo", async () => {
    apiMock.post.mockImplementation(async (path: string) => {
      if (path === "/api/conversations/c1/messages") {
        messages = [...messages, userMessage("m-user-1", "Bom dia", 10)];
        return { message: messages[0] };
      }
      if (path === "/api/conversations/c1/autonomous-turn") {
        throw new ApiError("Falha ao gerar resposta", 500, "EXECUTION_FAILED");
      }
      throw new ApiError("Não encontrado", 404);
    });
    const user = userEvent.setup();
    renderWithClient(<Harness />);
    await screen.findByPlaceholderText("Escreva sua mensagem...");
    await waitFor(() => expect(apiMock.get).toHaveBeenCalled());

    await user.type(screen.getByPlaceholderText("Escreva sua mensagem..."), "Bom dia");
    await user.click(screen.getByRole("button", { name: "Enviar mensagem" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Não foi possível gerar uma resposta agora.");
    expect(await screen.findByText("Bom dia")).toBeDefined();
    const list = screen.getByRole("list");
    expect(within(list).queryByText("EXECUTION_FAILED")).toBeNull();
  });

  it("C) refresh não duplica a resposta", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithClient(<Harness />);
    await screen.findByPlaceholderText("Escreva sua mensagem...");
    await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
    await user.type(screen.getByPlaceholderText("Escreva sua mensagem..."), "Bom dia");
    await user.click(screen.getByRole("button", { name: "Enviar mensagem" }));
    await screen.findByText("Bom dia! Como você está?");
    unmount();

    renderWithClient(<Harness />);
    await waitFor(() =>
      expect(screen.getAllByText("Bom dia! Como você está?")).toHaveLength(1),
    );
  });
});
