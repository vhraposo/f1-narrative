import { screen } from "@testing-library/react";
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
      await screen.findByText("Você ainda não tem equipes."),
    ).toBeDefined();
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
