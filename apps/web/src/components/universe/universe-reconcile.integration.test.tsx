import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import UniverseEditorPage from "@/app/app/universe/page";
import { ApiError } from "@/lib/api";
import type { PlayerEntrySeason, PlayerEntrySetup } from "@/lib/player-entry";
import type { RosterComparison } from "@/lib/universe";
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
    data: {
      user: { role: "ADMIN" as string },
    },
    isPending: false,
  },
}));

vi.mock("@/providers/session-provider", () => ({
  useSession: () => sessionMock.session,
}));

const SEASONS: PlayerEntrySeason[] = [
  {
    id: "s1",
    year: 2026,
    status: "ACTIVE",
    externalSeasonId: "es1",
    externalSeasonYear: 2026,
    externalSeasonStatus: "ACTIVE",
  },
];

function makeRosterComparison(overrides: Partial<RosterComparison> = {}): RosterComparison {
  return {
    season: { id: "s1", year: 2026, name: "2026", status: "ACTIVE" },
    comparable: true,
    teams: [
      {
        id: "t1",
        name: "McLaren",
        shortName: "MCL",
        color: "#ff8000",
        externalTeamId: "mclaren",
        status: "DIVERGENT",
        seats: [
          {
            seat: 1,
            status: "MATCH",
            source: { externalDriverId: "e1", name: "Lando Norris", number: 1 },
            universe: {
              entryId: "en1",
              driverProfileId: "d1",
              characterId: "c1",
              characterName: "Lando Norris",
              provenance: "IMPORTED",
            },
            canRestore: true,
          },
          {
            seat: 2,
            status: "DIVERGENCE",
            source: { externalDriverId: "e2", name: "Oscar Piastri", number: 81 },
            universe: {
              entryId: "en2",
              driverProfileId: "d2",
              characterId: "c2",
              characterName: "Meu Piloto",
              provenance: "CANONICAL",
            },
            canRestore: true,
          },
        ],
      },
    ],
    ...overrides,
  };
}

type ReconBinding = {
  id: string;
  confidence: "SUGGESTED" | "CONFIRMED";
  targetLabel: string | null;
} | null;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const worldFixture = {
  id: "w1",
  key: "default",
  currentDate: "2026-09-11T00:00:00.000Z",
  currentSeasonId: "s1",
  currentRaceId: null,
  currentSession: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z",
};

let comparisonFixture: RosterComparison;
let reconBinding: ReconBinding;
let failRecon: boolean;
let reconGate: ReturnType<typeof deferred<unknown>> | null;

beforeEach(() => {
  comparisonFixture = makeRosterComparison();
  reconBinding = null;
  failRecon = false;
  reconGate = null;
  sessionMock.session.data.user.role = "ADMIN";
  apiMock.get.mockClear();
  apiMock.post.mockClear();
  apiMock.remove.mockClear();

  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/world") {
      return { world: worldFixture };
    }
    if (path.startsWith("/api/universe/player-entry/setup")) {
      const setup: PlayerEntrySetup = {
        seasons: SEASONS,
        selection: null,
      };
      return setup;
    }
    const rosterMatch = path.match(/\/api\/universe\/roster-comparison\/([^/]+)/);
    if (rosterMatch) {
      return comparisonFixture;
    }
    if (path.startsWith("/api/reconciliation/candidates/DRIVER/")) {
      if (failRecon) throw new ApiError("Falha", 500);
      if (reconGate) return reconGate.promise;
      return {
        listing: {
          external: { kind: "DRIVER", source: "jolpica", label: "Oscar Piastri" },
          currentBinding: reconBinding,
          candidates: [{ id: "c2", label: "Meu Piloto", score: 0.87 }],
        },
      };
    }
    throw new ApiError("Não encontrado", 404);
  });

  apiMock.post.mockImplementation(async (path: string) => {
    if (path === "/api/reconciliation/bindings/suggest") {
      reconBinding = {
        id: "b-sug",
        confidence: "SUGGESTED",
        targetLabel: "Meu Piloto",
      };
      return { binding: reconBinding };
    }
    if (path === "/api/reconciliation/bindings/confirm") {
      reconBinding = {
        id: "b-conf",
        confidence: "CONFIRMED",
        targetLabel: "Meu Piloto",
      };
      return { binding: reconBinding };
    }
    return { team: makeRosterComparison().teams[0] };
  });

  apiMock.remove.mockImplementation(async (path: string) => {
    reconBinding = null;
    return { ok: true, kind: "DRIVER", id: path.split("/").pop() };
  });
});

async function renderPage() {
  renderWithClient(<UniverseEditorPage />);
  await screen.findByRole("heading", { level: 1, name: "Editor de Universo" });
}

async function openDialog() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Vincular" }));
  return { user, dialog: await screen.findByRole("dialog") };
}

describe("Universe Editor — Reconciliação de fonte", () => {
  it("abre o diálogo a partir do assento e mostra os candidatos", async () => {
    await renderPage();

    const { dialog } = await openDialog();

    expect(
      within(dialog).getByRole("heading", { name: "Reconciliar entidade" }),
    ).toBeDefined();
    expect(within(dialog).getByText("Fonte externa · piloto")).toBeDefined();
    expect(within(dialog).getByText("Oscar Piastri")).toBeDefined();
    expect(within(dialog).getByText("Nº 81")).toBeDefined();
    expect(
      within(dialog).getByText("Possível correspondência · similaridade de nome 87%"),
    ).toBeDefined();
    expect(
      within(dialog).getByRole("button", { name: "Confirmar vínculo" }),
    ).toBeDefined();
    expect(
      within(dialog).getByRole("button", { name: "Manter separado" }),
    ).toBeDefined();
  });

  it("sugere e confirma o vínculo no fluxo sem vínculo existente", async () => {
    await renderPage();

    const { user, dialog } = await openDialog();
    expect(
      (within(dialog).getByRole("radio", { name: /Meu Piloto/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);

    await user.click(within(dialog).getByRole("button", { name: "Confirmar vínculo" }));

    expect(apiMock.post).toHaveBeenCalledWith(
      "/api/reconciliation/bindings/suggest",
      {
        kind: "DRIVER",
        source: "jolpica",
        externalId: "e2",
        candidateId: "c2",
      },
    );
    expect(apiMock.post).toHaveBeenCalledWith(
      "/api/reconciliation/bindings/confirm",
      { kind: "DRIVER", source: "jolpica", externalId: "e2" },
    );

    expect(await within(dialog).findByText("Vínculo confirmado")).toBeDefined();
    expect(
      within(dialog).getByRole("button", { name: "Desfazer vínculo" }),
    ).toBeDefined();
  });

  it("assento alinhado mostra Ver vínculo e permite desfazer o vínculo", async () => {
    comparisonFixture = makeRosterComparison({
      teams: [
        {
          id: "t1",
          name: "McLaren",
          shortName: "MCL",
          color: "#ff8000",
          externalTeamId: "mclaren",
          status: "MATCH",
          seats: [
            {
              seat: 1,
              status: "MATCH",
              source: { externalDriverId: "e1", name: "Lando Norris", number: 1 },
              universe: {
                entryId: "en1",
                driverProfileId: "d1",
                characterId: "c1",
                characterName: "Lando Norris",
                provenance: "IMPORTED",
              },
              canRestore: true,
            },
          ],
        },
      ],
    });
    reconBinding = {
      id: "b-conf",
      confidence: "CONFIRMED",
      targetLabel: "Lando Norris",
    };
    await renderPage();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Ver vínculo" }),
    );
    const dialog = await screen.findByRole("dialog");

    expect(
      await within(dialog).findByText("Vínculo confirmado"),
    ).toBeDefined();
    expect(within(dialog).getByText("Lando Norris")).toBeDefined();

    await user.click(within(dialog).getByRole("button", { name: "Desfazer vínculo" }));

    expect(apiMock.remove).toHaveBeenCalledWith("/api/reconciliation/bindings/b-conf");

    expect(
      await within(dialog).findByText("Possível correspondência · similaridade de nome 87%"),
    ).toBeDefined();
  });

  it("manter separado fecha o diálogo sem criar vínculo", async () => {
    await renderPage();

    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByRole("button", { name: "Manter separado" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(apiMock.post).not.toHaveBeenCalledWith(
      "/api/reconciliation/bindings/suggest",
      expect.anything(),
    );
  });

  it("vínculo sugerido expõe confirmar/descartar e descartar desfaz", async () => {
    reconBinding = {
      id: "b-sug",
      confidence: "SUGGESTED",
      targetLabel: "Meu Piloto",
    };
    await renderPage();

    const { user, dialog } = await openDialog();

    expect(within(dialog).getByText("Vínculo sugerido")).toBeDefined();
    expect(
      within(dialog).getByRole("button", { name: "Confirmar vínculo" }),
    ).toBeDefined();

    await user.click(
      within(dialog).getByRole("button", { name: "Descartar sugestão" }),
    );

    expect(apiMock.remove).toHaveBeenCalledWith("/api/reconciliation/bindings/b-sug");

    expect(
      await within(dialog).findByText("Possível correspondência · similaridade de nome 87%"),
    ).toBeDefined();
  });

  it("erro ao carregar candidatos mostra retry e recupera", async () => {
    failRecon = true;
    await renderPage();

    const { user, dialog } = await openDialog();

    expect(await within(dialog).findByText("Falha")).toBeDefined();

    failRecon = false;
    await user.click(within(dialog).getByRole("button", { name: "Tentar novamente" }));

    expect(
      await within(dialog).findByText("Possível correspondência · similaridade de nome 87%"),
    ).toBeDefined();
  });

  it("mostra estado de carregamento enquanto os candidatos são buscados", async () => {
    reconGate = deferred<unknown>();
    await renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Vincular" }));
    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).getByText("Carregando candidatos..."),
    ).toBeDefined();

    reconGate.resolve({
      listing: {
        external: { kind: "DRIVER", source: "jolpica", label: "Oscar Piastri" },
        currentBinding: null,
        candidates: [{ id: "c2", label: "Meu Piloto", score: 0.87 }],
      },
    });

    expect(
      await within(dialog).findByText("Possível correspondência · similaridade de nome 87%"),
    ).toBeDefined();
  });

  it("sem candidatos informa que não há correspondência disponível", async () => {
    await renderPage();
    const user = userEvent.setup();

    apiMock.get.mockImplementation(async (path: string) => {
      if (path === "/api/world") {
        return { world: worldFixture };
      }
      if (path.startsWith("/api/universe/player-entry/setup")) {
        return { seasons: SEASONS, selection: null };
      }
      if (path.match(/\/api\/universe\/roster-comparison\//)) {
        return comparisonFixture;
      }
      if (path.startsWith("/api/reconciliation/candidates/DRIVER/")) {
        return {
          listing: {
            external: { kind: "DRIVER", source: "jolpica", label: "Oscar Piastri" },
            currentBinding: null,
            candidates: [],
          },
        };
      }
      throw new ApiError("Não encontrado", 404);
    });

    await user.click(await screen.findByRole("button", { name: "Vincular" }));
    const dialog = await screen.findByRole("dialog");

    expect(
      await within(dialog).findByText(/Nenhum candidato disponível no universo/),
    ).toBeDefined();

    await user.click(
      within(dialog).getAllByRole("button", { name: "Fechar" })[1],
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Universe Editor — Reconciliação por permissão", () => {
  it("usuário comum abre o diálogo e vê os candidatos sem ações de administração", async () => {
    sessionMock.session.data.user.role = "USER";
    await renderPage();

    const { dialog } = await openDialog();

    expect(
      within(dialog).getByRole("heading", { name: "Reconciliar entidade" }),
    ).toBeDefined();
    expect(
      within(dialog).getByText("Possível correspondência · similaridade de nome 87%"),
    ).toBeDefined();
    expect(
      within(dialog).queryByRole("button", { name: "Confirmar vínculo" }),
    ).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: "Manter separado" }),
    ).toBeDefined();
    expect(
      within(
        dialog,
      ).getByText(/Somente administradores podem confirmar/),
    ).toBeDefined();
  });

  it("usuário comum não vê Desfazer vínculo em vínculo confirmado", async () => {
    sessionMock.session.data.user.role = "USER";
    reconBinding = {
      id: "b-conf",
      confidence: "CONFIRMED",
      targetLabel: "Lando Norris",
    };
    await renderPage();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Ver vínculo" }),
    );
    const dialog = await screen.findByRole("dialog");

    expect(
      await within(dialog).findByText("Vínculo confirmado"),
    ).toBeDefined();
    expect(
      within(dialog).queryByRole("button", { name: "Desfazer vínculo" }),
    ).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: "Concluir" }),
    ).toBeDefined();
  });

  it("usuário comum não vê Confirmar vínculo nem Descartar sugestão em vínculo sugerido", async () => {
    sessionMock.session.data.user.role = "USER";
    reconBinding = {
      id: "b-sug",
      confidence: "SUGGESTED",
      targetLabel: "Meu Piloto",
    };
    await renderPage();

    const { dialog } = await openDialog();

    expect(within(dialog).getByText("Vínculo sugerido")).toBeDefined();
    expect(
      within(dialog).queryByRole("button", { name: "Confirmar vínculo" }),
    ).toBeNull();
    expect(
      within(dialog).queryByRole("button", { name: "Descartar sugestão" }),
    ).toBeNull();
    expect(
      within(dialog).getAllByRole("button", { name: "Fechar" })[1],
    ).toBeDefined();
  });

  it("administrador mantém todas as ações e sem aviso de permissão", async () => {
    sessionMock.session.data.user.role = "ADMIN";
    reconBinding = {
      id: "b-sug",
      confidence: "SUGGESTED",
      targetLabel: "Meu Piloto",
    };
    await renderPage();

    const { dialog } = await openDialog();

    expect(
      within(dialog).getByRole("button", { name: "Confirmar vínculo" }),
    ).toBeDefined();
    expect(
      within(dialog).getByRole("button", { name: "Descartar sugestão" }),
    ).toBeDefined();
    expect(
      within(
        dialog,
      ).queryByText(/Somente administradores podem confirmar/),
    ).toBeNull();
  });
});