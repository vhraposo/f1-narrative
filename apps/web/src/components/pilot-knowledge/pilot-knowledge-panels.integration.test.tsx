import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PilotKnowledgeSection } from "@/components/pilot-knowledge/pilot-knowledge-panels";
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

const AVAILABLE_PILOT = {
  available: true,
  topic: null,
  profile: {
    available: true,
    externalIdentity: {
      externalDriverId: "ext-1",
      source: "f1db",
      name: "Piloto Teste",
      fullName: "Piloto Teste Completo",
      nationality: "NED",
      number: 33,
      wikidataQid: "Q1",
      f1dbDriverId: "pilot-teste",
    },
    identity: {
      publicName: "Piloto Teste",
      fullName: "Piloto Teste Completo",
      dateOfBirth: "1997-09-30T00:00:00.000Z",
      placeOfBirth: "Hasselt",
      nationality: "Países Baixos",
      representedCountry: "Países Baixos",
      driverNumber: 33,
      driverCode: "TES",
      currentTeamName: "Equipe Teste",
      officialLinks: { website: "https://pilot.example" },
    },
    biography: {
      display: "Biografia pública sintetizada.",
      context: "Biografia curta.",
      origin: "EXTERNAL",
      lastVerifiedAt: "2026-09-01T00:00:00.000Z",
    },
    refresh: { status: "FRESH", lastVerifiedAt: "2026-09-01T00:00:00.000Z" },
    hasPersona: true,
  },
  persona: {
    available: true,
    summary: null,
    status: "SUPPORTED",
    refresh: { status: "FRESH", lastVerifiedAt: "2026-09-01T00:00:00.000Z" },
    traits: [
      {
        traitKey: "communicationStyle",
        label: "Estilo de comunicação",
        value: "direto e conciso",
        sourceKind: "OBSERVED_PUBLIC_BEHAVIOR",
        status: "SUPPORTED",
        lastVerifiedAt: "2026-09-01T00:00:00.000Z",
      },
      {
        traitKey: "publicTone",
        label: "Tom público",
        value: "reservado",
        sourceKind: "OBSERVED_PUBLIC_BEHAVIOR",
        status: "CONFLICT",
        lastVerifiedAt: "2026-09-01T00:00:00.000Z",
      },
    ],
  },
  history: {
    available: true,
    events: [
      {
        id: "ev-1",
        category: "F1_DEBUT",
        categoryLabel: "Estreia na F1",
        title: "Estreia na F1 em 2015",
        summary: "Primeira corrida.",
        seasonYear: 2015,
        eventDate: "2015-03-15T00:00:00.000Z",
        importance: 5,
        derivation: "DERIVED_RESULTS",
        externalRaceId: "er-1",
        raceName: "GP de Estreia",
        link: { seasonId: null, raceId: null },
      },
      {
        id: "ev-2",
        category: "FIRST_WIN",
        categoryLabel: "Primeira vitória",
        title: "Primeira vitória em 2020",
        summary: null,
        seasonYear: 2020,
        eventDate: "2020-08-16T00:00:00.000Z",
        importance: 5,
        derivation: "DERIVED_RESULTS",
        externalRaceId: null,
        raceName: null,
        link: { seasonId: null, raceId: null },
      },
    ],
    relevant: [],
  },
  relationships: {
    available: true,
    entries: [
      {
        kind: "ROMANTIC_PARTNER",
        label: "Parceiro(a)",
        classification: "DIVERGENT",
        current: {
          displayName: "Pessoa do Universe",
          state: "ACTIVE",
          validFrom: "2025-01-01T00:00:00.000Z",
          validTo: null,
          origin: "UNIVERSE",
          verifiedAt: "2026-09-01T00:00:00.000Z",
        },
        externalCurrent: {
          displayName: "Pessoa Externa",
          state: "ACTIVE",
          validFrom: "2023-01-01T00:00:00.000Z",
          validTo: null,
          verifiedAt: "2026-09-01T00:00:00.000Z",
        },
        history: [
          {
            displayName: "Pessoa Antiga",
            state: "ENDED",
            validFrom: "2018-01-01T00:00:00.000Z",
            validTo: "2022-12-31T00:00:00.000Z",
            origin: "EXTERNAL",
          },
        ],
      },
    ],
    universeOverrides: [
      { id: "ov-1", kind: "ROMANTIC_PARTNER", displayName: "Pessoa do Universe" },
    ],
  },
  sources: [
    {
      id: "src-1",
      provider: "F1DB",
      sourceKind: "STRUCTURED_RELEASE",
      url: "https://f1db.example/release",
      title: "F1DB release 2026.1",
      license: "CC_BY_4_0",
      attributionRequirement: "Obrigatória",
      attributionText: "F1DB — CC BY 4.0",
      publishedAt: "2026-01-01T00:00:00.000Z",
      retrievedAt: "2026-09-01T00:00:00.000Z",
      sourceVersion: "2026.1",
    },
  ],
};

beforeEach(() => {
  apiMock.get.mockImplementation(async () => ({ pilot: AVAILABLE_PILOT }));
  apiMock.post.mockImplementation(async () => ({ relationship: { id: "ov-2" } }));
  apiMock.patch.mockImplementation(async () => ({ relationship: { id: "ov-1" } }));
  apiMock.remove.mockImplementation(async () => undefined);
});

describe("pilot knowledge panels", () => {
  it("1) mostra loading e depois a visão geral com identidade e biografia", async () => {
    let resolveQuery: ((value: unknown) => void) | undefined;
    apiMock.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveQuery = resolve as (value: unknown) => void;
        }),
    );
    renderWithClient(<PilotKnowledgeSection characterId="c1" section="overview" />);
    expect(screen.getByLabelText("Carregando conhecimento do piloto")).toBeDefined();

    (resolveQuery as ((value: unknown) => void) | undefined)?.({ pilot: AVAILABLE_PILOT });
    expect(await screen.findByText("Piloto Teste")).toBeDefined();
    expect(screen.getByText("Biografia pública sintetizada.")).toBeDefined();
    expect(screen.getByText("Fonte externa")).toBeDefined();
    expect(screen.getByText(/Última verificação/)).toBeDefined();
    expect(screen.getByText("Primeira vitória em 2020")).toBeDefined();
  });

  it("2) indisponível explica o motivo sem inventar dados", async () => {
    apiMock.get.mockImplementation(async () => ({
      pilot: { available: false, reason: "NO_EXTERNAL_BINDING" },
    }));
    renderWithClient(<PilotKnowledgeSection characterId="c1" section="overview" />);
    expect(await screen.findByText(/não possui vínculo externo/)).toBeDefined();
  });

  it("3) persona pública mostra traços, conflito e fontes com licença, sem JSON cru", async () => {
    const { container } = renderWithClient(
      <PilotKnowledgeSection characterId="c1" section="persona" />,
    );
    expect(await screen.findByText("Estilo de comunicação")).toBeDefined();
    expect(screen.getByText("direto e conciso")).toBeDefined();
    expect(screen.getByText("Fontes em conflito")).toBeDefined();
    expect(screen.getByText("F1DB release 2026.1")).toBeDefined();
    expect(screen.getByText(/CC BY 4.0/)).toBeDefined();
    expect(container.querySelector("pre")).toBeNull();
  });

  it("4) histórico lista marcos por ano e estado vazio respeitoso", async () => {
    const { unmount } = renderWithClient(
      <PilotKnowledgeSection characterId="c1" section="history" />,
    );
    expect(await screen.findByText("Estreia na F1 em 2015")).toBeDefined();
    expect(screen.getByText("Primeira vitória em 2020")).toBeDefined();
    unmount();

    apiMock.get.mockImplementation(async () => ({
      pilot: {
        ...AVAILABLE_PILOT,
        history: { available: true, events: [], relevant: [] },
      },
    }));
    renderWithClient(<PilotKnowledgeSection characterId="c1" section="history" />);
    expect(
      await screen.findByText("Nenhuma informação pública confiável encontrada."),
    ).toBeDefined();
  });

  it("5) relacionamentos mostram classificação, origem, fonte externa e histórico", async () => {
    renderWithClient(<PilotKnowledgeSection characterId="c1" section="relationships" />);
    expect(await screen.findByText("Parceiro(a)")).toBeDefined();
    expect(screen.getByText("Divergente da fonte")).toBeDefined();
    expect(screen.getByText("Pessoa do Universe")).toBeDefined();
    expect(screen.getByText("Personalização do Universe")).toBeDefined();
    expect(screen.getByText(/Fonte externa atual: Pessoa Externa/)).toBeDefined();
    expect(screen.getByText(/Pessoa Antiga/)).toBeDefined();
  });

  it("6) remove override e cria personalização com payload correto", async () => {
    const user = userEvent.setup();
    renderWithClient(<PilotKnowledgeSection characterId="c1" section="relationships" />);
    await screen.findByText("Parceiro(a)");

    await user.click(screen.getByRole("button", { name: "Remover personalização" }));
    expect(apiMock.remove).toHaveBeenCalledWith("/api/pilot-knowledge/relationships/ov-1");

    await user.click(screen.getByRole("button", { name: "Personalizar relacionamento" }));
    await user.type(screen.getByLabelText("Nome"), "Pessoa Nova");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    expect(apiMock.post).toHaveBeenCalledWith(
      "/api/pilot-knowledge/drivers/c1/relationships",
      expect.objectContaining({
        kind: "ROMANTIC_PARTNER",
        targetType: "PUBLIC_PERSON",
        displayName: "Pessoa Nova",
        state: "ACTIVE",
      }),
    );
  });

  it("7) erro mostra mensagem sanitizada com retry", async () => {
    apiMock.get.mockImplementation(async () => {
      throw new ApiError("Persona indisponível neste ambiente (migração pendente).", 503, "UNAVAILABLE");
    });
    renderWithClient(<PilotKnowledgeSection characterId="c1" section="overview" />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Persona indisponível neste ambiente");
    expect(alert.textContent).not.toContain("Internal Server Error");
    expect(within(alert.closest("div") as HTMLElement).getByRole("button", { name: "Tentar novamente" })).toBeDefined();
  });

  it("8) edita a biografia do Universe com payload correto", async () => {
    const user = userEvent.setup();
    renderWithClient(<PilotKnowledgeSection characterId="c1" section="overview" />);
    await screen.findByText("Biografia pública sintetizada.");

    await user.click(screen.getByRole("button", { name: "Editar biografia" }));
    const field = screen.getByLabelText("Biografia do Universe");
    expect((field as HTMLTextAreaElement).value).toBe("Biografia pública sintetizada.");

    await user.clear(field);
    await user.type(field, "Biografia do meu universo.");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(apiMock.patch).toHaveBeenCalledWith(
      "/api/pilot-knowledge/drivers/c1/biography",
      { display: "Biografia do meu universo." },
    );
  });

  it("9) restaura a biografia personalizada para a fonte externa", async () => {
    apiMock.get.mockImplementation(async () => ({
      pilot: {
        ...AVAILABLE_PILOT,
        profile: {
          ...AVAILABLE_PILOT.profile,
          biography: {
            display: "Biografia do Universe.",
            context: "Biografia do Universe.",
            origin: "UNIVERSE",
            lastVerifiedAt: "2026-09-01T00:00:00.000Z",
          },
        },
      },
    }));
    const user = userEvent.setup();
    renderWithClient(<PilotKnowledgeSection characterId="c1" section="overview" />);
    await screen.findByText("Biografia do Universe.");

    await user.click(screen.getByRole("button", { name: "Restaurar da fonte" }));
    expect(apiMock.remove).toHaveBeenCalledWith("/api/pilot-knowledge/drivers/c1/biography");
  });

  it("10) usa 'Não informado' quando o espelho não possui o campo", async () => {
    apiMock.get.mockImplementation(async () => ({
      pilot: {
        ...AVAILABLE_PILOT,
        profile: {
          ...AVAILABLE_PILOT.profile,
          identity: {
            ...AVAILABLE_PILOT.profile.identity,
            placeOfBirth: null,
            driverCode: null,
          },
        },
      },
    }));
    renderWithClient(<PilotKnowledgeSection characterId="c1" section="overview" />);
    await screen.findByText("Biografia pública sintetizada.");
    expect(screen.getAllByText("Não informado.").length).toBeGreaterThanOrEqual(2);
  });

  it("11) renderiza biografia rica em múltiplos parágrafos", async () => {
    apiMock.get.mockImplementation(async () => ({
      pilot: {
        ...AVAILABLE_PILOT,
        profile: {
          ...AVAILABLE_PILOT.profile,
          biography: {
            display:
              "Piloto Teste nasceu em Hasselt, em 30 de setembro de 1997.\n\nNo kart, começou cedo e venceu campeonatos.\n\nNa Fórmula 1, passou pela Equipe Teste.",
            context: "Biografia curta.",
            origin: "EXTERNAL",
            lastVerifiedAt: "2026-09-01T00:00:00.000Z",
          },
        },
      },
    }));
    const { container } = renderWithClient(
      <PilotKnowledgeSection characterId="c1" section="overview" />,
    );
    await screen.findByText(/Piloto Teste nasceu em Hasselt/);
    const paragraphs = container.querySelectorAll("p");
    const biographyParagraphs = Array.from(paragraphs).filter((paragraph) =>
      paragraph.textContent?.includes("kart") ||
      paragraph.textContent?.includes("Hasselt") ||
      paragraph.textContent?.includes("Fórmula 1, passou"),
    );
    expect(biographyParagraphs.length).toBe(3);
  });
});
