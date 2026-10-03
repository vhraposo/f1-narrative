import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MessageComposer } from "@/components/conversations/message-composer";
import { ApiError } from "@/lib/api";
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
  {
    id: "user-1",
    name: "Alicya",
    controlledBy: "USER",
    nationality: "BRA",
  },
  {
    id: "ai-1",
    name: "Andrea Kimi Antonelli",
    controlledBy: "AI",
    nationality: "ITA",
  },
];

function mockPostImplementation(options: { autonomousFails?: boolean } = {}) {
  apiMock.post.mockImplementation(async (path: string) => {
    if (path === "/api/conversations/c1/messages") {
      return {
        message: {
          id: "m-user",
          conversationId: "c1",
          senderType: "USER_CHARACTER",
          characterId: "user-1",
          content: "Bom dia",
          createdAt: "2026-10-01T12:00:00.000Z",
        },
      };
    }
    if (path === "/api/conversations/c1/simulate-turn/plan") {
      return {
        plan: {
          energy: { energy: 0.4, intensity: 0.2, level: "NORMAL", reasons: [] },
          window: { maxInitialResponders: 1, maxReactions: 1, maxChainDepth: 2 },
          planned: [
            {
              characterId: "ai-1",
              name: "Andrea Kimi Antonelli",
              score: 30,
              opportunity: 0.6,
              reasons: ["SEEDED_VARIATION"],
            },
          ],
          stopReason: "SELECTED",
        },
      };
    }
    if (path === "/api/conversations/c1/simulate-turn") {
      if (options.autonomousFails) {
        throw new ApiError("Falha ao gerar resposta", 500, "EXECUTION_FAILED");
      }
      return {
        simulation: {
          executed: true,
          stopReason: "NATURAL_END",
          depth: 1,
          steps: [
            {
              depth: 0,
              characterId: "ai-1",
              name: "Andrea Kimi Antonelli",
              messageId: "m-ai",
              language: { provider: "deterministic", model: "behavior-language.v1", fallback: true },
            },
          ],
          selection: [],
        },
      };
    }
    throw new ApiError("Não encontrado", 404);
  });
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/conversations/c1/participants") return { participants: PARTICIPANTS };
    if (path === "/api/conversations/c1/messages") return { messages: [] };
    throw new ApiError("Não encontrado", 404);
  });
  mockPostImplementation();
});

async function renderComposer(props: { onError?: (message: string) => void; onTypingChange?: (names: string[]) => void } = {}) {
  renderWithClient(<MessageComposer conversationId="c1" {...props} />);
  await screen.findByPlaceholderText("Escreva sua mensagem...");
  await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
}

describe("MessageComposer — envio com resposta autônoma", () => {
  it("1) enviar persiste a mensagem e dispara o autonomous turn", async () => {
    const user = userEvent.setup();
    await renderComposer();

    await user.type(screen.getByPlaceholderText("Escreva sua mensagem..."), "Bom dia");
    const sendButton = screen.getByRole("button", { name: "Enviar mensagem" }) as HTMLButtonElement;
    await waitFor(() => expect(sendButton.disabled).toBe(false));
    await user.click(sendButton);

    await waitFor(() => {
      expect(apiMock.post).toHaveBeenCalledWith(
        "/api/conversations/c1/messages",
        expect.objectContaining({ content: "Bom dia", characterId: "user-1" }),
      );
    });
    await waitFor(() => {
      expect(apiMock.post).toHaveBeenCalledWith(
        "/api/conversations/c1/simulate-turn",
        {},
      );
    });
    expect((screen.getByPlaceholderText("Escreva sua mensagem...") as HTMLTextAreaElement).value).toBe("");
  });

  it("2) não existe botão 'Gerar resposta IA' e há um único botão primário de envio", async () => {
    await renderComposer();
    expect(screen.queryByRole("button", { name: /Gerar resposta IA/i })).toBeNull();
    expect(screen.getAllByRole("button", { name: /Enviar mensagem/i })).toHaveLength(1);
  });

  it("3) sinaliza estado de digitação durante o turno autônomo", async () => {
    const typing: string[][] = [];
    const user = userEvent.setup();
    await renderComposer({
      onTypingChange: (value) => typing.push(value),
    });
    await user.type(screen.getByPlaceholderText("Escreva sua mensagem..."), "Bom dia");
    await user.click(screen.getByRole("button", { name: "Enviar mensagem" }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledTimes(3));
    expect(typing.some((names) => names.length > 0)).toBe(true);
    expect(typing[typing.length - 1]).toEqual([]);
  });

  it("4) falha do autonomous turn não apaga a mensagem do usuário e reporta erro amigável", async () => {
    mockPostImplementation({ autonomousFails: true });
    const errors: string[] = [];
    const user = userEvent.setup();
    await renderComposer({
      onError: (message) => errors.push(message),
    });
    await user.type(screen.getByPlaceholderText("Escreva sua mensagem..."), "Bom dia");
    await user.click(screen.getByRole("button", { name: "Enviar mensagem" }));
    await waitFor(() => expect(errors.length).toBeGreaterThanOrEqual(1));
    expect(errors[0]).toBe("Não foi possível gerar uma resposta agora.");
    expect(apiMock.post).toHaveBeenCalledWith(
      "/api/conversations/c1/messages",
      expect.objectContaining({ content: "Bom dia" }),
    );
  });

  it("5) sem personagem do usuário não há envio e o aviso aparece", async () => {
    apiMock.get.mockImplementation(async (path: string) => {
      if (path === "/api/conversations/c1/participants")
        return { participants: [PARTICIPANTS[1]] };
      if (path === "/api/conversations/c1/messages") return { messages: [] };
      throw new ApiError("Não encontrado", 404);
    });
    renderWithClient(<MessageComposer conversationId="c1" />);
    expect(
      await screen.findByText("Nenhum dos seus personagens participa desta conversa."),
    ).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "Enviar mensagem" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("6) com múltiplos personagens do usuário, o seletor define o remetente", async () => {
    apiMock.get.mockImplementation(async (path: string) => {
      if (path === "/api/conversations/c1/participants")
        return {
          participants: [
            PARTICIPANTS[0],
            { id: "user-2", name: "Max User", controlledBy: "USER", nationality: "BRA" },
            PARTICIPANTS[1],
          ],
        };
      if (path === "/api/conversations/c1/messages") return { messages: [] };
      throw new ApiError("Não encontrado", 404);
    });
    renderWithClient(<MessageComposer conversationId="c1" />);
    await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
    expect(await screen.findByLabelText("Quem envia a mensagem")).toBeDefined();
  });
});

describe("MessageComposer — F8 teclado e erros", () => {
  it("Enter envia; Shift+Enter quebra linha sem enviar", async () => {
    const user = userEvent.setup();
    await renderComposer();
    const textarea = screen.getByLabelText("Mensagem") as HTMLTextAreaElement;

    await user.click(textarea);
    await user.type(textarea, "linha um{Shift>}{Enter}{/Shift}linha dois");
    expect(textarea.value).toContain("linha um\nlinha dois");
    expect(apiMock.post).not.toHaveBeenCalledWith(
      "/api/conversations/c1/messages",
      expect.anything(),
    );

    await user.type(textarea, "{Enter}");
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith(
        "/api/conversations/c1/messages",
        expect.objectContaining({ content: "linha um\nlinha dois" }),
      ),
    );
  });

  it("limite de 5000 caracteres no textarea", async () => {
    await renderComposer();
    expect((screen.getByLabelText("Mensagem") as HTMLTextAreaElement).maxLength).toBe(5000);
  });

  it("falha de envio preserva o texto e reporta mensagem amigável", async () => {
    apiMock.post.mockImplementation(async (path: string) => {
      if (path === "/api/conversations/c1/messages") {
        throw new ApiError("Personagem não participa desta conversa", 403, "FORBIDDEN");
      }
      throw new ApiError("Não encontrado", 404);
    });
    const errors: string[] = [];
    const user = userEvent.setup();
    await renderComposer({ onError: (message) => errors.push(message) });
    const textarea = screen.getByLabelText("Mensagem") as HTMLTextAreaElement;
    await user.type(textarea, "Bom dia");
    await user.click(screen.getByRole("button", { name: "Enviar mensagem" }));

    await waitFor(() => expect(errors.length).toBeGreaterThanOrEqual(1));
    expect(errors[0]).toBe("Você não tem permissão para enviar nesta conversa.");
    expect(textarea.value).toBe("Bom dia");
  });

  it("429 reporta excesso de mensagens sem descartar o texto", async () => {
    apiMock.post.mockImplementation(async (path: string) => {
      if (path === "/api/conversations/c1/messages") {
        throw new ApiError("Rate limit", 429, "RATE_LIMIT");
      }
      throw new ApiError("Não encontrado", 404);
    });
    const errors: string[] = [];
    const user = userEvent.setup();
    await renderComposer({ onError: (message) => errors.push(message) });
    await user.type(screen.getByLabelText("Mensagem"), "Bom dia");
    await user.click(screen.getByRole("button", { name: "Enviar mensagem" }));
    await waitFor(() => expect(errors.length).toBeGreaterThanOrEqual(1));
    expect(errors[0]).toBe("Muitas mensagens em pouco tempo. Aguarde um instante.");
  });
});
