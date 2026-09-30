import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChampionsPanel } from "@/components/timeline/champions-panel";
import { ApiError } from "@/lib/api";
import type { ChampionChangePreview, ChampionEntry } from "@/lib/timeline";
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

function makeEntry(overrides: Partial<ChampionEntry> & { seasonId: string | null; year: number }): ChampionEntry {
  return {
    externalChampion: {
      externalDriverId: "ext-1",
      name: "Piloto Externo",
      source: "synth",
      sourceType: "STANDING",
    },
    canonicalChampion: null,
    universeChampion: {
      driverProfileId: "d1",
      characterId: "c1",
      name: "Piloto Externo",
      externalDriverId: "ext-1",
    },
    state: "MATCH",
    origin: "STANDING",
    baseline: false,
    sourceConflict: false,
    canEdit: true,
    canRestore: false,
    blockedReason: null,
    restoreDriverProfileId: null,
    ...overrides,
  };
}

const MATCH = makeEntry({ seasonId: "s1", year: 2099 });
const DIVERGENT = makeEntry({
  seasonId: "s2",
  year: 2098,
  state: "DIVERGENT",
  universeChampion: {
    driverProfileId: "d2",
    characterId: "c2",
    name: "Alicya Sintética",
    externalDriverId: null,
  },
  canRestore: true,
  restoreDriverProfileId: "d1",
});
const DERIVED = makeEntry({
  seasonId: "s-2097",
  year: 2097,
  origin: "DERIVED",
  canEdit: false,
  blockedReason: "DERIVED_CHAMPION",
});

const PREVIEW: ChampionChangePreview = {
  previewToken: "sha256:token-teste-123456",
  seasonId: "s2",
  year: 2098,
  mode: "RESTORE",
  externalChampion: {
    externalDriverId: "ext-1",
    name: "Piloto Externo",
    source: "synth",
    sourceType: "STANDING",
  },
  before: {
    driverProfileId: "d2",
    characterId: "c2",
    name: "Alicya Sintética",
    externalDriverId: null,
  },
  after: {
    driverProfileId: "d1",
    characterId: "c1",
    name: "Piloto Externo",
    externalDriverId: "ext-1",
  },
  changes: [{ field: "champion", before: "Alicya Sintética", after: "Piloto Externo" }],
  commandCount: 2,
};

beforeEach(() => {
  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/timeline/champions") {
      return { champions: [MATCH, DIVERGENT, DERIVED] };
    }
    if (path === "/api/timeline/champions/s2") {
      return {
        champion: DIVERGENT,
        history: [
          {
            id: "e1",
            sequence: 5,
            worldDate: "2099-01-01T00:00:00.000Z",
            kind: "STANDING_CORRECTED",
            causedBy: "USER",
            supersedesId: null,
            supersededById: null,
            isCorrection: true,
            isSuperseded: false,
            summary: "Standing corrigido: Alicya Sintética",
            race: null,
            season: { id: "s2", year: 2098, name: "2098" },
            driver: { id: "d2", name: "Alicya Sintética" },
            team: null,
            number: null,
            values: { position: 1 },
          },
        ],
      };
    }
    if (path === "/api/drivers") {
      return {
        drivers: [
          { id: "d1", character: { name: "Piloto Externo" }, team: null, number: 1 },
          { id: "d2", character: { name: "Alicya Sintética" }, team: null, number: 7 },
        ],
      };
    }
    throw new ApiError("Não encontrado", 404);
  });
  apiMock.post.mockImplementation(async (path: string) => {
    if (path.endsWith("/preview")) return { preview: PREVIEW };
    if (path.endsWith("/apply")) {
      return { events: [{ id: "e2", sequence: 6, kind: "STANDING_CORRECTED" }] };
    }
    throw new ApiError("Não encontrado", 404);
  });
  apiMock.patch.mockImplementation(async () => undefined);
  apiMock.put.mockImplementation(async () => undefined);
  apiMock.remove.mockImplementation(async () => undefined);
});

describe("ChampionsPanel", () => {
  it("1) mostra loading", () => {
    apiMock.get.mockImplementation(() => new Promise(() => undefined));
    renderWithClient(<ChampionsPanel />);
    expect(screen.getByLabelText("Carregando campeões")).toBeDefined();
  });

  it("2) mostra empty state", async () => {
    apiMock.get.mockImplementation(async (path: string) => {
      if (path === "/api/timeline/champions") return { champions: [] };
      if (path === "/api/drivers") return { drivers: [] };
      throw new ApiError("Não encontrado", 404);
    });
    renderWithClient(<ChampionsPanel />);
    expect(await screen.findByText("Nenhum campeão encontrado")).toBeDefined();
  });

  it("3) lista anos com estados; derivado abre explicação e editável abre modal", async () => {
    const user = userEvent.setup();
    const onOpenTimeline = vi.fn();
    renderWithClient(<ChampionsPanel onOpenTimeline={onOpenTimeline} />);
    expect(await screen.findByText("2099")).toBeDefined();
    expect(screen.getByText("2098")).toBeDefined();
    expect(screen.getByText("2097")).toBeDefined();
    expect(screen.getAllByText("Original").length).toBeGreaterThan(0);
    expect(screen.getByText("Divergente")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Restaurar campeão de 2098 da fonte" }),
    ).toBeDefined();

    const derivedEdit = screen.getByRole("button", { name: "Editar campeão de 2097" });
    expect((derivedEdit as HTMLButtonElement).disabled).toBe(false);
    await user.click(derivedEdit);
    expect(await screen.findByText("Campeão não editável")).toBeDefined();
    expect(
      screen.getByText(/derivado dos resultados e da classificação/),
    ).toBeDefined();
    await user.click(
      screen.getByRole("button", { name: "Editar resultados na Linha do Tempo" }),
    );
    expect(onOpenTimeline).toHaveBeenCalledWith("s-2097");

    await user.click(screen.getByRole("button", { name: "Editar campeão de 2099" }));
    expect(await screen.findByText("Editar campeão mundial")).toBeDefined();
  });

  it("4) filtra por temporada e somente divergentes", async () => {
    const user = userEvent.setup();
    renderWithClient(<ChampionsPanel />);
    await screen.findByText("2099");

    await user.click(screen.getByRole("button", { name: "Temporada" }));
    await user.click(await screen.findByRole("option", { name: "2098" }));
    expect(screen.queryByText("2099")).toBeNull();
    expect(screen.getAllByText("2098").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Temporada" }));
    await user.click(await screen.findByRole("option", { name: "Todas" }));
    await user.click(screen.getByLabelText(/Somente divergentes/));
    expect(screen.queryByText("2099")).toBeNull();
    expect(screen.getAllByText("2098").length).toBeGreaterThan(0);
  });

  it("5) abre detalhe com histórico da temporada", async () => {
    const user = userEvent.setup();
    renderWithClient(<ChampionsPanel />);
    await user.click(await screen.findByText("2098"));
    const detail = await screen.findByRole("region", { name: "Detalhe do campeonato" });
    expect(within(detail).getByText(/Standing corrigido: Alicya Sintética/)).toBeDefined();
    expect(apiMock.get).toHaveBeenCalledWith("/api/timeline/champions/s2");
  });

  it("6) modal de edição pré-visualiza e aplica", async () => {
    const user = userEvent.setup();
    renderWithClient(<ChampionsPanel />);
    await user.click(
      await screen.findByRole("button", { name: "Editar campeão de 2099" }),
    );
    expect(screen.getByText("Editar campeão mundial")).toBeDefined();
    expect(screen.getByText(/afeta somente este Universe/)).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Novo campeão" }));
    await user.click(await screen.findByRole("option", { name: "Alicya Sintética" }));

    await user.click(screen.getByRole("button", { name: "Pré-visualizar" }));
    expect(await screen.findByText("Pré-visualização")).toBeDefined();
    expect(apiMock.post).toHaveBeenCalledWith(
      "/api/timeline/champions/s1/preview",
      { mode: "EDIT", driverProfileId: "d2" },
    );

    await user.click(screen.getByRole("button", { name: "Confirmar alteração" }));
    expect(apiMock.post).toHaveBeenCalledWith(
      "/api/timeline/champions/s1/apply",
      expect.objectContaining({ mode: "EDIT", driverProfileId: "d2" }),
    );
  });

  it("7) modal de restauração pré-visualiza e restaura da fonte", async () => {
    const user = userEvent.setup();
    renderWithClient(<ChampionsPanel />);
    await user.click(
      await screen.findByRole("button", { name: "Restaurar campeão de 2098 da fonte" }),
    );
    expect(screen.getByText("Restaurar campeão da fonte")).toBeDefined();
    expect(screen.getByText(/fonte externa não será modificada/)).toBeDefined();

    const previewButton = screen.getByRole("button", {
      name: "Pré-visualizar",
    }) as HTMLButtonElement;
    expect(previewButton.disabled).toBe(false);
    await user.click(previewButton);
    expect(apiMock.post).toHaveBeenCalledWith(
      "/api/timeline/champions/s2/preview",
      { mode: "RESTORE" },
    );
    expect(await screen.findByText("Pré-visualização")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Restaurar da fonte" }));
    expect(apiMock.post).toHaveBeenCalledWith(
      "/api/timeline/champions/s2/apply",
      expect.objectContaining({ mode: "RESTORE" }),
    );
  });

  it("8) erro de API mostra alerta com retry", async () => {
    apiMock.get
      .mockImplementationOnce(async () => {
        throw new ApiError("Serviço indisponível", 500);
      })
      .mockImplementation(async (path: string) => {
        if (path === "/api/timeline/champions") {
          return { champions: [MATCH, DIVERGENT, DERIVED] };
        }
        if (path === "/api/drivers") return { drivers: [] };
        throw new ApiError("Não encontrado", 404);
      });
    const user = userEvent.setup();
    renderWithClient(<ChampionsPanel />);
    expect(await screen.findByText("Serviço indisponível")).toBeDefined();
    const before = apiMock.get.mock.calls.length;
    await user.click(screen.getByRole("button", { name: /Tentar novamente/ }));
    expect(apiMock.get.mock.calls.length).toBeGreaterThan(before);
  });

  it("9) mostra baseline canônico do Universe e conflito de fonte", async () => {
    const baseline = makeEntry({
      seasonId: null,
      year: 2096,
      universeChampion: null,
      baseline: true,
      externalChampion: {
        externalDriverId: null,
        name: "Campeão Canônico",
        source: "FIA_CANONICAL_CHRONOLOGY",
        sourceType: "CANONICAL",
      },
      canEdit: false,
      blockedReason: "SEASON_NOT_IN_UNIVERSE",
    });
    const conflict = makeEntry({
      seasonId: "s3",
      year: 2095,
      externalChampion: {
        externalDriverId: "ext-9",
        name: "Piloto Diverge",
        source: "jolpica",
        sourceType: "STANDING",
      },
      canonicalChampion: { name: "Campeão Oficial", source: "FIA_CANONICAL_CHRONOLOGY" },
      sourceConflict: true,
    });
    apiMock.get.mockImplementation(async (path: string) => {
      if (path === "/api/timeline/champions") return { champions: [baseline, conflict] };
      if (path === "/api/drivers") return { drivers: [] };
      throw new ApiError("Não encontrado", 404);
    });
    renderWithClient(<ChampionsPanel />);
    expect((await screen.findAllByText("Campeão Canônico")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("baseline histórico")).toBeDefined();
    expect(screen.getByText("cronologia oficial")).toBeDefined();
    expect(screen.getByText("Fonte em conflito")).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Editar campeão de 2096" }),
    ).toBeDefined();
  });
});
