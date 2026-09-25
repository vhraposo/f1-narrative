import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type { Driver } from "@/lib/driver-profiles";
import type { Team } from "@/lib/teams";
import { renderWithClient } from "@/test/render-with-client";
import TeamsPage from "@/app/app/teams/page";

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

vi.mock("@/providers/session-provider", () => ({
  useSession: () => ({ data: { user: { id: "u1" }, session: null } }),
}));

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: "t1",
    name: "Ferrari",
    shortName: "FER",
    color: "#e80020",
    userId: "u1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDriver(
  overrides: Partial<Driver> = {},
): Driver {
  return {
    id: "d1",
    characterId: "c1",
    number: 16,
    teamId: "t1",
    headshotUrl: null,
    team: {
      id: "t1",
      name: "Ferrari",
      shortName: "FER",
      color: "#e80020",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    character: {
      id: "c1",
      name: "Charles Leclerc",
      nationality: "Monegasco",
      imageUrl: null,
    },
    ...overrides,
  };
}

const TEAMS: Team[] = [
  makeTeam(),
  makeTeam({
    id: "t2",
    name: "Mercedes",
    shortName: "MER",
    color: "#00d2be",
  }),
];

const DRIVERS: Driver[] = [
  makeDriver(),
  makeDriver({
    id: "d2",
    characterId: "c2",
    number: 63,
    teamId: "t2",
    team: {
      id: "t2",
      name: "Mercedes",
      shortName: "MER",
      color: "#00d2be",
    },
    character: {
      id: "c2",
      name: "George Russell",
      nationality: "Britânico",
      imageUrl: "/george.jpg",
    },
  }),
];

let teamsFixture: Team[];
let driversFixture: Driver[];
let failTeams = false;

beforeEach(() => {
  teamsFixture = TEAMS;
  driversFixture = DRIVERS;
  failTeams = false;

  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/teams") {
      if (failTeams) throw new ApiError("Falha", 500);
      return { teams: teamsFixture };
    }
    if (path === "/api/drivers") return { drivers: driversFixture };
    throw new ApiError("Não encontrado", 404);
  });

  apiMock.post.mockImplementation(async () => undefined);
  apiMock.patch.mockImplementation(async () => undefined);
  apiMock.put.mockImplementation(async () => undefined);
  apiMock.remove.mockImplementation(async () => undefined);
});

describe("Teams Page - constructors", () => {
  it("renderiza o cabeçalho com kicker e título", async () => {
    renderWithClient(<TeamsPage />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Equipes" }),
    ).toBeDefined();
    expect(screen.getByText("UNIVERSO / EQUIPES")).toBeDefined();
  });

  it("renderiza as equipes com suas composições", async () => {
    renderWithClient(<TeamsPage />);

    expect(await screen.findByText("Ferrari")).toBeDefined();
    expect(screen.getByText("Mercedes")).toBeDefined();
    expect(screen.getByText("Charles Leclerc")).toBeDefined();
    expect(screen.getByText("George Russell")).toBeDefined();
  });

  it("mostra o piloto vinculado dentro da equipe correta", async () => {
    renderWithClient(<TeamsPage />);

    await screen.findByText("Ferrari");
    expect(screen.getByText("Charles Leclerc")).toBeDefined();
    expect(screen.getByText("#16")).toBeDefined();
  });

  it("agrupa cada piloto apenas na sua própria equipe", async () => {
    renderWithClient(<TeamsPage />);

    await screen.findByText("Ferrari");
    const mercedesCard = screen.getByText("Mercedes").closest("article");
    expect(mercedesCard).not.toBeNull();
    expect(
      (mercedesCard as HTMLElement).textContent,
    ).toContain("George Russell");
    expect(
      (mercedesCard as HTMLElement).textContent,
    ).not.toContain("Charles Leclerc");
  });

  it("o piloto da equipe navega para a rota de Driver (não Character)", async () => {
    const { container } = renderWithClient(<TeamsPage />);

    await screen.findByText("Ferrari");
    const link = screen.getByText("Charles Leclerc").closest("a")!;
    expect(link.getAttribute("href")).toBe("/app/drivers/d1");
    expect(container.querySelector('a[href^="/app/characters"]')).toBeNull();
  });

  it("equipe sem pilotos: mostra a vaga vazia na composição", async () => {
    driversFixture = DRIVERS.filter((d) => d.teamId !== "t1");
    renderWithClient(<TeamsPage />);

    await screen.findByText("Ferrari");
    const ferrariCard = screen.getByText("Ferrari").closest("article");
    expect((ferrariCard as HTMLElement).textContent).toContain(
      "Nenhum piloto vinculado",
    );
  });

  it("mostra o contador de pilotos por equipe", async () => {
    renderWithClient(<TeamsPage />);

    await screen.findByText("Ferrari");
    const ferrariCard = screen.getByText("Ferrari").closest("article");
    expect((ferrariCard as HTMLElement).textContent).toContain("1 PILOTO");
  });

  it("estado vazio: nenhuma equipe", async () => {
    teamsFixture = [];
    renderWithClient(<TeamsPage />);

    expect(
      await screen.findByText("Nenhuma equipe no universo."),
    ).toBeDefined();
  });

  it("equipe de outro usuário aparece, mas sem ações de edição/remoção", async () => {
    teamsFixture = [
      makeTeam(),
      makeTeam({ id: "t9", name: "Equipe Alheia", shortName: null, userId: "u9" }),
    ];
    renderWithClient(<TeamsPage />);

    await screen.findByText("Equipe Alheia");
    const own = screen.getByText("Ferrari").closest("article") as HTMLElement;
    const other = screen
      .getByText("Equipe Alheia")
      .closest("article") as HTMLElement;
    expect(
      within(own).getByRole("button", { name: /Editar Ferrari/ }),
    ).toBeDefined();
    expect(
      within(other).queryByRole("button", { name: /Editar Equipe Alheia/ }),
    ).toBeNull();
    expect(
      within(other).queryByRole("button", { name: /Remover Equipe Alheia/ }),
    ).toBeNull();
  });

  it("estado de erro: falha ao carregar as equipes", async () => {
    failTeams = true;
    renderWithClient(<TeamsPage />);

    expect(await screen.findByText("Dados indisponíveis")).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Tentar novamente/ }),
    ).toBeDefined();
  });

  it("após a materialização automática, exibe as equipes e pilotos materializados do universo (sem fonte externa)", async () => {
    teamsFixture = [
      makeTeam({
        id: "t-auto",
        name: "Atlas Racing",
        shortName: "ATL",
        color: "#1e3a8a",
      }),
    ];
    driversFixture = [
      makeDriver({
        id: "d-auto",
        characterId: "c-auto",
        number: 1,
        teamId: "t-auto",
        team: {
          id: "t-auto",
          name: "Atlas Racing",
          shortName: "ATL",
          color: "#1e3a8a",
        },
        character: {
          id: "c-auto",
          name: "Ada Lovelace",
          nationality: "Britânica",
          imageUrl: null,
        },
      }),
    ];
    renderWithClient(<TeamsPage />);

    expect(await screen.findByText("Atlas Racing")).toBeDefined();
    expect(screen.getByText("Ada Lovelace")).toBeDefined();
    expect(screen.getByText("#1")).toBeDefined();
    expect(screen.queryByText(/Fonte externa/i)).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });
});

describe("Teams Page — composição via SeasonDriverEntry (STEP 107.14)", () => {
  it("piloto sem equipe na temporada não é exibido em nenhuma equipe", async () => {
    driversFixture = [
      DRIVERS[0],
      makeDriver({
        id: "d-free",
        characterId: "c-free",
        number: null,
        teamId: null,
        team: null,
        character: {
          id: "c-free",
          name: "Piloto Livre",
          nationality: "Brasileira",
          imageUrl: null,
        },
      }),
    ];
    renderWithClient(<TeamsPage />);
    await screen.findByText("Ferrari");
    expect(screen.queryByText("Piloto Livre")).toBeNull();
  });

  it("equipe com dois pilotos na composição da temporada mostra a contagem correta", async () => {
    driversFixture = [
      makeDriver(),
      makeDriver({
        id: "d2b",
        characterId: "c2b",
        number: 44,
        teamId: "t1",
        team: {
          id: "t1",
          name: "Ferrari",
          shortName: "FER",
          color: "#e80020",
        },
        character: {
          id: "c2b",
          name: "Lewis Hamilton",
          nationality: "Britânico",
          imageUrl: null,
        },
      }),
    ];
    renderWithClient(<TeamsPage />);
    await screen.findByText("Ferrari");
    const ferrariCard = screen
      .getByText("Ferrari")
      .closest("article") as HTMLElement;
    expect(ferrariCard.textContent).toContain("2 PILOTOS");
    expect(ferrariCard.textContent).toContain("Charles Leclerc");
    expect(ferrariCard.textContent).toContain("Lewis Hamilton");
  });
});
