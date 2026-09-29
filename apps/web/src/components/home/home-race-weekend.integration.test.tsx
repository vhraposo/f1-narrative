import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type { NextRaceResult } from "@/lib/next-race";
import type { RaceWeekend } from "@/lib/weekend";
import type { WorldState } from "@/lib/world";
import { renderWithClient } from "@/test/render-with-client";
import { HomeRaceWeekend } from "@/components/home/home-race-weekend";

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

const WORLD: WorldState = {
  id: "w1",
  key: "default",
  currentDate: "2096-04-01T00:00:00.000Z",
  currentSeasonId: "s1",
  currentRaceId: null,
  currentSession: "QUALIFYING",
  createdAt: "2096-01-01T00:00:00.000Z",
  updatedAt: "2096-01-01T00:00:00.000Z",
};

const NEXT_RACE: NextRaceResult = {
  season: { id: "s1", year: 2096, name: null },
  totalRounds: 24,
  current: null,
  previous: null,
  next: {
    raceId: "r5",
    name: "São Paulo Grand Prix",
    round: 5,
    date: "2096-05-01T00:00:00.000Z",
    status: "UPCOMING",
    circuit: {
      id: "c1",
      name: "Autódromo José Carlos Pace",
      locality: "São Paulo",
      country: "Brazil",
      latitude: null,
      longitude: null,
      lengthMeters: null,
      turns: null,
      layoutKey: null,
      layoutUrl: null,
      photoUrl: null,
    },
  },
  reason: null,
};

const WEEKEND: RaceWeekend = {
  raceId: "r5",
  name: "São Paulo Grand Prix",
  round: 5,
  date: "2096-05-01T00:00:00.000Z",
  status: "UPCOMING",
  effectiveSprint: false,
  sprintOverride: null,
  sprintExternal: null,
  currentSession: null,
  nextSession: "PRACTICE",
  sessions: [
    { session: "PRACTICE", state: "AVAILABLE", results: [] },
    { session: "QUALIFYING", state: "LOCKED", results: [] },
    { session: "RACE", state: "LOCKED", results: [] },
  ],
};

const SPRINT_WEEKEND: RaceWeekend = {
  ...WEEKEND,
  status: "SPRINT",
  effectiveSprint: true,
  sprintOverride: true,
  currentSession: "SPRINT",
  nextSession: "QUALIFYING",
  sessions: [
    {
      session: "PRACTICE",
      state: "COMPLETED",
      results: [
        {
          driverProfileId: "d1",
          driverName: "Piloto Um",
          teamName: "Equipe A",
          position: 1,
          status: "Finished",
          points: 0,
        },
      ],
    },
    { session: "SPRINT_QUALIFYING", state: "COMPLETED", results: [] },
    {
      session: "SPRINT",
      state: "COMPLETED",
      results: [
        {
          driverProfileId: "d1",
          driverName: "Piloto Um",
          teamName: "Equipe A",
          position: 1,
          status: "Finished",
          points: 8,
        },
        {
          driverProfileId: "d2",
          driverName: "Piloto Dois",
          teamName: "Equipe B",
          position: 2,
          status: "Finished",
          points: 7,
        },
      ],
    },
    { session: "QUALIFYING", state: "AVAILABLE", results: [] },
    { session: "RACE", state: "LOCKED", results: [] },
  ],
};

beforeEach(() => {
  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/next-race") return { nextRace: NEXT_RACE };
    if (path === "/api/world") return { world: WORLD };
    if (path === "/api/races/r5/weekend") return { weekend: WEEKEND };
    throw new ApiError("Não encontrado", 404);
  });
  apiMock.post.mockImplementation(async () => ({ weekend: WEEKEND }));
  apiMock.patch.mockImplementation(async () => undefined);
  apiMock.put.mockImplementation(async () => undefined);
  apiMock.remove.mockImplementation(async () => undefined);
});

describe("HomeRaceWeekend — Next Race do Universe", () => {
  it("exibe a próxima corrida com round dinâmico, circuito e link interno", async () => {
    renderWithClient(<HomeRaceWeekend />);

    expect(await screen.findByText("São Paulo Grand Prix")).toBeDefined();
    expect(screen.getByText("R5/24")).toBeDefined();
    expect(screen.getByText(/Autódromo José Carlos Pace/)).toBeDefined();
    expect(screen.getByText(/São Paulo, Brazil/)).toBeDefined();
    expect(
      screen.getByRole("link", { name: /Ver evento/ }).getAttribute("href"),
    ).toBe("/app/championship");

    const calls = apiMock.get.mock.calls.map((call) => String(call[0]));
    expect(calls).toContain("/api/next-race");
    expect(calls.every((path) => path.startsWith("/api/"))).toBe(true);
  });

  it("sem próxima corrida: mostra estado vazio com CTA interno", async () => {
    apiMock.get.mockImplementation(async (path: string) => {
      if (path === "/api/next-race") {
        return { nextRace: { ...NEXT_RACE, next: null, current: null } };
      }
      if (path === "/api/world") return { world: WORLD };
      throw new ApiError("Não encontrado", 404);
    });
    renderWithClient(<HomeRaceWeekend />);

    expect(await screen.findByText("Sem corrida definida")).toBeDefined();
    expect(
      screen.getByRole("link", { name: /Definir corrida/ }).getAttribute("href"),
    ).toBe("/app/championship");
  });

  it("erro na API não quebra a seção", async () => {
    apiMock.get.mockImplementation(async (path: string) => {
      if (path === "/api/next-race") throw new ApiError("Falha", 500);
      if (path === "/api/world") return { world: WORLD };
      throw new ApiError("Não encontrado", 404);
    });
    renderWithClient(<HomeRaceWeekend />);

    expect(await screen.findByText("Sem corrida definida")).toBeDefined();
  });

  it("mostra as sessões do weekend e executa a sessão disponível", async () => {
    renderWithClient(<HomeRaceWeekend />);
    await screen.findByText("São Paulo Grand Prix");

    expect(await screen.findByText("Treino")).toBeDefined();
    expect(screen.getAllByText("Disponível").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bloqueada").length).toBeGreaterThan(0);

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /Executar Treino/ }),
    );

    await waitFor(() => {
      expect(apiMock.post).toHaveBeenCalledWith(
        "/api/races/r5/weekend/sessions/PRACTICE/run",
        {},
      );
    });
    const calls = apiMock.get.mock.calls.map((call) => String(call[0]));
    expect(calls).toContain("/api/races/r5/weekend");
  });

  it("mostra Sprint, estados concluídos e resumo com pontos", async () => {
    apiMock.get.mockImplementation(async (path: string) => {
      if (path === "/api/next-race") return { nextRace: NEXT_RACE };
      if (path === "/api/world") return { world: WORLD };
      if (path === "/api/races/r5/weekend") {
        return { weekend: SPRINT_WEEKEND };
      }
      throw new ApiError("Não encontrado", 404);
    });
    renderWithClient(<HomeRaceWeekend />);

    expect(await screen.findByText("São Paulo Grand Prix")).toBeDefined();
    expect((await screen.findAllByText("Sprint")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Classificação Sprint")).toBeDefined();
    expect(
      screen.getByText(/Sprint: P1 Piloto Um \(8 pts\) · P2 Piloto Dois \(7 pts\)/),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Executar Classificação/ }),
    ).toBeDefined();
  });

  it("mostra erro quando a execução da sessão falha", async () => {
    apiMock.post.mockRejectedValueOnce(
      new ApiError("Sessão fora da ordem do fim de semana", 409, "SESSION_NOT_AVAILABLE"),
    );
    renderWithClient(<HomeRaceWeekend />);
    await screen.findByText("São Paulo Grand Prix");

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /Executar Treino/ }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Sessão fora da ordem do fim de semana");
  });
});
