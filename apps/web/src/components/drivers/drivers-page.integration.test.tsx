import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type {
  ChampionshipStanding,
  Season,
} from "@/lib/championship";
import type { Driver } from "@/lib/driver-profiles";
import type { WorldState } from "@/lib/world";
import { renderWithClient } from "@/test/render-with-client";
import DriversPage from "@/app/app/drivers/page";

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
      imageUrl: "/lewis.jpg",
    },
  },
];

const STANDINGS: ChampionshipStanding[] = [
  {
    id: "st1",
    seasonId: "s1",
    driverProfileId: "d1",
    points: 148,
    position: 3,
    wins: 1,
    podiums: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    driverProfile: DRIVERS[0],
  },
];

function makeWorld(currentSeasonId: string | null): WorldState {
  return {
    id: "w1",
    key: "default",
    currentDate: "2026-09-05T00:00:00.000Z",
    currentSeasonId,
    currentRaceId: null,
    currentSession: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

let driversFixture: Driver[];
let worldFixture: WorldState;
let standingsFixture: ChampionshipStanding[];
let failDrivers = false;

beforeEach(() => {
  driversFixture = DRIVERS;
  worldFixture = makeWorld("s1");
  standingsFixture = STANDINGS;
  failDrivers = false;

  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/drivers") {
      if (failDrivers) throw new ApiError("Falha", 500);
      return { drivers: driversFixture };
    }
    if (path === "/api/world") return { world: worldFixture };
    if (path === "/api/seasons") return { seasons: SEASONS };
    if (path === "/api/seasons/s1/standings") {
      return { standings: standingsFixture };
    }
    throw new ApiError("Não encontrado", 404);
  });

  apiMock.post.mockImplementation(async () => undefined);
  apiMock.patch.mockImplementation(async () => undefined);
  apiMock.put.mockImplementation(async () => undefined);
  apiMock.remove.mockImplementation(async () => undefined);
});

describe("Drivers Page - grid", () => {
  it("renderiza a grid com número, piloto e equipe", async () => {
    renderWithClient(<DriversPage />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Drivers" }),
    ).toBeDefined();
    expect(await screen.findByText("Alicya Kucharski")).toBeDefined();
    expect(screen.getByText("#81")).toBeDefined();
    expect(screen.getByText("Alicya Kucharski")).toBeDefined();
    expect(screen.getByText("McLaren")).toBeDefined();
    expect(screen.getByText("#44")).toBeDefined();
    expect(screen.getByText("Lewis Hamilton")).toBeDefined();
    expect(screen.getByText("Mercedes")).toBeDefined();
  });

  it("mostra o contexto da temporada atual no cabeçalho", async () => {
    renderWithClient(<DriversPage />);

    expect(await screen.findByText("UNIVERSO / GRID 2026")).toBeDefined();
    expect(screen.getByText("2 pilotos na grid")).toBeDefined();
  });

  it("mostra performance apenas para quem tem classificação real", async () => {
    renderWithClient(<DriversPage />);

    expect(await screen.findByText(/P3 · 148 PTS · 1V · 2P/)).toBeDefined();

    const lewis = screen.getByText("Lewis Hamilton").closest("article");
    expect(lewis).not.toBeNull();
    expect(within(lewis as HTMLElement).queryByText(/PTS/)).toBeNull();
  });

  it("sem temporada atual: sem ano e sem classificação inventada", async () => {
    worldFixture = makeWorld(null);

    renderWithClient(<DriversPage />);

    expect(await screen.findByRole("heading", { level: 1, name: "Drivers" }))
      .toBeDefined();
    expect(screen.getByText("UNIVERSO / GRID")).toBeDefined();
    expect(screen.queryByText("UNIVERSO / GRID 2026")).toBeNull();
    expect(screen.queryByText(/PTS/)).toBeNull();
  });

  it("estado vazio: nenhum piloto na grid", async () => {
    driversFixture = [];
    renderWithClient(<DriversPage />);

    expect(
      await screen.findByText("Você ainda não tem pilotos."),
    ).toBeDefined();
  });

it("estado de erro: falha ao carregar os pilotos", async () => {
    failDrivers = true;
    renderWithClient(<DriversPage />);

    expect(await screen.findByText("Dados indisponíveis")).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Tentar novamente/ }),
    ).toBeDefined();
  });

  it("após a materialização automática, exibe apenas o grid do universo (sem aba de fonte externa)", async () => {
    renderWithClient(<DriversPage />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Drivers" }),
    ).toBeDefined();
    expect(screen.queryByText(/Fonte externa/i)).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(await screen.findByText("Alicya Kucharski")).toBeDefined();
    expect(screen.getByText("Lewis Hamilton")).toBeDefined();
  });
});
