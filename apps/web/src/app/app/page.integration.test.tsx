import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type { Driver } from "@/lib/driver-profiles";
import type { Team } from "@/lib/teams";
import type { WorldState } from "@/lib/world";
import { renderWithClient } from "@/test/render-with-client";
import AppPage from "@/app/app/page";

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
  useSession: () => ({
    data: { user: { id: "u1", name: "Validador" }, session: null },
  }),
}));

const WORLD: WorldState = {
  id: "w1",
  key: "default",
  currentDate: "2026-09-05T00:00:00.000Z",
  currentSeasonId: "s1",
  currentRaceId: null,
  currentSession: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const SEASONS = [
  {
    id: "s1",
    year: 2026,
    name: null,
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

function makeDriver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: "d1",
    characterId: "c1",
    number: 16,
    teamId: "t1",
    headshotUrl: null,
    team: { id: "t1", name: "Ferrari", shortName: "FER", color: "#e80020" },
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

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: "t1",
    name: "Ferrari",
    shortName: "FER",
    color: "#e80020",
    userId: "u9",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// Grid do universo do usuário: o Dashboard conta os pilotos da grade do
// universo, não os personagens controlados/relacionados ao Chat.
const GRID_DRIVERS: Driver[] = [
  makeDriver(),
  makeDriver({
    id: "d2",
    characterId: "c2",
    number: 44,
    teamId: "t2",
    team: { id: "t2", name: "Mercedes", shortName: "MER", color: "#00d2be" },
    character: {
      id: "c2",
      name: "Lewis Hamilton",
      nationality: "Britânico",
      imageUrl: null,
    },
  }),
];

const GRID_TEAMS: Team[] = [
  makeTeam(),
  makeTeam({
    id: "t2",
    name: "Mercedes",
    shortName: "MER",
    color: "#00d2be",
    userId: "u8",
  }),
];

beforeEach(() => {
  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/characters") return { characters: [{ id: "mine-1" }] };
    if (path === "/api/drivers") return { drivers: GRID_DRIVERS };
    if (path === "/api/teams") return { teams: GRID_TEAMS };
    if (path === "/api/world") return { world: WORLD };
    if (path === "/api/seasons") return { seasons: SEASONS };
    if (path.startsWith("/api/seasons/") && path.endsWith("/races")) {
      return { races: [] };
    }
    if (path.startsWith("/api/events")) return { events: [] };
    if (path.startsWith("/api/relationships")) return { relationships: [] };
    if (path.startsWith("/api/conversations")) return { conversations: [] };
    throw new ApiError("Não encontrado", 404);
  });

  apiMock.post.mockImplementation(async () => undefined);
  apiMock.patch.mockImplementation(async () => undefined);
  apiMock.put.mockImplementation(async () => undefined);
  apiMock.remove.mockImplementation(async () => undefined);
});

describe("Dashboard — panorama do universo", () => {
  it("conta grid completo de pilotos e equipes, e os personagens do usuário", async () => {
    renderWithClient(<AppPage />);

    expect(await screen.findByText("2 pilotos")).toBeDefined();
    expect(screen.getByText("2 equipes")).toBeDefined();
    expect(screen.getByText("1 personagem")).toBeDefined();

    expect(
      screen.getByText("na grade").previousElementSibling?.textContent,
    ).toBe("2");
    expect(screen.getByText("no paddock").previousElementSibling?.textContent).toBe(
      "2",
    );
    expect(screen.getByText("no seu universo").previousElementSibling?.textContent).toBe(
      "1",
    );
  });
});
