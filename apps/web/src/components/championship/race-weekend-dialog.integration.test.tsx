import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RaceWeekendDialog } from "@/components/championship/race-weekend-dialog";
import { ApiError } from "@/lib/api";
import type { RaceWeekend } from "@/lib/weekend";
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

const STANDARD_WEEKEND: RaceWeekend = {
  raceId: "r1",
  name: "GP Resultados",
  round: 1,
  date: "2088-03-01T00:00:00.000Z",
  status: "QUALIFYING",
  effectiveSprint: false,
  sprintOverride: null,
  sprintExternal: null,
  currentSession: "QUALIFYING",
  nextSession: "RACE",
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
    {
      session: "QUALIFYING",
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
        {
          driverProfileId: "d2",
          driverName: "Piloto Dois",
          teamName: "Equipe B",
          position: 2,
          status: "Finished",
          points: 0,
        },
      ],
    },
    { session: "RACE", state: "AVAILABLE", results: [] },
  ],
};

const SPRINT_WEEKEND: RaceWeekend = {
  ...STANDARD_WEEKEND,
  effectiveSprint: true,
  sprintOverride: true,
  currentSession: "SPRINT",
  nextSession: "QUALIFYING",
  sessions: [
    { session: "PRACTICE", state: "COMPLETED", results: [] },
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
  apiMock.get.mockReset();
  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/races/r1/weekend") {
      return { weekend: STANDARD_WEEKEND };
    }
    throw new ApiError("Não encontrado", 404);
  });
  apiMock.post.mockImplementation(async () => undefined);
  apiMock.patch.mockImplementation(async () => undefined);
  apiMock.put.mockImplementation(async () => undefined);
  apiMock.remove.mockImplementation(async () => undefined);
});

function renderDialog() {
  return renderWithClient(
    <RaceWeekendDialog
      race={{ id: "r1", name: "GP Resultados" }}
      onClose={() => undefined}
    />,
  );
}

describe("RaceWeekendDialog", () => {
  it("mostra as sessões, estados e classificação do weekend padrão", async () => {
    renderDialog();

    expect(await screen.findByText(/Fim de semana — GP Resultados/)).toBeDefined();
    expect(await screen.findByText("Treino")).toBeDefined();
    expect(screen.getByText("Classificação")).toBeDefined();
    expect(screen.getByText("Corrida")).toBeDefined();
    expect(screen.getAllByText("Concluída").length).toBe(2);
    expect(screen.getByText("Disponível")).toBeDefined();
    expect(screen.getAllByText("Piloto Um").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Equipe A").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Weekend padrão").length).toBeGreaterThan(0);
    expect(screen.queryByText("Sprint")).toBeNull();
  });

  it("mostra Sprint com pontuação quando o weekend tem Sprint", async () => {
    apiMock.get.mockImplementation(async (path: string) => {
      if (path === "/api/races/r1/weekend") {
        return { weekend: SPRINT_WEEKEND };
      }
      throw new ApiError("Não encontrado", 404);
    });
    renderDialog();

    expect(await screen.findByText("Classificação Sprint")).toBeDefined();
    expect(screen.getByText("Sprint")).toBeDefined();
    expect(screen.getByText("8")).toBeDefined();
    expect(screen.getByText("7")).toBeDefined();
    expect(screen.getAllByText("Weekend com Sprint").length).toBeGreaterThan(0);
  });

  it("mostra vazio de classificação em sessão concluída sem resultados", async () => {
    apiMock.get.mockImplementation(async (path: string) => {
      if (path === "/api/races/r1/weekend") {
        return {
          weekend: {
            ...STANDARD_WEEKEND,
            sessions: STANDARD_WEEKEND.sessions.map((session) =>
              session.session === "QUALIFYING"
                ? { ...session, results: [] }
                : session,
            ),
          },
        };
      }
      throw new ApiError("Não encontrado", 404);
    });
    renderDialog();
    await screen.findByText(/Fim de semana — GP Resultados/);
    expect(
      (await screen.findAllByText("Sem classificação registrada.")).length,
    ).toBeGreaterThan(0);
  });

  it("mostra loading enquanto carrega", async () => {
    let resolveWeekend: (value: unknown) => void = () => undefined;
    apiMock.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveWeekend = resolve;
        }),
    );
    renderDialog();

    expect(await screen.findByText("Carregando sessões…")).toBeDefined();
    resolveWeekend({ weekend: STANDARD_WEEKEND });
    expect(await screen.findByText("Treino")).toBeDefined();
  });

  it("mostra erro sem quebrar e busca apenas o weekend da corrida", async () => {
    apiMock.get.mockImplementation(async (path: string) => {
      if (path === "/api/races/r1/weekend") {
        throw new ApiError("Falha", 500);
      }
      throw new ApiError("Não encontrado", 404);
    });
    renderDialog();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Não foi possível carregar as sessões do fim de semana.",
    );
    const paths = apiMock.get.mock.calls.map((call) => String(call[0]));
    expect(paths).toEqual(["/api/races/r1/weekend"]);
  });
});
