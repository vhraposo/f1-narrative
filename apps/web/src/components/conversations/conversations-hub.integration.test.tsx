import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type {
  Conversation,
  ConversationParticipant,
  Message,
} from "@/lib/conversations";
import { renderWithClient } from "@/test/render-with-client";
import ConversationsPage from "@/app/app/conversations/page";

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

function participant(
  id: string,
  name: string,
  controlledBy: "USER" | "AI",
): ConversationParticipant {
  return {
    id,
    name,
    nationality: "BR",
    imageUrl: null,
    controlledBy,
    userId: controlledBy === "USER" ? "u-1" : null,
  };
}

function makeConversation(
  id: string,
  title: string | null,
  type: Conversation["type"],
): Conversation {
  return {
    id,
    title,
    type,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-05T10:00:00Z",
    participants: [],
    messageCount: 0,
  };
}

const GROUP = makeConversation("g1", "Grupo dos Pilotos · 2026", "GROUP");
const DIRECT = makeConversation("d1", null, "DM");
const AI = participant("ai-1", "Kiminawa", "AI");
const USER = participant("u-1", "Alicya", "USER");

let messagesFixture: Message[] = [];

beforeEach(() => {
  messagesFixture = [
    {
      id: "m1",
      conversationId: GROUP.id,
      senderType: "USER_CHARACTER",
      characterId: USER.id,
      content: "Tô dentro!",
      createdAt: "2026-09-05T20:00:00.000Z",
    },
    {
      id: "m2",
      conversationId: GROUP.id,
      senderType: "AI_CHARACTER",
      characterId: AI.id,
      content: "Bora pra pista!",
      createdAt: "2026-09-05T20:01:00.000Z",
    },
  ];

  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/world") {
      return {
        world: {
          id: "w1",
          key: "world",
          currentDate: "2026-09-05T20:00:00.000Z",
          currentSeasonId: "season-1",
          currentRaceId: null,
          currentSession: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      };
    }
    if (path === "/api/seasons") {
      return {
        seasons: [
          {
            id: "season-1",
            year: 2026,
            name: null,
            status: "ACTIVE",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      };
    }
    if (path === "/api/conversations") {
      return { conversations: [GROUP, DIRECT] };
    }
    if (path === `/api/conversations/${GROUP.id}`) {
      return { conversation: GROUP };
    }
    if (path === `/api/conversations/${GROUP.id}/participants`) {
      return { participants: [USER, AI] };
    }
    if (path === `/api/conversations/${GROUP.id}/messages`) {
      return { messages: [...messagesFixture] };
    }
    if (path === `/api/conversations/${DIRECT.id}/participants`) {
      return { participants: [USER, AI] };
    }
    if (path === `/api/conversations/${DIRECT.id}/messages`) {
      return { messages: [] };
    }
    throw new ApiError("Não encontrado", 404);
  });

  apiMock.post.mockImplementation(async () => undefined);
  apiMock.patch.mockImplementation(async () => undefined);
  apiMock.put.mockImplementation(async () => undefined);
  apiMock.remove.mockImplementation(async () => undefined);
});

describe("Conversation Hub - abertura", () => {
  it("direciona para o grupo da temporada atual quando ele existe", async () => {
    renderWithClient(<ConversationsPage />);

    // Thread aberta no "Grupo dos Pilotos · 2026" (direcionamento padrão).
    // O subtítulo do header só aparece na thread aberta (identifica o grupo).
    expect(await screen.findByText("Grupo · 2 participantes")).toBeDefined();
    expect(screen.getAllByText("Grupo dos Pilotos · 2026").length).toBeGreaterThan(0);

    // Mensagens USER e AI renderizadas como bolhas. O nome "Kiminawa" pode
    // aparecer tanto no nome da bolha quanto no seletor do composer.
    expect(screen.getByText("Tô dentro!")).toBeDefined();
    expect(screen.getByText("Bora pra pista!")).toBeDefined();
    expect(screen.getAllByText("Kiminawa").length).toBeGreaterThan(0);

    // Composer do grupo presente.
    expect(
      screen.getByPlaceholderText(/escreva/i),
    ).toBeDefined();
  });

  it("prioriza o grupo no topo da lista; diretas aparecem abaixo", async () => {
    renderWithClient(<ConversationsPage />);

    expect(await screen.findByText("Grupo da temporada")).toBeDefined();
    const directHeader = screen.getByText("Conversas diretas");
    expect(directHeader).toBeDefined();

    // DM sem título com participantes vazios no payload de lista: o sidebar
    // mostra "Conversa sem título" com o subtipo "Direta".
    expect(screen.getByText("Conversa sem título")).toBeDefined();
    expect(screen.getAllByText("Direta").length).toBeGreaterThan(0);

    // A seção do grupo vem antes da seção de diretas.
    const groupHeader = screen.getByText("Grupo da temporada");
    expect(
      groupHeader.compareDocumentPosition(directHeader) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("no mobile, voltar da thread para a lista é explícito", async () => {
    const user = userEvent.setup();
    renderWithClient(<ConversationsPage />);

    await screen.findByText("Grupo · 2 participantes");

    const backButton = screen.getByRole("button", {
      name: "Voltar para conversas",
    });
    await user.click(backButton);

    // Thread fechada (subtitle do header e composer ausentes); lista permanece.
    expect(screen.queryByText("Grupo · 2 participantes")).toBeNull();
    expect(screen.queryByPlaceholderText(/escreva/i)).toBeNull();
    expect(screen.getByText("Grupo da temporada")).toBeDefined();
  });

  it("sem grupo padrão nos dados: preserva a lista (fallback, sem grupo inventado)", async () => {
    apiMock.get.mockImplementation(async (path: string) => {
      if (path === "/api/world") {
        return {
          world: {
            id: "w1",
            key: "world",
            currentDate: "2026-09-05T20:00:00.000Z",
            currentSeasonId: null,
            currentRaceId: null,
            currentSession: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        };
      }
      if (path === "/api/seasons") {
        return { seasons: [] };
      }
      if (path === "/api/conversations") {
        return { conversations: [DIRECT] };
      }
      if (path === `/api/conversations/${DIRECT.id}/participants`) {
        return { participants: [USER, AI] };
      }
      if (path === `/api/conversations/${DIRECT.id}/messages`) {
        return { messages: [] };
      }
      throw new ApiError("Não encontrado", 404);
    });

    renderWithClient(<ConversationsPage />);

    expect(await screen.findByText("Conversas diretas")).toBeDefined();
    // Nenhuma thread auto-aberta e nenhum grupo inventado.
    expect(screen.queryByPlaceholderText(/escreva/i)).toBeNull();
    expect(screen.queryByText("Grupo da temporada")).toBeNull();
  });
});