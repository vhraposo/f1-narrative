import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import F1WorldDataPage from "@/app/app/external/page";
import { ApiError } from "@/lib/api";
import type {
  ExternalDriver,
  ExternalDriverSeason,
  ExternalRace,
  ExternalResult,
  ExternalSeason,
  ExternalStanding,
  ExternalTeam,
} from "@/lib/external-world";
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

const SEASONS: ExternalSeason[] = [
  { id: "s1", year: 2026, name: null, status: "ACTIVE" },
  { id: "s2", year: 2025, name: null, status: "COMPLETED" },
];

const TEAMS: ExternalTeam[] = [
  {
    id: "t1",
    externalId: "mclaren",
    name: "McLaren",
    shortName: "MCL",
    color: "#ff8000",
    lastSyncedAt: "2026-09-01T12:00:00.000Z",
  },
  {
    id: "t2",
    externalId: "ferrari",
    name: "Ferrari",
    shortName: "FER",
    color: "#dc0000",
    lastSyncedAt: "2026-09-01T12:00:00.000Z",
  },
];

const DRIVERS: ExternalDriver[] = [
  {
    id: "d1",
    externalId: "lando-norris",
    name: "Lando Norris",
    fullName: "Lando Norris",
    nationality: "British",
    number: 2,
    lastSyncedAt: "2026-09-01T12:00:00.000Z",
  },
  {
    id: "d2",
    externalId: "oscar-piastri",
    name: "Oscar Piastri",
    fullName: "Oscar Piastri",
    nationality: "Australian",
    number: 4,
    lastSyncedAt: "2026-09-01T12:00:00.000Z",
  },
  {
    id: "d3",
    externalId: "fernando-alonso",
    name: "Fernando Alonso",
    fullName: "Fernando Alonso",
    nationality: "Spanish",
    number: 14,
    lastSyncedAt: "2025-09-01T12:00:00.000Z",
  },
];

const DRIVER_SEASONS_2026: ExternalDriverSeason[] = [
  {
    id: "ds1",
    seasonYear: 2026,
    externalDriver: { externalId: "lando-norris", name: "Lando Norris" },
    teamExternalId: "mclaren",
    teamNameSnapshot: "McLaren",
    number: 2,
    role: null,
  },
  {
    id: "ds2",
    seasonYear: 2026,
    externalDriver: { externalId: "oscar-piastri", name: "Oscar Piastri" },
    teamExternalId: "mclaren",
    teamNameSnapshot: "McLaren",
    number: 4,
    role: null,
  },
  {
    id: "ds3",
    seasonYear: 2026,
    externalDriver: { externalId: "reserve-x", name: "Reserve X" },
    teamExternalId: "mclaren",
    teamNameSnapshot: "McLaren",
    number: 88,
    role: "RESERVE",
  },
];

const DRIVER_SEASONS_2025: ExternalDriverSeason[] = [
  {
    id: "ds4",
    seasonYear: 2025,
    externalDriver: { externalId: "fernando-alonso", name: "Fernando Alonso" },
    teamExternalId: "ferrari",
    teamNameSnapshot: "Ferrari",
    number: 14,
    role: null,
  },
  {
    id: "ds5",
    seasonYear: 2025,
    externalDriver: { externalId: "mystery-driver", name: "Mystery Driver" },
    teamExternalId: null,
    teamNameSnapshot: null,
    number: null,
    role: "REPLACEMENT",
  },
];

const RACES_2026: ExternalRace[] = [
  {
    id: "r1",
    seasonYear: 2026,
    round: 1,
    grandPrix: "Australian Grand Prix",
    name: "Australian Grand Prix",
    circuitName: "Albert Park",
    date: "2026-03-08T00:00:00.000Z",
    status: null,
  },
  {
    id: "r2",
    seasonYear: 2026,
    round: 2,
    grandPrix: "Bahrain Grand Prix",
    name: "Bahrain Grand Prix",
    circuitName: "Bahrain International Circuit",
    date: "2026-03-22T00:00:00.000Z",
    status: "COMPLETED",
  },
];

const RACES_2025: ExternalRace[] = [
  {
    id: "r3",
    seasonYear: 2025,
    round: 1,
    grandPrix: "Brazilian Grand Prix",
    name: "Brazilian Grand Prix",
    circuitName: "Interlagos",
    date: "2025-03-09T00:00:00.000Z",
    status: "COMPLETED",
  },
];

const RESULTS_2026: ExternalResult[] = [
  {
    id: "res1",
    externalRace: { seasonYear: 2026, round: 1 },
    externalDriver: { externalId: "lando-norris", name: "Lando Norris" },
    position: 1,
    points: 25,
    grid: 1,
    fastestLap: true,
    status: "Finished",
  },
  {
    id: "res2",
    externalRace: { seasonYear: 2026, round: 1 },
    externalDriver: { externalId: "oscar-piastri", name: "Oscar Piastri" },
    position: 2,
    points: 18,
    grid: 2,
    fastestLap: false,
    status: "Finished",
  },
  {
    id: "res3",
    externalRace: { seasonYear: 2026, round: 2 },
    externalDriver: { externalId: "oscar-piastri", name: "Oscar Piastri" },
    position: 1,
    points: 25,
    grid: 1,
    fastestLap: false,
    status: "Finished",
  },
];

const RESULTS_2025: ExternalResult[] = [
  {
    id: "res4",
    externalRace: { seasonYear: 2025, round: 1 },
    externalDriver: { externalId: "fernando-alonso", name: "Fernando Alonso" },
    position: 1,
    points: 25,
    grid: 1,
    fastestLap: true,
    status: "Finished",
  },
];

const STANDINGS_2026: ExternalStanding[] = [
  {
    id: "st1",
    seasonYear: 2026,
    externalDriver: { externalId: "lando-norris", name: "Lando Norris" },
    position: 1,
    points: 25,
    wins: 1,
    podiums: 1,
  },
  {
    id: "st2",
    seasonYear: 2026,
    externalDriver: { externalId: "oscar-piastri", name: "Oscar Piastri" },
    position: 2,
    points: 18,
    wins: 0,
    podiums: 0,
  },
];

const STANDINGS_2025: ExternalStanding[] = [
  {
    id: "st3",
    seasonYear: 2025,
    externalDriver: { externalId: "fernando-alonso", name: "Fernando Alonso" },
    position: 1,
    points: 25,
    wins: 1,
    podiums: 1,
  },
];

function seasonYearOfPath(path: string): number | null {
  const match = path.match(/seasonYear=(\d+)/);
  return match ? Number(match[1]) : null;
}

let seasonsFixture: ExternalSeason[];
let teamsFixture: ExternalTeam[];
let driversFixture: ExternalDriver[];
let driverSeasons2026: ExternalDriverSeason[];
let driverSeasons2025: ExternalDriverSeason[];
let races2026: ExternalRace[];
let races2025: ExternalRace[];
let results2026: ExternalResult[];
let results2025: ExternalResult[];
let standings2026: ExternalStanding[];
let standings2025: ExternalStanding[];
let failSeasons: boolean;
let pendingSeasons: boolean;
let pendingSeasonsResolve: ((value: unknown) => void) | null;
let pendingSeasonsPromise: Promise<unknown> | null;
const calledPaths: string[] = [];

beforeEach(() => {
  seasonsFixture = SEASONS;
  teamsFixture = TEAMS;
  driversFixture = DRIVERS;
  driverSeasons2026 = DRIVER_SEASONS_2026;
  driverSeasons2025 = DRIVER_SEASONS_2025;
  races2026 = RACES_2026;
  races2025 = RACES_2025;
  results2026 = RESULTS_2026;
  results2025 = RESULTS_2025;
  standings2026 = STANDINGS_2026;
  standings2025 = STANDINGS_2025;
  failSeasons = false;
  pendingSeasons = false;
  pendingSeasonsResolve = null;
  pendingSeasonsPromise = null;
  calledPaths.length = 0;

  apiMock.get.mockImplementation(async (path: string) => {
    calledPaths.push(path);
    const year = seasonYearOfPath(path);

    if (path.startsWith("/api/reconciliation/external/SEASON?")) {
      if (failSeasons) throw new ApiError("Falha", 500);
      if (pendingSeasons) {
        pendingSeasonsPromise = new Promise((resolve) => {
          pendingSeasonsResolve = resolve;
        });
        return pendingSeasonsPromise;
      }
      return { items: seasonsFixture };
    }
    if (path.startsWith("/api/reconciliation/external/TEAM?")) {
      return { items: teamsFixture };
    }
    if (path.startsWith("/api/reconciliation/external/DRIVER?")) {
      return { items: driversFixture };
    }
    if (path.startsWith("/api/reconciliation/external/DRIVER_SEASON?")) {
      return { items: year === 2025 ? driverSeasons2025 : driverSeasons2026 };
    }
    if (path.startsWith("/api/reconciliation/external/RACE?")) {
      return { items: year === 2025 ? races2025 : races2026 };
    }
    if (path.startsWith("/api/reconciliation/external/RESULT?")) {
      return { items: year === 2025 ? results2025 : results2026 };
    }
    if (path.startsWith("/api/reconciliation/external/STANDING?")) {
      return { items: year === 2025 ? standings2025 : standings2026 };
    }
    if (path.startsWith("/api/reconciliation/candidates/DRIVER/")) {
      const externalId = path.split("/")[4];
      return {
        listing: {
          external: { kind: "DRIVER", source: "jolpica", label: externalId },
          currentBinding: null,
          candidates: [],
        },
      };
    }
    throw new ApiError("Não encontrado", 404);
  });

  apiMock.post.mockImplementation(async () => undefined);
  apiMock.patch.mockImplementation(async () => undefined);
  apiMock.put.mockImplementation(async () => undefined);
  apiMock.remove.mockImplementation(async () => undefined);
});

describe("F1 World Data - External World Data", () => {
  it("renderiza cabeçalho, badge de fonte e meta de temporadas", async () => {
    renderWithClient(<F1WorldDataPage />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "F1 World Data" }),
    ).toBeDefined();
    expect(screen.getByText("EXTERNAL WORLD DATA")).toBeDefined();
    expect(await screen.findByText("2 temporadas na fonte")).toBeDefined();
    expect(screen.getAllByText("FONTE: JOLPICA-F1 · EXTERNAL").length).toBeGreaterThan(0);
  });

  it("grid vem de ExternalDriverSeason e agrupa por equipe sem inventar lugares", async () => {
    renderWithClient(<F1WorldDataPage />);

    const grid = await screen.findByRole("region", { name: "Grid externo" });
    await within(grid).findByRole("heading", { name: "McLaren" });
    expect(within(grid).getByText("Lando Norris")).toBeDefined();
    expect(within(grid).getByText("Oscar Piastri")).toBeDefined();
    expect(within(grid).getByText("#2")).toBeDefined();
    expect(within(grid).getByText("Reserva")).toBeDefined();
    expect(within(grid).queryByText(/Lugar|Seat/i)).toBeNull();
    expect(within(grid).queryByText("Ferrari")).toBeNull();
  });

  it("pilotos da temporada mostram nacionalidade, identidade e sincronização", async () => {
    renderWithClient(<F1WorldDataPage />);

    const drivers = await screen.findByRole("region", { name: "Pilotos externos" });
    expect(await within(drivers).findByText("Lando Norris")).toBeDefined();
    expect(within(drivers).getByText("British")).toBeDefined();
    expect(within(drivers).getByText(/ID: lando-norris/)).toBeDefined();
    expect(within(drivers).getAllByText("2026-09-01").length).toBeGreaterThan(0);
    expect(within(drivers).queryByText("Fernando Alonso")).toBeNull();
  });

  it("equipes da temporada derivam das equipes da fonte", async () => {
    renderWithClient(<F1WorldDataPage />);

    const teams = await screen.findByRole("region", { name: "Equipes externas" });
    expect(await within(teams).findByText("McLaren")).toBeDefined();
    expect(within(teams).getByText("MCL")).toBeDefined();
    expect(within(teams).getByText(/ID externo: mclaren/)).toBeDefined();
    expect(within(teams).getByText("3 pilotos na temporada")).toBeDefined();
  });

  it("calendário da fonte lista corridas com circuito e data", async () => {
    renderWithClient(<F1WorldDataPage />);

    const calendar = await screen.findByRole("region", { name: "Calendário externo" });
    expect(await within(calendar).findByText("Australian Grand Prix")).toBeDefined();
    expect(within(calendar).getByText("Albert Park")).toBeDefined();
    expect(within(calendar).getByText(/2026-03-08/)).toBeDefined();
    expect(within(calendar).getByText("R1")).toBeDefined();
  });

  it("classificação é renderizada como dados da fonte", async () => {
    renderWithClient(<F1WorldDataPage />);

    const standings = await screen.findByRole("region", { name: "Classificação externa" });
    expect(
      await within(standings).findByRole("heading", { name: "Classificação" }),
    ).toBeDefined();
    expect(within(standings).getByText("Lando Norris")).toBeDefined();
    expect(within(standings).getByText("1V · 1P")).toBeDefined();
    expect(within(standings).getAllByText("PTS").length).toBeGreaterThan(0);
    expect(within(standings).getByText("FONTE: JOLPICA-F1 · EXTERNAL")).toBeDefined();
  });

  it("resultados por corrida com seletor de rodada e volta mais rápida", async () => {
    const user = userEvent.setup();
    renderWithClient(<F1WorldDataPage />);

    const results = await screen.findByRole("region", { name: "Resultados externos" });
    expect(
      await within(results).findByRole("button", { name: /Corrida da fonte/ }),
    ).toBeDefined();
    expect(within(results).getByText("Lando Norris")).toBeDefined();
    expect(within(results).getByText("VL")).toBeDefined();

    await user.click(
      screen.getByRole("button", { name: /Corrida da fonte/ }),
    );
    await user.click(
      screen.getByRole("option", { name: "R2 · Bahrain Grand Prix" }),
    );

    expect(within(results).getByText("Oscar Piastri")).toBeDefined();
    expect(within(results).queryByText("Lando Norris")).toBeNull();
  });

  it("trocar de temporada recarrega grid, calendário e classificação", async () => {
    const user = userEvent.setup();
    renderWithClient(<F1WorldDataPage />);

    const trigger = await screen.findByRole("button", { name: /Temporada da fonte/ });
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "2025 — Concluída" }));

    const grid = screen.getByRole("region", { name: "Grid externo" });
    expect(await within(grid).findByText("Ferrari")).toBeDefined();
    expect(within(grid).getByText("Fernando Alonso")).toBeDefined();
    expect(within(grid).getByText("Mystery Driver")).toBeDefined();
    expect(within(grid).getByText("Equipe não informada")).toBeDefined();
    expect(within(grid).queryByText("Lando Norris")).toBeNull();

    const calendar = screen.getByRole("region", { name: "Calendário externo" });
    expect(await within(calendar).findByText("Brazilian Grand Prix")).toBeDefined();

    const standings = screen.getByRole("region", { name: "Classificação externa" });
    expect(await within(standings).findByText("Fernando Alonso")).toBeDefined();
  });

  it("verificar correspondência abre diálogo somente leitura sem confirmar", async () => {
    const user = userEvent.setup();
    renderWithClient(<F1WorldDataPage />);

    const drivers = await screen.findByRole("region", { name: "Pilotos externos" });
    await within(drivers).findByText("Lando Norris");
    const verify = within(drivers).getByRole("button", {
      name: /Verificar correspondência de Lando Norris/,
    });
    await user.click(verify);

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Correspondência — Lando Norris");
    expect(await within(dialog).findByText(/vínculo no universo/)).toBeDefined();
    expect(within(dialog).queryByRole("button", { name: /Confirmar/ })).toBeNull();
  });

  it("sem temporadas: mostra estado vazio da fonte", async () => {
    seasonsFixture = [];
    renderWithClient(<F1WorldDataPage />);

    expect(
      await screen.findByText("Nenhum dado externo importado ainda."),
    ).toBeDefined();
  });

  it("seção sem dados da fonte: estado vazio distinto de erro", async () => {
    driverSeasons2026 = [];
    renderWithClient(<F1WorldDataPage />);

    const grid = await screen.findByRole("region", { name: "Grid externo" });
    expect(
      await within(grid).findByText("Não há dados de grid na fonte para 2026."),
    ).toBeDefined();
    expect(within(grid).queryByRole("button", { name: /Tentar novamente/ })).toBeNull();
  });

  it("estado de erro: falha ao carregar temporadas da fonte", async () => {
    failSeasons = true;
    renderWithClient(<F1WorldDataPage />);

    expect(await screen.findByText("Dados indisponíveis")).toBeDefined();
    expect(screen.getByRole("button", { name: /Tentar novamente/ })).toBeDefined();
  });

  it("estado de carregamento: spinner enquanto a fonte responde", async () => {
    pendingSeasons = true;
    const result = renderWithClient(<F1WorldDataPage />);
    expect(result.container.querySelector(".animate-spin")).toBeTruthy();
    pendingSeasonsResolve?.({ items: SEASONS });
    expect(
      await screen.findByRole("heading", { level: 1, name: "F1 World Data" }),
    ).toBeDefined();
  });

  it("não usa dados do universo nem currentSeasonId", async () => {
    renderWithClient(<F1WorldDataPage />);

    await screen.findByRole("heading", { level: 1, name: "F1 World Data" });
    const universePaths = calledPaths.filter(
      (path) =>
        path.startsWith("/api/world") ||
        path.startsWith("/api/seasons/") ||
        path === "/api/seasons" ||
        path.startsWith("/api/drivers") ||
        path.startsWith("/api/teams") ||
        path.startsWith("/api/characters"),
    );
    expect(universePaths).toEqual([]);
    expect(screen.queryByText("Atual")).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Contexto do campeonato" }),
    ).toBeNull();
  });
});