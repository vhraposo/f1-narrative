import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AiBehaviorPanel } from "@/components/ai-behavior/ai-behavior-panel";
import { ApiError } from "@/lib/api";
import type { AiDecision } from "@/lib/ai-behavior";
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

function decision(overrides: Partial<AiDecision> = {}): AiDecision {
  return {
    id: "d1",
    characterId: "c1",
    status: "NO_ACTION",
    actionType: "NO_ACTION",
    conversationId: null,
    reason: "contexto insuficiente para agir",
    contextVersion: "ai-behavior.v1",
    policyCode: null,
    executedMessageId: null,
    executedEventId: null,
    metadata: null,
    createdAt: "2026-09-28T10:00:00.000Z",
    updatedAt: "2026-09-28T10:00:00.000Z",
    ...overrides,
  };
}

let decisionsFixture: AiDecision[];
let decisionsFetches: number;

beforeEach(() => {
  decisionsFixture = [];
  decisionsFetches = 0;
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.get.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/ai-behavior/decisions")) {
      decisionsFetches += 1;
      return { decisions: [...decisionsFixture] };
    }
    throw new ApiError("Não encontrado", 404);
  });
  apiMock.post.mockImplementation(async (path: string) => {
    if (path === "/api/ai-behavior/evaluate") {
      return { decision: decision() };
    }
    if (path === "/api/ai-behavior/execute") {
      return {
        decision: decision({
          status: "EXECUTED",
          actionType: "SEND_MESSAGE",
          executedMessageId: "m1",
        }),
      };
    }
    throw new ApiError("Não encontrado", 404);
  });
  apiMock.patch.mockImplementation(async () => undefined);
  apiMock.put.mockImplementation(async () => undefined);
  apiMock.remove.mockImplementation(async () => undefined);
});

function renderPanel() {
  return renderWithClient(
    <AiBehaviorPanel characterId="c1" characterName="IA Teste" />,
  );
}

const evaluateButton = () =>
  screen.getByRole("button", { name: /Avaliar comportamento/ }) as HTMLButtonElement;

describe("AiBehaviorPanel", () => {
  it("mostra estado vazio quando não há decisões", async () => {
    renderPanel();
    expect(
      await screen.findByText("Nenhuma decisão registrada ainda."),
    ).toBeDefined();
  });

  it("avalia e mostra NO_ACTION sem oferecer execução", async () => {
    renderPanel();
    await screen.findByText("Nenhuma decisão registrada ainda.");

    const user = userEvent.setup();
    await user.click(evaluateButton());

    expect(
      await screen.findByText(
        "Nenhuma ação indicada para o contexto atual.",
      ),
    ).toBeDefined();
    expect(screen.getByText(/Nenhuma ação · Sem ação/)).toBeDefined();
    expect(
      screen.queryByRole("button", { name: /Executar decisão/ }),
    ).toBeNull();
  });

  it("avalia SEND_MESSAGE, executa e sincroniza a auditoria", async () => {
    apiMock.post.mockImplementation(async (path: string) => {
      if (path === "/api/ai-behavior/evaluate") {
        return {
          decision: decision({
            status: "DECIDED",
            actionType: "SEND_MESSAGE",
            conversationId: "conv-1",
            reason: "conversa ativa com personagem do usuário",
          }),
        };
      }
      return {
        decision: decision({
          status: "EXECUTED",
          actionType: "SEND_MESSAGE",
          conversationId: "conv-1",
          executedMessageId: "m1",
        }),
      };
    });

    renderPanel();
    await screen.findByText("Nenhuma decisão registrada ainda.");
    const fetchesBefore = decisionsFetches;

    const user = userEvent.setup();
    await user.click(evaluateButton());
    expect(
      await screen.findByText(
        "conversa ativa com personagem do usuário",
      ),
    ).toBeDefined();

    await user.click(screen.getByRole("button", { name: /Executar decisão/ }));
    await waitFor(() => {
      expect(apiMock.post).toHaveBeenCalledWith(
        "/api/ai-behavior/execute",
        { decisionId: "d1" },
      );
    });
    expect(await screen.findByText("Decisão executada.")).toBeDefined();
    expect(
      screen.getByText("Enviar mensagem · Executado"),
    ).toBeDefined();
    expect(screen.getByText("Mensagem gerada na conversa.")).toBeDefined();
    await waitFor(() =>
      expect(decisionsFetches).toBeGreaterThan(fetchesBefore),
    );
  });

  it("mostra falha de execução com motivo técnico", async () => {
    apiMock.post.mockImplementation(async (path: string) => {
      if (path === "/api/ai-behavior/evaluate") {
        return {
          decision: decision({
            status: "DECIDED",
            actionType: "SEND_MESSAGE",
            conversationId: "conv-1",
          }),
        };
      }
      return {
        decision: decision({
          status: "FAILED",
          actionType: "SEND_MESSAGE",
          policyCode: "PROVIDER_ERROR",
        }),
      };
    });

    renderPanel();
    await screen.findByText("Nenhuma decisão registrada ainda.");
    const user = userEvent.setup();
    await user.click(evaluateButton());
    await user.click(await screen.findByRole("button", { name: /Executar decisão/ }));

    expect(
      await screen.findByText("Enviar mensagem · Falha na execução"),
    ).toBeDefined();
    expect(screen.getByText(/PROVIDER_ERROR/)).toBeDefined();
  });

  it("mostra erro quando a avaliação falha", async () => {
    apiMock.post.mockRejectedValueOnce(
      new ApiError("Falha ao consultar a fonte", 502, "SOURCE_UNAVAILABLE"),
    );

    renderPanel();
    await screen.findByText("Nenhuma decisão registrada ainda.");
    const user = userEvent.setup();
    await user.click(evaluateButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Falha ao consultar a fonte");
  });

  it("desabilita o botão durante a avaliação", async () => {
    let resolveEvaluate: (value: unknown) => void = () => undefined;
    apiMock.post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveEvaluate = resolve;
        }),
    );

    renderPanel();
    await screen.findByText("Nenhuma decisão registrada ainda.");
    const user = userEvent.setup();
    await user.click(evaluateButton());

    await waitFor(() => expect(evaluateButton().disabled).toBe(true));
    resolveEvaluate({ decision: decision() });
    await waitFor(() => expect(evaluateButton().disabled).toBe(false));
  });
});
