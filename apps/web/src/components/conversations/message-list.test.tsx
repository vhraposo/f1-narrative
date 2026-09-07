import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ConversationParticipant, Message } from "@/lib/conversations";

const mocks = vi.hoisted(() => ({
  messages: { data: [] as Message[], isError: false },
  participants: { data: [] as ConversationParticipant[] },
}));

vi.mock("@/hooks/use-conversations", () => ({
  useConversationMessages: () => mocks.messages,
  useConversationParticipants: () => mocks.participants,
}));

import { MessageList } from "./message-list";

function participant(id: string, name: string): ConversationParticipant {
  return {
    id,
    name,
    nationality: "BR",
    imageUrl: null,
    controlledBy: "AI",
    userId: null,
  };
}

function message(
  id: string,
  senderType: Message["senderType"],
  content: string,
  characterId: string | null,
  createdAt: string,
): Message {
  return {
    id,
    conversationId: "c1",
    senderType,
    characterId,
    content,
    createdAt,
  };
}

describe("MessageList", () => {
  it("mostra mensagens USER, AI e SYSTEM a partir do senderType", () => {
    mocks.participants.data = [participant("ai1", "Kiminawa")];
    mocks.messages.data = [
      message("m1", "USER_CHARACTER", "Tô dentro!", "u1", "2026-09-05T12:00:00.000Z"),
      message("m2", "AI_CHARACTER", "Bora pra pista!", "ai1", "2026-09-05T12:01:00.000Z"),
      message("m3", "SYSTEM", "Sistema inicializou a conversa.", null, "2026-09-05T11:00:00.000Z"),
    ];
    render(<MessageList conversationId="c1" />);

    expect(screen.getByText("Tô dentro!")).toBeDefined();
    expect(screen.getByText("Kiminawa")).toBeDefined();
    expect(screen.getByText("Bora pra pista!")).toBeDefined();
    expect(screen.getByText("Sistema inicializou a conversa.")).toBeDefined();
  });

  it("mostra estado vazio real", () => {
    mocks.messages.data = [];
    mocks.participants.data = [];
    render(<MessageList conversationId="c1" />);
    expect(
      screen.getByText("Ainda não há mensagens nesta conversa."),
    ).toBeDefined();
  });

  it("mostra erro de carregamento", () => {
    mocks.messages.data = [];
    mocks.participants.data = [];
    mocks.messages.isError = true;
    render(<MessageList conversationId="c1" />);
    expect(
      screen.getByText("Não foi possível carregar as mensagens."),
    ).toBeDefined();
    mocks.messages.isError = false;
  });
});