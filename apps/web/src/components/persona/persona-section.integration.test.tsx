import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PersonaSection } from "@/components/persona/persona-section";
import { ApiError } from "@/lib/api";
import type { PersonaEvidence, PersonaTrait, PersonaView } from "@/lib/persona";
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

const sessionMock = vi.hoisted(() => ({
  session: {
    data: { user: { role: "USER" as string } },
    isPending: false,
  },
}));

vi.mock("@/providers/session-provider", () => ({
  useSession: () => sessionMock.session,
}));

function makeTrait(overrides: Partial<PersonaTrait> & { id: string; key: string }): PersonaTrait {
  return {
    value: "Valor",
    confidence: 1,
    sourceKind: "MANUAL",
    evidenceId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeEvidence(
  overrides: Partial<PersonaEvidence> & { id: string; title: string },
): PersonaEvidence {
  return {
    traitKey: "interests",
    proposedValue: "Astronomia",
    sourceType: "INTERVIEW",
    url: null,
    publishedAt: null,
    excerpt: "Trecho da fonte.",
    confidence: 0.9,
    status: "APPROVED",
    reviewedById: null,
    reviewedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    role: "AUTHORITATIVE",
    ...overrides,
  };
}

function makePersona(overrides: Partial<PersonaView> = {}): PersonaView {
  return {
    exists: true,
    id: "p1",
    characterId: "c1",
    origin: "REAL_DRIVER",
    summary: "Resumo atual da persona.",
    schemaVersion: "persona.v1",
    traits: [
      makeTrait({ id: "t1", key: "humor", value: "Seco" }),
      makeTrait({
        id: "t2",
        key: "interests",
        value: "Astronomia",
        confidence: 0.9,
        sourceKind: "EVIDENCE",
        evidenceId: "e-approved",
      }),
    ],
    evidences: [
      makeEvidence({
        id: "e-proposed",
        traitKey: "humor",
        title: "Entrevista pendente",
        proposedValue: "Provocado",
        status: "PROPOSED",
        role: null,
        confidence: 0.6,
      }),
      makeEvidence({ id: "e-approved", title: "Biografia" }),
      makeEvidence({
        id: "e-supporting",
        title: "Perfil oficial",
        sourceType: "OFFICIAL_PROFILE",
        role: "SUPPORTING",
        confidence: 0.7,
      }),
      makeEvidence({
        id: "e-conflicting",
        title: "Declaração pública",
        sourceType: "PUBLIC_STATEMENT",
        proposedValue: "Cinema",
        role: "CONFLICTING",
        confidence: 0.5,
      }),
      makeEvidence({
        id: "e-rejected",
        title: "Fonte rejeitada",
        status: "REJECTED",
        role: null,
        confidence: 0.4,
      }),
      makeEvidence({
        id: "e-manual",
        traitKey: "humor",
        title: "Fonte manual",
        proposedValue: "Seco na fonte",
        confidence: 0.8,
      }),
    ],
    ...overrides,
  };
}

const EMPTY_PERSONA = makePersona({
  exists: false,
  id: null,
  summary: null,
  traits: [],
  evidences: [],
});

let personaFixture: PersonaView;

function renderSection(showEvidence = true) {
  return renderWithClient(
    <PersonaSection
      characterId="c1"
      characterName="Alicya"
      showEvidence={showEvidence}
    />,
  );
}

beforeEach(() => {
  personaFixture = makePersona();
  sessionMock.session.data.user.role = "USER";

  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/characters/c1/persona") {
      return { persona: personaFixture };
    }
    throw new ApiError("Não encontrado", 404);
  });
  apiMock.patch.mockImplementation(async () => ({ persona: personaFixture }));
  apiMock.post.mockImplementation(async () => ({ persona: personaFixture }));
  apiMock.put.mockImplementation(async () => ({ persona: personaFixture }));
  apiMock.remove.mockImplementation(async () => ({ persona: personaFixture }));
});

describe("PersonaSection — leitura", () => {
  it("1) mostra loading enquanto a persona carrega", () => {
    apiMock.get.mockImplementation(() => new Promise(() => undefined));
    renderSection();
    expect(screen.getByLabelText("Carregando persona")).toBeDefined();
  });

  it("2) persona inexistente mostra empty state e permite iniciar criação", async () => {
    personaFixture = EMPTY_PERSONA;
    const user = userEvent.setup();
    renderSection();
    expect(await screen.findByText("Nenhuma persona registrada")).toBeDefined();
    await user.click(screen.getByRole("button", { name: /Criar persona/ }));
    expect(screen.getByLabelText("Resumo da persona")).toBeDefined();
  });

  it("3) summary e traits com badges (Manual / Baseada em evidência)", async () => {
    renderSection();
    expect(await screen.findByText("Resumo atual da persona.")).toBeDefined();
    expect(screen.getByText("Seco")).toBeDefined();
    expect(screen.getByText("Manual")).toBeDefined();
    expect(screen.getByText("Baseada em evidência")).toBeDefined();
    expect(screen.getAllByText("Astronomia").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Persona representa tendências narrativas/),
    ).toBeDefined();
  });

  it("4) editar summary envia PATCH parcial", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Resumo atual da persona.");
    await user.click(screen.getByRole("button", { name: /Editar resumo/ }));
    const textarea = screen.getByLabelText("Resumo da persona");
    expect((textarea as HTMLTextAreaElement).value).toBe(
      "Resumo atual da persona.",
    );
    await user.clear(textarea);
    await user.type(textarea, "Novo resumo");
    await user.click(screen.getByRole("button", { name: /Salvar resumo/ }));
    expect(apiMock.patch).toHaveBeenCalledWith("/api/characters/c1/persona", {
      summary: "Novo resumo",
    });
  });

  it("5) limpar summary envia null", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Resumo atual da persona.");
    await user.click(screen.getByRole("button", { name: /Limpar resumo/ }));
    expect(apiMock.patch).toHaveBeenCalledWith("/api/characters/c1/persona", {
      summary: null,
    });
  });

  it("6) erro de API no carregamento mostra alerta e permite tentar novamente", async () => {
    apiMock.get
      .mockImplementationOnce(async () => {
        throw new ApiError("Serviço indisponível", 500);
      })
      .mockImplementation(async (path: string) => {
        if (path === "/api/characters/c1/persona") {
          return { persona: personaFixture };
        }
        throw new ApiError("Não encontrado", 404);
      });
    const user = userEvent.setup();
    renderSection();
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText("Serviço indisponível")).toBeDefined();
    await user.click(screen.getByRole("button", { name: /Tentar novamente/ }));
    expect(await screen.findByText("Resumo atual da persona.")).toBeDefined();
  });
});

describe("PersonaSection — mutations", () => {
  it("7) adicionar trait envia upsert manual", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Resumo atual da persona.");
    await user.type(screen.getByLabelText("Valor do trait"), "Direto");
    await user.click(screen.getByRole("button", { name: /Adicionar trait/ }));
    expect(apiMock.patch).toHaveBeenCalledWith("/api/characters/c1/persona", {
      traits: [{ key: "humor", value: "Direto" }],
    });
  });

  it("8) editar trait envia o novo valor", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Resumo atual da persona.");
    await user.click(screen.getByRole("button", { name: "Editar Humor" }));
    const input = screen.getByLabelText("Valor de Humor");
    expect((input as HTMLInputElement).value).toBe("Seco");
    await user.clear(input);
    await user.type(input, "Ácido");
    await user.click(screen.getByRole("button", { name: "Salvar Humor" }));
    expect(apiMock.patch).toHaveBeenCalledWith("/api/characters/c1/persona", {
      traits: [{ key: "humor", value: "Ácido" }],
    });
  });

  it("9) remover trait exige confirmação e usa DELETE do trait", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Resumo atual da persona.");
    await user.click(screen.getByRole("button", { name: "Remover Humor" }));
    await user.click(
      screen.getByRole("button", { name: "Confirmar remoção de Humor" }),
    );
    expect(apiMock.remove).toHaveBeenCalledWith(
      "/api/characters/c1/persona/traits/humor",
    );
  });

  it("10) erro de validação da API é exibido ao salvar", async () => {
    apiMock.patch.mockImplementation(async () => {
      throw new ApiError("Dados inválidos", 400, "VALIDATION_ERROR");
    });
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Resumo atual da persona.");
    await user.click(screen.getByRole("button", { name: /Editar resumo/ }));
    await user.click(screen.getByRole("button", { name: /Salvar resumo/ }));
    expect(await screen.findByText("Dados inválidos")).toBeDefined();
  });

  it("11) enquanto salva, a ação fica desabilitada", async () => {
    let resolvePatch: ((value: unknown) => void) | undefined;
    apiMock.patch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePatch = resolve;
        }),
    );
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Resumo atual da persona.");
    await user.click(screen.getByRole("button", { name: /Editar resumo/ }));
    const save = screen.getByRole("button", { name: /Salvar resumo/ });
    await user.click(save);
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      resolvePatch?.({ persona: personaFixture });
    });
  });

  it("12) não expõe JSON bruto nem confiança decimal", async () => {
    const { container } = renderSection();
    await screen.findByText("Resumo atual da persona.");
    expect(container.querySelector("pre")).toBeNull();
    expect(container.textContent).not.toContain("schemaVersion");
    expect(container.textContent).not.toContain("0.9");
    expect(container.textContent).not.toContain("0.7");
  });
});

describe("PersonaSection — evidências", () => {
  it("13) cria evidência com os campos do contrato", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Resumo atual da persona.");
    await user.click(
      screen.getByRole("button", { name: /Adicionar evidência/ }),
    );
    await user.type(screen.getByLabelText("Valor proposto"), "Corajoso");
    await user.type(screen.getByLabelText("Título"), "Entrevista 2026");
    await user.type(screen.getByLabelText("Trecho"), "Trecho da fonte");
    await user.click(
      screen.getByRole("button", { name: /Adicionar evidência/ }),
    );
    expect(apiMock.post).toHaveBeenCalledWith(
      "/api/characters/c1/persona/evidence",
      {
        traitKey: "humor",
        proposedValue: "Corajoso",
        sourceType: "INTERVIEW",
        title: "Entrevista 2026",
        url: null,
        publishedAt: null,
        excerpt: "Trecho da fonte",
        confidence: 0.7,
      },
    );
  });

  it("14) mostra status Pendente/Aprovada/Rejeitada", async () => {
    renderSection();
    await screen.findByText("Resumo atual da persona.");
    expect(screen.getByText("Pendente")).toBeDefined();
    expect(screen.getAllByText("Aprovada").length).toBeGreaterThan(0);
    expect(screen.getByText("Rejeitada")).toBeDefined();
  });

  it("15) mostra papéis Aplicada/Suporte/Conflito", async () => {
    renderSection();
    await screen.findByText("Resumo atual da persona.");
    expect(screen.getAllByText("Aplicada").length).toBeGreaterThan(0);
    expect(screen.getByText("Suporte")).toBeDefined();
    expect(screen.getByText("Conflito")).toBeDefined();
  });

  it("16) evidência aprovada com trait manual mostra Manual prevalece", async () => {
    renderSection();
    await screen.findByText("Resumo atual da persona.");
    expect(screen.getByText("Manual prevalece")).toBeDefined();
  });

  it("17) USER não vê ações administrativas de revisão", async () => {
    renderSection();
    await screen.findByText("Resumo atual da persona.");
    expect(
      screen.queryByRole("button", { name: /Aprovar evidência/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Rejeitar evidência/ }),
    ).toBeNull();
  });

  it("18) ADMIN revisa evidência pelo endpoint de review", async () => {
    sessionMock.session.data.user.role = "ADMIN";
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("Resumo atual da persona.");
    await user.click(
      screen.getByRole("button", {
        name: "Aprovar evidência Entrevista pendente",
      }),
    );
    expect(apiMock.patch).toHaveBeenCalledWith(
      "/api/persona-evidence/e-proposed",
      { status: "APPROVED" },
    );
  });

  it("19) piloto real (showEvidence) lista evidências; character não", async () => {
    const first = renderSection(true);
    expect(await within(first.container).findByText("Biografia")).toBeDefined();
    const second = renderSection(false);
    expect(
      await within(second.container).findByText("Resumo atual da persona."),
    ).toBeDefined();
    expect(within(second.container).queryByText("Biografia")).toBeNull();
  });

  it("20) admin não reexibe a mesma transição (botão do status atual desabilitado)", async () => {
    sessionMock.session.data.user.role = "ADMIN";
    renderSection();
    await screen.findByText("Resumo atual da persona.");
    const approve = screen.getByRole("button", {
      name: "Aprovar evidência Biografia",
    });
    const reject = screen.getByRole("button", {
      name: "Rejeitar evidência Fonte rejeitada",
    });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    expect((reject as HTMLButtonElement).disabled).toBe(true);
  });
});
