import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "@/lib/conversations";

const state = vi.hoisted(() => ({ messages: [] as unknown[] }));

vi.mock("@/hooks/use-conversations", () => ({
  useConversationMessages: () => ({
    data: state.messages,
    isLoading: false,
    isError: false,
  }),
  useConversationParticipants: () => ({
    data: [],
    isLoading: false,
    isError: false,
  }),
}));

import { MessageList } from "./message-list";

function message(id: string, content: string): Message {
  return {
    id,
    conversationId: "c1",
    senderType: "USER_CHARACTER",
    characterId: "user-1",
    content,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

const scrollTo = vi.fn();

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
  return { ...utils, rerenderList, ref };
}

function scroller(): HTMLElement {
  return screen.getByTestId("scroller");
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
  state.messages = [];
  scrollTo.mockClear();
  Element.prototype.scrollTo = scrollTo as unknown as typeof Element.prototype.scrollTo;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

describe("MessageList autoscroll", () => {
  it("A - scroll inicial até a mensagem mais recente", () => {
    state.messages = [message("m1", "primeira"), message("m2", "segunda")];
    renderList();

    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("B - nova mensagem com usuário próximo do fim acompanha o scroll", () => {
    state.messages = [message("m1", "primeira"), message("m2", "segunda")];
    const { rerenderList } = renderList();
    expect(scrollTo).toHaveBeenCalledTimes(1);

    state.messages = [...state.messages, message("m3", "terceira")];
    rerenderList();

    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("C - nova mensagem com usuário lendo histórico preserva a posição", () => {
    state.messages = [message("m1", "primeira"), message("m2", "segunda")];
    const { rerenderList } = renderList();
    expect(scrollTo).toHaveBeenCalledTimes(1);

    setScrollGeometry(scroller(), { scrollHeight: 2000, scrollTop: 0, clientHeight: 400 });

    state.messages = [...state.messages, message("m3", "terceira")];
    rerenderList();

    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("D - sem mensagens não dispara scroll", () => {
    state.messages = [];
    renderList();

    expect(screen.getByText(/ainda não há mensagens/i)).toBeTruthy();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
