import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StandingsPanel } from "@/components/championship/standings-panel";
import { ApiError } from "@/lib/api";
import type { ChampionshipStanding, Season } from "@/lib/championship";
import type { Driver } from "@/lib/driver-profiles";
import { renderWithClient } from "@/test/render-with-client";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    get: apiMock.get,
  };
});

const SEASON: Season = {
  id: "s1",
  year: 2026,
  name: null,
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const DRIVERS: Driver[] = [
  {
    id: "d1",
    characterId: "c1",
    number: 81,
    teamId: "t1",
    team: { id: "t1", name: "McLaren", shortName: "MCL", color: "#ff8000" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    character: {
      id: "c1",
      name: "Alicya Kucharski",
      nationality: "Brasileira",
      imageUrl: null,
    },
  },
  {
    id: "d2",
    characterId: "c2",
    number: 44,
    teamId: "t2",
    team: {
      id: "t2",
      name: "Mercedes",
      shortName: "MER",
      color: "#00d2be",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    character: {
      id: "c2",
      name: "Lewis Hamilton",
      nationality: "Britânico",
      imageUrl: null,
    },
  },
  {
    id: "d3",
    characterId: "c3",
    number: 33,
    teamId: null,
    team: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    character: {
      id: "c3",
      name: "Max Verstappen",
      nationality: "Holandês",
      imageUrl: null,
    },
  },
];

function makeStanding(
  overrides: Partial<ChampionshipStanding>,
  driver: Driver,
): ChampionshipStanding {
  return {
    id: overrides.id ?? "st1",
    seasonId: "s1",
    driverProfileId: driver.id,
    points: overrides.points ?? 0,
    position: overrides.position ?? null,
    wins: overrides.wins ?? 0,
    podiums: overrides.podiums ?? 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    driverProfile: {
      id: driver.id,
      characterId: driver.characterId,
      number: driver.number,
      teamId: driver.teamId,
      character: driver.character,
    },
    ...overrides,
  };
}

let standingsFixture: ChampionshipStanding[];
let failStandings = false;

beforeEach(() => {
  standingsFixture = [
    makeStanding(
      { id: "st1", position: 3, points: 148, wins: 1, podiums: 2 },
      DRIVERS[0],
    ),
    makeStanding(
      { id: "st2", position: 1, points: 200, wins: 3, podiums: 5 },
      DRIVERS[1],
    ),
    makeStanding(
      { id: "st3", position: 2, points: 180, wins: 2, podiums: 4 },
      DRIVERS[2],
    ),
  ];
  failStandings = false;

  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/seasons/s1/standings") {
      if (failStandings) throw new ApiError("Falha", 500);
      return { standings: standingsFixture };
    }
    throw new ApiError("Não encontrado", 404);
  });
});

describe("StandingsPanel", () => {
  it("ordena a classificação por posição e padroniza os números", async () => {
    renderWithClient(<StandingsPanel season={SEASON} drivers={DRIVERS} />);

    const list = await screen.findByRole("list");
    const rows = within(list).getAllByRole("listitem");

    expect(within(rows[0]).getByText("01")).toBeDefined();
    expect(within(rows[0]).getByText("Lewis Hamilton")).toBeDefined();
    expect(within(rows[1]).getByText("02")).toBeDefined();
    expect(within(rows[1]).getByText("Max Verstappen")).toBeDefined();
    expect(within(rows[2]).getByText("03")).toBeDefined();
    expect(within(rows[2]).getByText("Alicya Kucharski")).toBeDefined();
  });

  it("mostra pontos em PTS e as estatísticas reais de vitórias/pódios", async () => {
    renderWithClient(<StandingsPanel season={SEASON} drivers={DRIVERS} />);

    const list = await screen.findByRole("list");
    const rows = within(list).getAllByRole("listitem");

    expect(within(rows[0]).getByText(/200/)).toBeDefined();
    expect(within(rows[0]).getByText(/PTS/)).toBeDefined();
    expect(within(rows[0]).getByText("3V · 5P")).toBeDefined();
    expect(within(rows[2]).getByText(/148/)).toBeDefined();
    expect(within(rows[2]).getByText("1V · 2P")).toBeDefined();
  });

  it("exibe a cor real da equipe e o número do piloto", async () => {
    const { container } = renderWithClient(
      <StandingsPanel season={SEASON} drivers={DRIVERS} />,
    );

    const list = await screen.findByRole("list");
    const rows = within(list).getAllByRole("listitem");

    expect(rows[0].querySelector('[style*="background-color"]')).not.toBeNull();
    expect(within(rows[0]).getByText("#44 · Mercedes")).toBeDefined();
    expect(container.querySelector('[style*="background-color"]')).not.toBeNull();
  });

  it("piloto sem equipe: sem cor e sem identidade de equipe inventada", async () => {
    const { container } = renderWithClient(
      <StandingsPanel season={SEASON} drivers={DRIVERS} />,
    );

    const list = await screen.findByRole("list");
    const rows = within(list).getAllByRole("listitem");

    expect(within(rows[1]).getByText("Max Verstappen")).toBeDefined();
    expect(within(rows[1]).getByText("#33")).toBeDefined();
    expect(within(rows[1]).queryByText(/McLaren|Mercedes/)).toBeNull();
    expect(rows[1].querySelector("[style]")).toBeNull();
    expect(container.querySelector("[style]")).not.toBeNull();
  });

  it("sem classificações: mostra o estado vazio", async () => {
    standingsFixture = [];
    renderWithClient(<StandingsPanel season={SEASON} drivers={DRIVERS} />);

    expect(
      await screen.findByText("Nenhuma classificação registrada ainda."),
    ).toBeDefined();
  });

  it("estado de erro: falha ao carregar a classificação", async () => {
    failStandings = true;
    renderWithClient(<StandingsPanel season={SEASON} drivers={DRIVERS} />);

    expect(
      await screen.findByText("Não foi possível carregar a classificação."),
    ).toBeDefined();
  });
});
