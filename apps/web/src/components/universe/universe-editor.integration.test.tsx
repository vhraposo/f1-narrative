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

const SEASONS: PlayerEntrySeason[] = [
  {
    id: "s1",
    year: 2026,
    status: "ACTIVE",
    externalSeasonId: "es1",
    externalSeasonYear: 2026,
    externalSeasonStatus: "ACTIVE",
  },
  {
    id: "s2",
    year: 2025,
    status: "ACTIVE",
    externalSeasonId: "es2",
    externalSeasonYear: 2025,
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

const matchedComparison = makeRosterComparison({
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

let seasonsFixture: PlayerEntrySeason[];
let comparisonFixture: RosterComparison | null;
let failSetup: boolean;
let failComparison: boolean;
const comparisonPaths: string[] = [];

beforeEach(() => {
  seasonsFixture = SEASONS;
  comparisonFixture = makeRosterComparison();
  failSetup = false;
  failComparison = false;
  comparisonPaths.length = 0;
  apiMock.get.mockClear();
  apiMock.post.mockClear();

  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/world") {
      return { world: worldFixture };
    }
    if (path.startsWith("/api/universe/player-entry/setup")) {
      if (failSetup) throw new ApiError("Falha", 500);
      const setup: PlayerEntrySetup = {
        seasons: seasonsFixture,
        selection: null,
      };
      return setup;
    }
    const match = path.match(/\/api\/universe\/roster-comparison\/([^/]+)/);
    if (match) {
      comparisonPaths.push(path);
      if (failComparison) throw new ApiError("Falha", 500);
      return comparisonFixture ?? { season: { id: match[1], year: 2025, name: null, status: "ACTIVE" }, comparable: false, teams: [] };
    }
    throw new ApiError("Não encontrado", 404);
  });

  apiMock.post.mockImplementation(async () => ({
    team: makeRosterComparison().teams[0],
  }));
});

async function renderPage() {
  renderWithClient(<UniverseEditorPage />);
  await screen.findByRole("heading", { level: 1, name: "Editor de Universo" });
}

describe("Universe Editor — Editor de Universo", () => {
  it("renderiza o cabeçalho e o seletor de temporada", async () => {
    await renderPage();

    expect(screen.getByText("UNIVERSO / UNIVERSE EDITOR")).toBeDefined();
    expect(
      await screen.findByText("Temporada do universo"),
    ).toBeDefined();
    expect(
      comparisonPaths.some((p) => p.endsWith("/s1")),
    ).toBe(true);
  });

  it("mostra configuração compatível quando universo reflete a fonte", async () => {
    comparisonFixture = matchedComparison;
    await renderPage();

    expect(
      await screen.findByText("Tudo alinhado com a fonte."),
    ).toBeDefined();
    expect(screen.getByText("McLaren")).toBeDefined();
    expect(screen.getByText("Alinhada")).toBeDefined();
    expect(screen.queryByText("Divergente")).toBeNull();
  });

  it("sem divergências ainda lista as equipes espelhadas", async () => {
    comparisonFixture = matchedComparison;
    await renderPage();

    const mclarenCard = await screen.findByText("McLaren");
    expect(mclarenCard).toBeDefined();
    expect(screen.getByText("1 de 1 assentos alinhados")).toBeDefined();
  });

  it("mostra estado de divergência com assento divergente", async () => {
    await renderPage();

    expect(
      (await screen.findAllByText("Lando Norris")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Meu Piloto")).toBeDefined();
    expect(screen.getByText("Oscar Piastri")).toBeDefined();
    expect(screen.getAllByText("Divergente").length).toBeGreaterThan(0);
  });

  it("mostra SÓ NA FONTE e SÓ NO UNIVERSO pelos assentos", async () => {
    comparisonFixture = makeRosterComparison({
      teams: [
        {
          id: "t1",
          name: "Ferrari",
          shortName: "FER",
          color: "#dc0000",
          externalTeamId: "ferrari",
          status: "DIVERGENT",
          seats: [
            {
              seat: 1,
              status: "SOURCE_ONLY",
              source: { externalDriverId: "e1", name: "Charles Leclerc", number: 16 },
              universe: null,
              canRestore: false,
            },
            {
              seat: 2,
              status: "UNIVERSE_ONLY",
              source: null,
              universe: {
                entryId: "en2",
                driverProfileId: "d2",
                characterId: "c2",
                characterName: "Meu Piloto",
                provenance: "CANONICAL",
              },
              canRestore: false,
            },
          ],
        },
      ],
    });
    await renderPage();

    expect(await screen.findByText("Charles Leclerc")).toBeDefined();
    expect(screen.getByText("Só na fonte")).toBeDefined();
    expect(screen.getByText("Só no universo")).toBeDefined();
    expect(screen.getByText("Meu Piloto")).toBeDefined();
  });

  it("troca de temporada dispara nova comparação", async () => {
    await renderPage();
    const user = userEvent.setup();

    const trigger = await screen.findByLabelText("Temporada do universo");
    await user.click(trigger);
    await user.click(
      await screen.findByRole("option", { name: /Temporada 2025/ }),
    );

    expect(
      comparisonPaths.some((p) => p.endsWith("/s2")),
    ).toBe(true);
  });

  it("sem temporadas espelhadas: mostra estado vazio", async () => {
    seasonsFixture = [];
    await renderPage();

    expect(
      await screen.findByText("Nenhuma temporada espelhada."),
    ).toBeDefined();
    expect(
      screen.queryByText("Fonte externa: mclaren"),
    ).toBeNull();
  });

  it("temporada sem fonte vinculada: mostra estado vazio do editor", async () => {
    comparisonFixture = null;
    await renderPage();

    expect(
      await screen.findByText("Temporada sem fonte externa vinculada."),
    ).toBeDefined();
    expect(screen.queryByText("McLaren")).toBeNull();
  });

  it("erro ao carregar a comparação: estado de erro e retry recupera", async () => {
    failComparison = true;
    await renderPage();

    expect(
      await screen.findByText(
        "Não foi possível comparar o universo com a fonte.",
      ),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Tentar novamente" }),
    ).toBeDefined();

    failComparison = false;
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));

    expect(await screen.findByText("McLaren")).toBeDefined();
  });

  it("ação Restaurar da fonte confirma e chama a rota correta", async () => {
    await renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /Restaurar da fonte/ }));

    expect(
      await screen.findByRole("heading", {
        name: "Restaurar configuração da fonte?",
      }),
    ).toBeDefined();

    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: /Restaurar da fonte/,
      }),
    );

    expect(apiMock.post).toHaveBeenCalledWith(
      "/api/universe/roster-comparison/s1/restore-source",
      { teamId: "t1" },
    );
  });

  it("via confirmação: mostra estado de conflito quando restore falha", async () => {
    await renderPage();
    const user = userEvent.setup();

    apiMock.post.mockImplementation(async () => {
      throw new ApiError("SEASON_NOT_BOUND", 409, "SEASON_NOT_BOUND");
    });

    await user.click(
      await screen.findByRole("button", { name: /Restaurar da fonte/ }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: /Restaurar da fonte/,
      }),
    );

    expect(await screen.findByText("SEASON_NOT_BOUND")).toBeDefined();
  });
});