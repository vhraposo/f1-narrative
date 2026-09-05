import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "vitest";

import { ApiError } from "@/lib/api";
import type {
  ConversationParticipant,
  GenerateResponse,
  Message,
} from "@/lib/conversations";

type CreateInput = {
  senderType: "USER_CHARACTER";
  characterId: string;
  content: string;
};
type GenerateInput = { userPrompt: string; targetCharacterId: string };
type CreateCallbacks = { onSuccess?: (data: Message) => void; onError?: (err: unknown) => void };
type GenerateCallbacks = {
  onSuccess?: (data: GenerateResponse) => void;
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
    generate: {
      isPending: false,
      mutate: vi.fn(),
    } as { isPending: boolean; mutate: Mock<(input: GenerateInput, callbacks?: GenerateCallbacks) => void> },
  };
});

vi.mock("@/hooks/use-conversations", () => ({
  useConversationParticipants: () => mocks.participants,
  useCreateMessage: () => mocks.create,
  useGenerateMessage: () => mocks.generate,
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

function generatedResponse(message: Message): GenerateResponse {
  return {
    message,
    generationKey: "gen-key",
    provider: "test-provider",
    mode: "generated",
  };
}

function assemblyOnlyResponse(): GenerateResponse {
  return {
    generation: { generationKey: "gen-key", provider: "null", mode: "assembly-only" },
    responseSkeleton: {},
  };
}

const textInput = () =>
  screen.getByPlaceholderText(/escreva/i) as HTMLTextAreaElement;
const gerarBtn = () =>
  screen.getByRole("button", { name: "Gerar resposta IA" }) as HTMLButtonElement;
const enviarBtn = () =>
  screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement;
const speakerSelect = () =>
  screen.getByLabelText("Quem deve responder") as HTMLSelectElement;

function setup(
  participants: ConversationParticipant[],
  opts?: { createPending?: boolean; generatePending?: boolean },
) {
  mocks.participants.data = participants;
  mocks.create.isPending = opts?.createPending ?? false;
  mocks.generate.isPending = opts?.generatePending ?? false;
  mocks.create.mutate.mockReset();
  mocks.generate.mutate.mockReset();

  const onError = vi.fn();
  let createCb: CreateCallbacks = {};
  let generateCb: GenerateCallbacks = {};

  mocks.create.mutate.mockImplementation((_input, callbacks) => {
    createCb = callbacks ?? {};
  });
  mocks.generate.mutate.mockImplementation((_input, callbacks) => {
    generateCb = callbacks ?? {};
  });

  render(<MessageComposer conversationId={CONV_ID} onError={onError} />);

  return {
    onError,
    user: userEvent.setup(),
    createSpy: mocks.create.mutate,
    generateSpy: mocks.generate.mutate,
    fireCreateSuccess: (message: Message) =>
      act(() => createCb.onSuccess?.(message)),
    fireCreateError: (err: unknown) => act(() => createCb.onError?.(err)),
    fireGenerateSuccess: (response: GenerateResponse) =>
      act(() => generateCb.onSuccess?.(response)),
    fireGenerateError: (err: unknown) => act(() => generateCb.onError?.(err)),
  };
}

describe("MessageComposer — turno sequenciado (STEP 43)", () => {
  it("A - turno normal: /messages → success → /generate", async () => {
    const h = setup([participant("user-1", "USER"), participant("ai-1", "AI")]);

    await h.user.type(textInput(), "Olá, IA!");
    await h.user.click(gerarBtn());

    expect(h.createSpy).toHaveBeenCalledWith(
      { senderType: "USER_CHARACTER", characterId: "user-1", content: "Olá, IA!" },
      expect.anything(),
    );
    // Ordem: /generate NÃO pode ser chamado antes do success de /messages.
    expect(h.generateSpy).not.toHaveBeenCalled();

    h.fireCreateSuccess(userMessage("user-1", "Olá, IA!"));

    expect(h.generateSpy).toHaveBeenCalledWith(
      { userPrompt: "Olá, IA!", targetCharacterId: "ai-1" },
      expect.anything(),
    );

    h.fireGenerateSuccess(generatedResponse(userMessage("ai-1", "Olá!")));
    expect(textInput().value).toBe("");
  });

  it("B1 - falha de /messages (401): aborta, erro de sessão, sem turno fictício", async () => {
    const h = setup([participant("user-1", "USER"), participant("ai-1", "AI")]);

    await h.user.type(textInput(), "Olá");
    await h.user.click(gerarBtn());
    expect(h.createSpy).toHaveBeenCalledTimes(1);

    h.fireCreateError(new ApiError("Sessão expirada", 401));

    expect(h.generateSpy).not.toHaveBeenCalled();
    expect(h.onError).toHaveBeenCalledWith("Sessão expirada. Faça login novamente.");
    expect(textInput().value).toBe("Olá");
    // Sem turno fictício: nenhum request além do único já feito.
    expect(h.createSpy).toHaveBeenCalledTimes(1);
  });

  it("B2 - falha de /messages (400): aborta com erro de validação", async () => {
    const h = setup([participant("user-1", "USER"), participant("ai-1", "AI")]);

    await h.user.type(textInput(), "Conteúdo longo");
    await h.user.click(gerarBtn());

    h.fireCreateError(new ApiError("Conteúdo muito longo (máx. 5000 caracteres)", 400));

    expect(h.generateSpy).not.toHaveBeenCalled();
    expect(h.onError).toHaveBeenCalledWith(
      "Falha ao enviar sua mensagem: Conteúdo muito longo (máx. 5000 caracteres)",
    );
    expect(textInput().value).toBe("Conteúdo longo");
  });

  it("C - falha do provider: texto permanece, erro genérico, USER não reenviada", async () => {
    const h = setup([participant("user-1", "USER"), participant("ai-1", "AI")]);

    await h.user.type(textInput(), "Olá");
    await h.user.click(gerarBtn());
    h.fireCreateSuccess(userMessage("user-1", "Olá"));
    expect(h.generateSpy).toHaveBeenCalledTimes(1);

    h.fireGenerateError(new ApiError("Falha ao gerar resposta", 500, "PROVIDER_ERROR"));

    expect(h.onError).toHaveBeenCalledWith("Não foi possível gerar a resposta. Tente novamente.");
    expect(textInput().value).toBe("Olá");
    // A USER Message não é reenviada automaticamente após a falha.
    expect(h.createSpy).toHaveBeenCalledTimes(1);
  });

  it("D - retry após falha do provider: só /generate (turnUserMessageId)", async () => {
    const h = setup([participant("user-1", "USER"), participant("ai-1", "AI")]);

    await h.user.type(textInput(), "Olá");
    await h.user.click(gerarBtn());
    h.fireCreateSuccess(userMessage("user-1", "Olá"));
    h.fireGenerateError(new ApiError("Falha ao gerar resposta", 500, "PROVIDER_ERROR"));

    await h.user.click(gerarBtn());

    // createMutation NÃO é chamado novamente no retry.
    expect(h.createSpy).toHaveBeenCalledTimes(1);
    expect(h.generateSpy).toHaveBeenCalledTimes(2);
    expect(h.generateSpy.mock.calls[1][0]).toEqual({
      userPrompt: "Olá",
      targetCharacterId: "ai-1",
    });
  });

  it("E - texto editado inicia um novo turno", async () => {
    const h = setup([participant("user-1", "USER"), participant("ai-1", "AI")]);

    await h.user.type(textInput(), "Olá");
    await h.user.click(gerarBtn());
    h.fireCreateSuccess(userMessage("user-1", "Olá"));
    h.fireGenerateError(new ApiError("Falha ao gerar resposta", 500, "PROVIDER_ERROR"));

    await h.user.clear(textInput());
    await h.user.type(textInput(), "Nova pergunta");

    await h.user.click(gerarBtn());
    expect(h.createSpy).toHaveBeenCalledTimes(2);
    expect(h.createSpy.mock.calls[1][0]).toEqual({
      senderType: "USER_CHARACTER",
      characterId: "user-1",
      content: "Nova pergunta",
    });
    // /generate ainda não foi chamado para o novo turno: só após o novo success.
    expect(h.generateSpy).toHaveBeenCalledTimes(1);

    h.fireCreateSuccess(userMessage("user-1", "Nova pergunta"));
    expect(h.generateSpy).toHaveBeenCalledTimes(2);
    expect(h.generateSpy.mock.calls[1][0]).toEqual({
      userPrompt: "Nova pergunta",
      targetCharacterId: "ai-1",
    });
  });

  it("F - zero AI: sem selector, geração desabilitada, aviso; Enviar continua", async () => {
    const h = setup([participant("user-1", "USER")]);

    expect(screen.queryByLabelText("Quem deve responder")).toBeNull();
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
    expect(h.generateSpy).not.toHaveBeenCalled();
  });

  it("G - um AI: speaker determinístico, select desabilitado", async () => {
    const h = setup([participant("user-1", "USER"), participant("ai-1", "AI")]);

    const select = speakerSelect();
    expect(select.disabled).toBe(true);
    expect(select.value).toBe("ai-1");

    await h.user.type(textInput(), "Olá");
    await h.user.click(gerarBtn());
    h.fireCreateSuccess(userMessage("user-1", "Olá"));

    expect(h.generateSpy).toHaveBeenCalledWith(
      { userPrompt: "Olá", targetCharacterId: "ai-1" },
      expect.anything(),
    );
  });

  it("H - vários AI: sem valor default; seleção explícita define o alvo; A nunca implícito", async () => {
    const h = setup([
      participant("user-1", "USER"),
      participant("ai-a", "AI"),
      participant("ai-b", "AI"),
    ]);

    const select = speakerSelect();
    expect(select.disabled).toBe(false);
    expect(select.value).toBe("");
    expect(gerarBtn().disabled).toBe(true);

    await h.user.selectOptions(select, "ai-b");

    await h.user.type(textInput(), "Olá");
    expect(gerarBtn().disabled).toBe(false);
    await h.user.click(gerarBtn());
    h.fireCreateSuccess(userMessage("user-1", "Olá"));

    expect(h.generateSpy).toHaveBeenCalledTimes(1);
    expect(h.generateSpy.mock.calls[0][0]).toEqual({
      userPrompt: "Olá",
      targetCharacterId: "ai-b",
    });
    expect(h.generateSpy.mock.calls[0][0].targetCharacterId).not.toBe("ai-a");
  });

  it("I - Enviar isolado: somente /messages, nunca /generate", async () => {
    const h = setup([participant("user-1", "USER"), participant("ai-1", "AI")]);

    await h.user.type(textInput(), "Mensagem manual");
    await h.user.click(enviarBtn());

    expect(h.createSpy).toHaveBeenCalledTimes(1);
    expect(h.generateSpy).not.toHaveBeenCalled();
  });

  it("J - assembly-only (200): notice de preview, nenhum fake insert", async () => {
    const h = setup([participant("user-1", "USER"), participant("ai-1", "AI")]);

    await h.user.type(textInput(), "Olá");
    await h.user.click(gerarBtn());
    h.fireCreateSuccess(userMessage("user-1", "Olá"));
    expect(h.generateSpy).toHaveBeenCalledTimes(1);

    h.fireGenerateSuccess(assemblyOnlyResponse());

    expect(
      screen.getByText("Nenhuma resposta foi gerada (modo de pré-visualização)."),
    ).toBeTruthy();
    expect(textInput().value).toBe("");
    // Nenhum segundo insert de USER nem de AI fabricado (201).
    expect(h.createSpy).toHaveBeenCalledTimes(1);
    expect(h.generateSpy).toHaveBeenCalledTimes(1);
  });

  it("K1 - create isPending: botões e selector desabilitados; sem duplo disparo", async () => {
    const h = setup(
      [
        participant("user-1", "USER"),
        participant("ai-a", "AI"),
        participant("ai-b", "AI"),
      ],
      { createPending: true },
    );

    expect(enviarBtn().disabled).toBe(true);
    expect(gerarBtn().disabled).toBe(true);
    expect(speakerSelect().disabled).toBe(true);

    fireEvent.click(gerarBtn());
    expect(h.generateSpy).not.toHaveBeenCalled();
    expect(h.createSpy).not.toHaveBeenCalled();
  });

  it("K2 - generate isPending: botões desabilitados, geração não dispara", async () => {
    const h = setup(
      [
        participant("user-1", "USER"),
        participant("ai-a", "AI"),
        participant("ai-b", "AI"),
      ],
      { generatePending: true },
    );

    expect(enviarBtn().disabled).toBe(true);
    expect(gerarBtn().disabled).toBe(true);
    expect(speakerSelect().disabled).toBe(true);

    fireEvent.click(gerarBtn());
    expect(h.generateSpy).not.toHaveBeenCalled();
    expect(h.createSpy).not.toHaveBeenCalled();
  });

  it("L - AI participante mas zero USER: geração desabilitada, aviso, sem request", async () => {
    const h = setup([participant("ai-1", "AI")]);

    expect(
      screen.getByText("Nenhum dos seus personagens participa desta conversa."),
    ).toBeTruthy();
    expect(
      screen.getByText(/Escolha um remetente do seu personagem/i),
    ).toBeTruthy();
    expect(gerarBtn().disabled).toBe(true);

    fireEvent.click(gerarBtn());
    expect(h.generateSpy).not.toHaveBeenCalled();
    expect(h.createSpy).not.toHaveBeenCalled();
  });
});