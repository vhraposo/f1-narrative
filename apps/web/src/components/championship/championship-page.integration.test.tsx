import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChampionshipPage from "@/app/app/championship/page";
import { ApiError } from "@/lib/api";
import type {
  ChampionshipStanding,
  Race,
  Season,
} from "@/lib/championship";
import type { Driver } from "@/lib/driver-profiles";
import type { WorldState } from "@/lib/world";
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

const SEASONS: Season[] = [
  {
    id: "s1",
    year: 2026,
    name: null,
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "s2",
    year: 2025,
    name: null,
    status: "COMPLETED",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  },
];

const RACES: Race[] = [
  {
    id: "r1",
    seasonId: "s1",
    name: "GP de Interlagos",
    circuit: "Autódromo de Interlagos",
    country: "Brasil",
    date: "2026-09-05T12:00:00.000Z",
    round: 14,
    status: "FINISHED",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "r2",
    seasonId: "s1",
    name: "GP de Abu Dhabi",
    circuit: "Yas Marina",
    country: "Emirados Árabes Unidos",
    date: null,
    round: 15,
    status: "PLANNED",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

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
];

const STANDINGS: ChampionshipStanding[] = [
  {
    id: "st1",
    seasonId: "s1",
    driverProfileId: "d1",
    points: 148,
    position: 1,
    wins: 2,
    podiums: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    driverProfile: {
      id: "d1",
      characterId: "c1",
      number: 81,
      teamId: "t1",
      character: DRIVERS[0].character,
    },
  },
];

function makeWorld(currentSeasonId: string | null): WorldState {
  return {
    id: "w1",
    key: "default",
    currentDate: "2026-09-05T12:00:00.000Z",
    currentSeasonId,
    currentRaceId: "r1",
    currentSession: "RACE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

let seasonsFixture: Season[];
let racesFixture: Race[];
let standingsFixture: ChampionshipStanding[];
let worldFixture: WorldState | null;
let failSeasons = false;

beforeEach(() => {
  seasonsFixture = SEASONS;
  racesFixture = RACES;
  standingsFixture = STANDINGS;
  worldFixture = makeWorld("s1");
  failSeasons = false;

  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/world") {
      return { world: worldFixture };
    }
    if (path === "/api/seasons") {
      if (failSeasons) throw new ApiError("Falha", 500);
      return { seasons: seasonsFixture };
    }
    if (path === "/api/drivers") return { drivers: DRIVERS };
    if (path === "/api/seasons/s1/races") {
      return { races: racesFixture };
    }
    if (path === "/api/seasons/s1/standings") {
      return { standings: standingsFixture };
    }
    if (path === "/api/seasons/s2/races") {
      return { races: [] };
    }
    if (path === "/api/seasons/s2/standings") {
      return { standings: [] };
    }
    throw new ApiError("Não encontrado", 404);
  });

  apiMock.post.mockImplementation(async () => undefined);
  apiMock.patch.mockImplementation(async () => undefined);
  apiMock.put.mockImplementation(async () => undefined);
  apiMock.remove.mockImplementation(async () => undefined);
});

describe("Championship Page - World Championship", () => {
  it("renderiza o cabeçalho do campeonato", async () => {
    renderWithClient(<ChampionshipPage />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "World Championship" }),
    ).toBeDefined();
    expect(screen.getByText("CAMPEONATO MUNDIAL")).toBeDefined();
    expect(await screen.findByText("2 temporadas")).toBeDefined();
  });

  it("mostra o contexto atual do campeonato no hero", async () => {
    renderWithClient(<ChampionshipPage />);

    const hero = await screen.findByRole("region", {
      name: "Contexto do campeonato",
    });
    expect(await within(hero).findByText("R14")).toBeDefined();
    expect(within(hero).getByText("Rodada atual")).toBeDefined();
    expect(
      within(hero).getByRole("heading", { name: "GP de Interlagos" }),
    ).toBeDefined();
    expect(within(hero).getByText("Autódromo de Interlagos — Brasil")).toBeDefined();
    expect(within(hero).getByText("Sessão atual")).toBeDefined();
    expect(within(hero).getByText("Corrida")).toBeDefined();
  });

  it("monta as seções: temporadas, classificação e calendário", async () => {
    renderWithClient(<ChampionshipPage />);

    const seasonsSection = await screen.findByRole("region", {
      name: "Temporadas",
    });
    expect(
      within(seasonsSection).getByRole("heading", { name: "Temporadas" }),
    ).toBeDefined();

    expect(
      await screen.findByRole("heading", { name: "Classificação" }),
    ).toBeDefined();
    expect(await screen.findByText("Alicya Kucharski")).toBeDefined();

    const calendar = screen.getByRole("region", {
      name: "Calendário de corridas",
    });
    expect(
      within(calendar).getByRole("heading", {
        name: "Calendário de corridas",
      }),
    ).toBeDefined();
    expect(within(calendar).getByRole("heading", { name: "GP de Abu Dhabi" }))
      .toBeDefined();
  });

  it("marca a temporada e a corrida atuais do mundo", async () => {
    renderWithClient(<ChampionshipPage />);

    const seasonsSection = await screen.findByRole("region", {
      name: "Temporadas",
    });
    const s1Card = within(seasonsSection).getByRole("button", { name: /2026/ });
    expect(
      within(s1Card as HTMLElement).getByText("Atual"),
    ).toBeDefined();

    const calendar = screen.getByRole("region", {
      name: "Calendário de corridas",
    });
    await within(calendar).findByText("GP de Interlagos");
    expect(
      within(calendar).getAllByText("Atual").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("trocar de temporada recarrega calendário e classificação", async () => {
    const user = userEvent.setup();
    renderWithClient(<ChampionshipPage />);

    await screen.findByRole("heading", { name: "Classificação" });

    await user.click(screen.getByRole("button", { name: /2025/ }));

    expect(
      await screen.findByText("Nenhuma corrida nesta temporada ainda."),
    ).toBeDefined();
    expect(
      await screen.findByText("Nenhuma classificação registrada ainda."),
    ).toBeDefined();
  });

  it("sem estado do mundo: não inventa rodada ou sessão", async () => {
    worldFixture = null;
    renderWithClient(<ChampionshipPage />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "World Championship" }),
    ).toBeDefined();
    expect(screen.queryByText("Rodada atual")).toBeNull();
    expect(screen.queryByText("Sessão atual")).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Contexto do campeonato" }),
    ).toBeNull();
  });

  it("sem temporadas: mostra o estado vazio", async () => {
    seasonsFixture = [];
    renderWithClient(<ChampionshipPage />);

    expect(
      await screen.findByText("Você ainda não tem temporadas."),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: /Criar temporada/ })).toBeDefined();
  });

  it("estado de erro: falha ao carregar as temporadas", async () => {
    failSeasons = true;
    renderWithClient(<ChampionshipPage />);

    expect(await screen.findByText("Dados indisponíveis")).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Tentar novamente/ }),
    ).toBeDefined();
  });
});
