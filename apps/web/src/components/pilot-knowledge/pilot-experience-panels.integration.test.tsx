import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PilotEvolutionCard,
  PilotMemoriesPanel,
} from "@/components/pilot-knowledge/pilot-experience-panels";
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

const MEMORY_DERIVED = {
  id: "m1",
  content: "Campeão mundial em 2026.",
  summary: "Campeão mundial em 2026",
  memoryType: "CHAMPIONSHIP",
  importance: "CRITICAL",
  derivation: "RULE_DERIVED",
  status: "ACTIVE",
  revision: 2,
  source: {
    experienceId: "x1",
    source: "STANDING",
    sourceKey: "season:s1:champion",
    seasonYear: 2026,
    raceId: null,
    occurredAt: "2026-12-01T00:00:00.000Z",
  },
  createdAt: "2026-12-02T00:00:00.000Z",
  updatedAt: "2026-12-02T00:00:00.000Z",
};

const MEMORY_MANUAL = {
  id: "m2",
  content: "Para este Universe, aquela corrida foi decisiva.",
  summary: null,
  memoryType: "PERSONAL_MILESTONE",
  importance: "HIGH",
  derivation: "MANUAL",
  status: "ACTIVE",
  revision: 1,
  source: { experienceId: null, source: "MANUAL", sourceKey: null },
  createdAt: "2026-12-02T00:00:00.000Z",
  updatedAt: "2026-12-02T00:00:00.000Z",
};

const PREVIEW = {
  preview: {
    available: true,
    evolutionRevision: 0,
    pendingFingerprint: "fp-1",
    pendingCount: 1,
    traits: [
      {
        key: "confidence",
        label: "Confiança",
        value: "Elevada após título mundial",
        origin: "RULE_DERIVED",
        beforeConfidence: 0.5,
        afterConfidence: 0.56,
        skippedManual: false,
        reasons: [
          {
            ruleCode: "FIRST_WORLD_CHAMPIONSHIP",
            experienceId: "x1",
            experienceTitle: "Campeão mundial em 2026",
            delta: 0.06,
            reason: "Primeiro campeonato mundial neste Universe",
          },
        ],
      },
    ],
    skipped: [],
  },
};

beforeEach(() => {
  apiMock.get.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/pilot-context/c1/memories")) {
      return { memories: [MEMORY_DERIVED, MEMORY_MANUAL] };
    }
    throw new Error(`unexpected GET ${path}`);
  });
  apiMock.post.mockImplementation(async (path: string) => {
    if (path.endsWith("/evolution/preview")) return PREVIEW;
    if (path.endsWith("/evolution/apply")) {
      return { evolution: { applied: true, evolutionRevision: 1, effectsApplied: 1, timelineEventId: "t1" } };
    }
    if (path.endsWith("/reconcile")) {
      return {
        reconcile: {
          experiences: { created: 1, updated: 0, invalidated: 0 },
          memories: { created: 1, superseded: 0, invalidated: 0 },
        },
      };
    }
    if (path.endsWith("/memories")) return { memory: MEMORY_MANUAL };
    throw new Error(`unexpected POST ${path}`);
  });
  apiMock.patch.mockImplementation(async () => ({ memory: { ...MEMORY_MANUAL, status: "ARCHIVED" } }));
});

describe("pilot experience panels", () => {
  it("1) lista memórias com badges de origem, status e importância", async () => {
    renderWithClient(<PilotMemoriesPanel characterId="c1" />);
    expect(await screen.findByText("Campeão mundial em 2026.")).toBeDefined();
    expect(screen.getByText("Derivada")).toBeDefined();
    expect(screen.getByText("Manual")).toBeDefined();
    expect(screen.getByText("Crítica")).toBeDefined();
    expect(screen.getAllByText("Ativa").length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText(/corrigir a fonte invalida ou substitui esta memória/),
    ).toBeDefined();
  });

  it("2) filtro de situação reconsulta a API", async () => {
    const user = userEvent.setup();
    renderWithClient(<PilotMemoriesPanel characterId="c1" />);
    await screen.findByText("Campeão mundial em 2026.");
    await user.click(screen.getByLabelText("Situação"));
    await user.click(screen.getByRole("option", { name: "Invalidadas" }));
    await waitFor(() => {
      const calls = apiMock.get.mock.calls.map((call) => String(call[0]));
      expect(calls.some((path) => path.includes("status=INVALIDATED"))).toBe(true);
    });
  });

  it("3) criação manual envia payload e mostra aviso de Universe", async () => {
    const user = userEvent.setup();
    renderWithClient(<PilotMemoriesPanel characterId="c1" />);
    await screen.findByText("Campeão mundial em 2026.");
    await user.click(screen.getByRole("button", { name: "Adicionar memória" }));
    await user.type(screen.getByLabelText("Memória"), "Memória nova do usuário");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => {
      expect(apiMock.post).toHaveBeenCalledWith(
        "/api/pilot-context/c1/memories",
        expect.objectContaining({
          content: "Memória nova do usuário",
          importance: "MEDIUM",
          memoryType: null,
        }),
      );
    });
    expect(
      await screen.findByText("Memória criada somente neste Universe."),
    ).toBeDefined();
  });

  it("4) arquiva manual e não oferece arquivo para derivada", async () => {
    const user = userEvent.setup();
    renderWithClient(<PilotMemoriesPanel characterId="c1" />);
    await screen.findByText("Campeão mundial em 2026.");
    const archiveButtons = screen.getAllByRole("button", { name: "Arquivar" });
    expect(archiveButtons).toHaveLength(1);
    await user.click(archiveButtons[0]!);
    expect(apiMock.patch).toHaveBeenCalledWith("/api/pilot-context/c1/memories/m2", {
      status: "ARCHIVED",
    });
  });

  it("5) reconciliação mostra o resumo determinístico", async () => {
    const user = userEvent.setup();
    renderWithClient(<PilotMemoriesPanel characterId="c1" />);
    await screen.findByText("Campeão mundial em 2026.");
    await user.click(screen.getByRole("button", { name: /Reconciliar com os fatos/ }));
    expect(
      await screen.findByText(/Reconciliação concluída: 1 nova\(s\), 0 invalidada\(s\)/),
    ).toBeDefined();
    expect(apiMock.post).toHaveBeenCalledWith("/api/pilot-context/c1/reconcile", {});
  });

  it("6) evolução: preview before/after, razão e apply com fingerprint", async () => {
    const user = userEvent.setup();
    renderWithClient(<PilotEvolutionCard characterId="c1" />);
    expect(screen.queryByText(/Confiança/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Pré-visualizar evolução" }));
    expect(await screen.findByText(/Confiança: 50% → 56%/)).toBeDefined();
    expect(screen.getByText(/Primeiro campeonato mundial neste Universe/)).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Aplicar evolução" }));
    await waitFor(() => {
      expect(apiMock.post).toHaveBeenCalledWith("/api/pilot-context/c1/evolution/apply", {
        expectedRevision: 0,
        expectedPendingFingerprint: "fp-1",
      });
    });
    expect(await screen.findByText(/Evolução aplicada \(revisão 1\)/)).toBeDefined();
  });

  it("7) erro de apply (stale) é exibido sem aplicar", async () => {
    const user = userEvent.setup();
    apiMock.post.mockImplementation(async (path: string) => {
      if (path.endsWith("/evolution/preview")) return PREVIEW;
      if (path.endsWith("/evolution/apply")) throw new Error("O conjunto de efeitos pendentes mudou; gere um novo preview.");
      throw new Error(`unexpected POST ${path}`);
    });
    renderWithClient(<PilotEvolutionCard characterId="c1" />);
    await user.click(screen.getByRole("button", { name: "Pré-visualizar evolução" }));
    await screen.findByText(/Confiança: 50% → 56%/);
    await user.click(screen.getByRole("button", { name: "Aplicar evolução" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "O conjunto de efeitos pendentes mudou; gere um novo preview.",
    );
    expect(screen.queryByText(/Evolução aplicada/)).toBeNull();
  });
});
