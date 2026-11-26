import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationParticipant, Message } from "@/lib/conversations";

const mocks = vi.hoisted(() => ({
  messages: {
    data: [] as Message[],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  participants: { data: [] as ConversationParticipant[] },
}));

vi.mock("@/hooks/use-conversations", () => ({
  useConversationMessages: () => mocks.messages,
  useConversationParticipants: () => mocks.participants,
}));

import { MessageList } from "./message-list";

const scrollTo = vi.fn();

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
  content: string,
  overrides: Partial<Message> = {},
): Message {
  return {
    id,
    conversationId: "c1",
    senderType: "AI_CHARACTER",
    characterId: "ai1",
    content,
    createdAt: "2026-01-01T12:00:00.000Z",
    ...overrides,
  };
}

function renderList() {
  const ref: { current: HTMLElement | null } = { current: null };
  const utils = render(
    <div
      ref={(el) => {
        ref.current = el;
      }}
      className="overflow-y-auto"
      data-testid="scroller"
    >
      <MessageList conversationId="c1" scrollContainerRef={ref} />
    </div>,
  );
  const rerenderList = () =>
    utils.rerender(
      <div
        ref={(el) => {
          ref.current = el;
        }}
        className="overflow-y-auto"
        data-testid="scroller"
      >
        <MessageList conversationId="c1" scrollContainerRef={ref} />
      </div>,
    );
  return { ...utils, rerenderList };
}

function setScrollGeometry(
  el: HTMLElement,
  geometry: { scrollHeight: number; scrollTop: number; clientHeight: number },
) {
  Object.defineProperty(el, "scrollHeight", { value: geometry.scrollHeight, configurable: true });
  Object.defineProperty(el, "scrollTop", { value: geometry.scrollTop, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: geometry.clientHeight, configurable: true });
}

beforeEach(() => {
  mocks.messages.data = [];
  mocks.messages.isLoading = false;
  mocks.messages.isError = false;
  mocks.messages.refetch.mockClear();
  mocks.participants.data = [participant("ai1", "Kiminawa")];
  scrollTo.mockClear();
  Element.prototype.scrollTo = scrollTo as unknown as typeof Element.prototype.scrollTo;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

describe("MessageList — experiência F8", () => {
  it("separadores de dia aparecem quando a conversa atravessa dias", () => {
    mocks.messages.data = [
      message("m1", "primeira", { createdAt: "2026-01-01T12:00:00.000Z" }),
      message("m2", "segunda", { createdAt: "2026-01-02T12:00:00.000Z" }),
    ];
    renderList();
    expect(screen.getAllByRole("separator")).toHaveLength(2);
    expect(screen.getByText("01 de janeiro")).toBeDefined();
    expect(screen.getByText("02 de janeiro")).toBeDefined();
  });

  it("reply conhecido mostra preview; reply desconhecido degrada sem erro", () => {
    mocks.messages.data = [
      message("m1", "Mensagem original"),
      message("m2", "Concordo", {
        contextJson: {
          family: "dialogue",
          generationKey: "k",
          provider: "dialogue-realizer",
          ruleApplied: "r",
          conversationType: "GROUP",
          assembledAt: "2026-01-01T12:01:00.000Z",
          activeSpeaker: { characterId: "ai1", senderType: "AI_CHARACTER" },
          participantCharacterIds: ["ai1"],
          dialogue: { replyToMessageId: "m1" },
          temporal: {
            worldDate: null,
            currentSeasonId: null,
            currentRaceId: null,
            currentSession: null,
            phaseMarker: null,
          },
          fidelity: {
            messages: 1,
            memories: 0,
            events: 0,
            relationships: 0,
            news: 0,
            omitted: { oldestMessagesTruncated: 0, memoriesOmitted: 0, reasons: [] },
          },
          stats: { systemPromptChars: 0, contextBlocks: 0 },
          rag: {
            used: false,
            provider: null,
            model: null,
            dimensions: null,
            ruleApplied: null,
            items: 0,
          },
        },
      }),
      message("m3", "Órfã", {
        contextJson: {
          family: "dialogue",
          generationKey: "k2",
          provider: "dialogue-realizer",
          ruleApplied: "r",
          conversationType: "GROUP",
          assembledAt: "2026-01-01T12:02:00.000Z",
          activeSpeaker: { characterId: "ai1", senderType: "AI_CHARACTER" },
          participantCharacterIds: ["ai1"],
          dialogue: { replyToMessageId: "inexistente" },
          temporal: {
            worldDate: null,
            currentSeasonId: null,
            currentRaceId: null,
            currentSession: null,
            phaseMarker: null,
          },
          fidelity: {
            messages: 1,
            memories: 0,
            events: 0,
            relationships: 0,
            news: 0,
            omitted: { oldestMessagesTruncated: 0, memoriesOmitted: 0, reasons: [] },
          },
          stats: { systemPromptChars: 0, contextBlocks: 0 },
          rag: {
            used: false,
            provider: null,
            model: null,
            dimensions: null,
            ruleApplied: null,
            items: 0,
          },
        },
      }),
    ];
    renderList();
    expect(screen.getAllByText(/Respondendo a/)).toHaveLength(1);
    expect(screen.getAllByText("Mensagem original").length).toBeGreaterThanOrEqual(2);
  });

  it("indicador de novas mensagens aparece lendo histórico e some ao voltar ao fim", async () => {
    mocks.messages.data = [message("m1", "primeira"), message("m2", "segunda")];
    const { rerenderList } = renderList();
    expect(scrollTo).toHaveBeenCalledTimes(1);

    setScrollGeometry(screen.getByTestId("scroller"), {
      scrollHeight: 2000,
      scrollTop: 0,
      clientHeight: 400,
    });
    mocks.messages.data = [...mocks.messages.data, message("m3", "terceira")];
    rerenderList();

    const button = screen.getByRole("button", { name: /1 nova mensagem/i });
    expect(button).toBeDefined();
    expect(scrollTo).toHaveBeenCalledTimes(1);

    const user = userEvent.setup();
    await user.click(button);
    expect(screen.queryByRole("button", { name: /nova mensagem/i })).toBeNull();
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("erro de mensagens oferece retry", async () => {
    mocks.messages.isError = true;
    renderList();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Tentar novamente/i }));
    expect(mocks.messages.refetch).toHaveBeenCalledTimes(1);
  });
});
