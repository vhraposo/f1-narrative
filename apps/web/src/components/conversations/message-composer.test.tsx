import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";

import { ApiError } from "@/lib/api";
import type {
  ConversationParticipant,
  Message,
  TurnFailedSpeaker,
  TurnResponse,
} from "@/lib/conversations";

type CreateInput = {
  senderType: "USER_CHARACTER";
  characterId: string;
  content: string;
};
type TurnInput = { userPrompt: string };
type CreateCallbacks = { onSuccess?: (data: Message) => void; onError?: (err: unknown) => void };
type TurnCallbacks = {
  onSuccess?: (data: TurnResponse) => void;
  onError?: (err: unknown) => void;
};

// Fronteira de mock: apenas @/hooks/use-conversations. ApiError (de @/lib/api)
// NÃO é mockado (o componente faz instanceof em ApiError).
const mocks = vi.hoisted(() => {
  return {
    participants: { data: [] as ConversationParticipant[] },
    create: {
      isPending: false,
      mutate: vi.fn(),
    } as { isPending: boolean; mutate: Mock<(input: CreateInput, callbacks?: CreateCallbacks) => void> },
    turn: {
      isPending: false,
      mutate: vi.fn(),
    } as { isPending: boolean; mutate: Mock<(input: TurnInput, callbacks?: TurnCallbacks) => void> },
  };
});

vi.mock("@/hooks/use-conversations", () => ({
  useConversationParticipants: () => mocks.participants,
  useCreateMessage: () => mocks.create,
  useTurnMessage: () => mocks.turn,
}));

import { MessageComposer } from "./message-composer";

const CONV_ID = "conv-1";

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
    id: `m-user-${Date.now()}-${Math.random()}`,
    conversationId: CONV_ID,
    senderType: "USER_CHARACTER",
    characterId,
    content,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function aiMessage(characterId: string, content: string): Message {
  return {
    id: `m-ai-${Date.now()}-${Math.random()}`,
    conversationId: CONV_ID,
    senderType: "AI_CHARACTER",
    characterId,
    content,
    createdAt: "2026-01-01T00:00:01Z",
  };
}

function turnResponse(
  overrides: {
    messages?: Message[];
    failedSpeakers?: TurnFailedSpeaker[];
  } = {},
): TurnResponse {
  return {
    userMessage: userMessage("user-1", "Olá"),
    messages: overrides.messages ?? [],
    failedSpeakers: overrides.failedSpeakers ?? [],
  };
}

const textInput = () =>
  screen.getByPlaceholderText(/escreva/i) as HTMLTextAreaElement;
const gerarBtn = () =>
  screen.getByRole("button", { name: "Gerar resposta IA" }) as HTMLButtonElement;
const enviarBtn = () =>
  screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement;

function setup(
  participants: ConversationParticipant[],
  opts?: { createPending?: boolean; turnPending?: boolean },
) {
  mocks.participants.data = participants;
  mocks.create.isPending = opts?.createPending ?? false;
  mocks.turn.isPending = opts?.turnPending ?? false;
  mocks.create.mutate.mockReset();
  mocks.turn.mutate.mockReset();

  const onError = vi.fn();
  let createCb: CreateCallbacks = {};
  let turnCb: TurnCallbacks = {};

  mocks.create.mutate.mockImplementation((_input, callbacks) => {
    createCb = callbacks ?? {};
  });
  mocks.turn.mutate.mockImplementation((_input, callbacks) => {
    turnCb = callbacks ?? {};
  });

  render(<MessageComposer conversationId={CONV_ID} onError={onError} />);

  return {
    onError,
    user: userEvent.setup(),
    createSpy: mocks.create.mutate,
    turnSpy: mocks.turn.mutate,
    fireCreateSuccess: (message: Message) =>
      act(() => createCb.onSuccess?.(message)),
    fireTurnSuccess: (response: TurnResponse) =>
      act(() => turnCb.onSuccess?.(response)),
    fireTurnError: (err: unknown) => act(() => turnCb.onError?.(err)),
  };
}

describe("MessageComposer — turno multi-character (STEP 109B)", () => {
  it("A - 'Gerar resposta IA' chama /turn com { userPrompt } (sem /messages nem /generate)", async () => {
    const h = setup([participant("user-1", "USER"), participant("ai-1", "AI")]);

    await h.user.type(textInput(), "Olá, IA!");
    await h.user.click(gerarBtn());

    expect(h.turnSpy).toHaveBeenCalledTimes(1);
    expect(h.turnSpy).toHaveBeenCalledWith(
      { userPrompt: "Olá, IA!" },
      expect.anything(),
    );
    // Envio manual não é acionado; geração individual antiga não é usada.
    expect(h.createSpy).not.toHaveBeenCalled();

    h.fireTurnSuccess(turnResponse({ messages: [aiMessage("ai-1", "Olá!")] }));
    expect(textInput().value).toBe("");
  });

  it("B - sucesso com 1 mensagem: limpa input, sem notice", async () => {
    const h = setup([participant("user-1", "USER"), participant("ai-1", "AI")]);

    await h.user.type(textInput(), "Oi");
    await h.user.click(gerarBtn());
    h.fireTurnSuccess(turnResponse({ messages: [aiMessage("ai-1", "Oi!")] }));

    expect(textInput().value).toBe("");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("C - sucesso multi-message: múltiplas respostas aceitas, input limpo, sem notice", async () => {
    const h = setup([
      participant("user-1", "USER"),
      participant("ai-1", "AI"),
      participant("ai-2", "AI"),
    ]);

    await h.user.type(textInput(), "Pergunta para todos");
    await h.user.click(gerarBtn());
    h.fireTurnSuccess(
      turnResponse({
        messages: [
          aiMessage("ai-1", "Resposta A"),
          aiMessage("ai-2", "Resposta B"),
        ],
      }),
    );

    expect(textInput().value).toBe("");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("D - falha parcial: 1 resposta + 1 failedSpeakers → notice com contagem", async () => {
    const h = setup([
      participant("user-1", "USER"),
      participant("ai-1", "AI"),
      participant("ai-2", "AI"),
    ]);

    await h.user.type(textInput(), "Pergunta");
    await h.user.click(gerarBtn());
    h.fireTurnSuccess(
      turnResponse({
        messages: [aiMessage("ai-1", "Resposta A")],
        failedSpeakers: [{ characterId: "ai-2", error: "provider-error" }],
      }),
    );

    expect(textInput().value).toBe("");
    expect(
      screen.getByText(/1 resposta\(s\) gerada\(s\); 1 não respondeu\(ram\)\./),
    ).toBeTruthy();
  });

  it("E - zero messages e zero failedSpeakers → notice de nenhum responder", async () => {
    const h = setup([participant("user-1", "USER"), participant("ai-1", "AI")]);

    await h.user.type(textInput(), "Sem menção");
    await h.user.click(gerarBtn());
    h.fireTurnSuccess(turnResponse());

    expect(textInput().value).toBe("");
    expect(
      screen.getByText("Nenhum personagem tinha motivo para responder neste turno."),
    ).toBeTruthy();
  });

  it("F - zero messages com 1 failedSpeakers → notice de nenhuma resposta", async () => {
    const h = setup([participant("user-1", "USER"), participant("ai-1", "AI")]);

    await h.user.type(textInput(), "Ola");
    await h.user.click(gerarBtn());
    h.fireTurnSuccess(
      turnResponse({
        failedSpeakers: [{ characterId: "ai-1", error: "mode-not-generated" }],
      }),
    );

    expect(textInput().value).toBe("");
    expect(
      screen.getByText("Nenhuma resposta de IA foi gerada neste turno."),
    ).toBeTruthy();
  });

  it("G - erro 401: onError de sessão; texto permanece", async () => {
    const h = setup([participant("user-1", "USER"), participant("ai-1", "AI")]);

    await h.user.type(textInput(), "Olá");
    await h.user.click(gerarBtn());
    h.fireTurnError(new ApiError("Sessão expirada", 401));

    expect(h.onError).toHaveBeenCalledWith("Sessão expirada. Faça login novamente.");
    expect(textInput().value).toBe("Olá");
    expect(h.turnSpy).toHaveBeenCalledTimes(1);
  });

  it("H - erro 500 PROVIDER_ERROR → onError genérico; texto permanece", async () => {
    const h = setup([participant("user-1", "USER"), participant("ai-1", "AI")]);

    await h.user.type(textInput(), "Olá");
    await h.user.click(gerarBtn());
    h.fireTurnError(new ApiError("Falha ao gerar resposta", 500, "PROVIDER_ERROR"));

    expect(h.onError).toHaveBeenCalledWith(
      "Não foi possível gerar a resposta. Tente novamente.",
    );
    expect(textInput().value).toBe("Olá");
  });

  it("I - turno isPending: botões desabilitados; sem duplo disparo", async () => {
    const h = setup(
      [participant("user-1", "USER"), participant("ai-1", "AI")],
      { turnPending: true },
    );

    expect(enviarBtn().disabled).toBe(true);
    expect(gerarBtn().disabled).toBe(true);

    fireEvent.click(gerarBtn());
    expect(h.turnSpy).not.toHaveBeenCalled();
    expect(h.createSpy).not.toHaveBeenCalled();
  });

  it("J - zero AI: gerar desabilitado, aviso; Enviar continua", async () => {
    const h = setup([participant("user-1", "USER")]);

    expect(
      screen.getByText("Nenhum personagem de IA participa desta conversa."),
    ).toBeTruthy();
    expect(gerarBtn().disabled).toBe(true);

    await h.user.type(textInput(), "Oi");
    await h.user.click(enviarBtn());
    expect(h.createSpy).toHaveBeenCalledWith(
      { senderType: "USER_CHARACTER", characterId: "user-1", content: "Oi" },
      expect.anything(),
    );
    expect(h.turnSpy).not.toHaveBeenCalled();
  });

  it("K - zero USER: gerar desabilitado, aviso, sem request", async () => {
    const h = setup([participant("ai-1", "AI")]);

    expect(
      screen.getByText("Nenhum dos seus personagens participa desta conversa."),
    ).toBeTruthy();
    expect(
      screen.getByText(/Escolha um remetente do seu personagem/i),
    ).toBeTruthy();
    expect(gerarBtn().disabled).toBe(true);

    fireEvent.click(gerarBtn());
    expect(h.turnSpy).not.toHaveBeenCalled();
    expect(h.createSpy).not.toHaveBeenCalled();
  });

  it("L - Enviar isolado: somente /messages, nunca /turn", async () => {
    const h = setup([participant("user-1", "USER"), participant("ai-1", "AI")]);

    await h.user.type(textInput(), "Mensagem manual");
    await h.user.click(enviarBtn());

    expect(h.createSpy).toHaveBeenCalledTimes(1);
    expect(h.turnSpy).not.toHaveBeenCalled();
  });

  it("M - retry após falha: novo clique chama /turn de novo (sem estado residual)", async () => {
    const h = setup([participant("user-1", "USER"), participant("ai-1", "AI")]);

    await h.user.type(textInput(), "Olá");
    await h.user.click(gerarBtn());
    h.fireTurnError(new ApiError("Falha na rede", 500));

    await h.user.click(gerarBtn());

    expect(h.turnSpy).toHaveBeenCalledTimes(2);
    expect(h.turnSpy.mock.calls[0][0]).toEqual({ userPrompt: "Olá" });
    expect(h.turnSpy.mock.calls[1][0]).toEqual({ userPrompt: "Olá" });
    expect(h.createSpy).not.toHaveBeenCalled();
  });
});