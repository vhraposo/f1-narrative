import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type { Conversation, ConversationParticipant } from "@/lib/conversations";

const state = vi.hoisted(() => ({
  conversation: {
    data: null as Conversation | null,
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
  participants: { data: [] as ConversationParticipant[] },
}));

vi.mock("@/hooks/use-conversations", () => ({
  useConversation: () => state.conversation,
  useConversationParticipants: () => state.participants,
  useConversationMessages: () => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCreateMessage: () => ({ mutate: vi.fn(), isPending: false }),
  useSimulateTurn: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { ConversationThread } from "./conversation-thread";

function participant(
  id: string,
  name: string,
  controlledBy: "USER" | "AI" = "AI",
): ConversationParticipant {
  return {
    id,
    name,
    nationality: "BR",
    imageUrl: null,
    controlledBy,
    userId: null,
  };
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "c1",
    title: "Garagem",
    type: "GROUP",
    visibility: "PRIVATE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    participants: [],
    messageCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  state.conversation = { data: conversation(), isLoading: false, isError: false, error: null };
  state.participants = {
    data: [participant("u1", "Alicya", "USER"), participant("ai1", "Kimi")],
  };
});

describe("ConversationThread — F8", () => {
  it("mostra badge de conversa privada por default", () => {
    render(<ConversationThread conversationId="c1" />);
    expect(
      screen.getByTitle("Conversa privada — somente participantes"),
    ).toBeDefined();
  });

  it("mostra badge de universo com semântica honesta (fail-closed)", () => {
    state.conversation = {
      data: conversation({ visibility: "UNIVERSE" }),
      isLoading: false,
      isError: false,
      error: null,
    };
    render(<ConversationThread conversationId="c1" />);
    expect(
      screen.getByTitle(
        "Visibilidade de universo — nesta fase o acesso continua restrito aos participantes",
      ),
    ).toBeDefined();
  });

  it("mostra contagem de participantes no subtítulo", () => {
    render(<ConversationThread conversationId="c1" />);
    expect(screen.getByText(/2 participantes/)).toBeDefined();
  });

  it("404/403 vira estado de acesso sem vazar dados", () => {
    state.conversation = {
      data: null,
      isLoading: false,
      isError: true,
      error: new ApiError("Conversa não encontrada", 404, "NOT_FOUND"),
    };
    render(<ConversationThread conversationId="c1" />);
    expect(screen.getByText("Conversa não encontrada")).toBeDefined();
    expect(
      screen.getByText("Esta conversa não existe ou você não tem acesso a ela."),
    ).toBeDefined();
  });

  it("erro genérico não promete acesso", () => {
    state.conversation = {
      data: null,
      isLoading: false,
      isError: true,
      error: new ApiError("boom", 500, "EXECUTION_FAILED"),
    };
    render(<ConversationThread conversationId="c1" />);
    expect(screen.getByText("Não foi possível carregar")).toBeDefined();
    expect(screen.queryByText(/você não tem acesso/i)).toBeNull();
  });
});
