import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PlayerEntryPage from "@/app/app/player-entry/page";
import { ApiError } from "@/lib/api";
import type {
  PlayerEntryCreateResult,
  PlayerEntrySeason,
  PlayerEntryTeam,
} from "@/lib/player-entry";
import { renderWithClient } from "@/test/render-with-client";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
}));

const navigationMock = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: navigationMock.push,
    refresh: () => undefined,
  }),
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
];

const TEAMS: PlayerEntryTeam[] = [
  {
    id: "t1",
    name: "McLaren",
    shortName: "MCL",
    color: "#ff8000",
    externalTeamId: "mclaren",
    seats: [
      {
        seat: 1,
        source: { name: "Lando Norris", number: 1, teamName: "McLaren" },
        universe: null,
      },
      {
        seat: 2,
        source: { name: "Oscar Piastri", number: 81, teamName: "McLaren" },
        universe: { characterName: "Meu Piloto", provenance: "CANONICAL" },
      },
    ],
    reserve: [{ name: "Reserve X", number: 88, teamName: "McLaren" }],
  },
];

function makeCreateResult(overrides: Partial<PlayerEntryCreateResult> = {}): PlayerEntryCreateResult {
  const iso = "2026-09-10T12:00:00.000Z";
  return {
    character: {
      id: "c3",
      name: "Kimi",
      nationality: "Brasileira",
      gender: null,
      birthDate: "1995-05-05T00:00:00.000Z",
      imageUrl: null,
      biography: null,
      controlledBy: "USER",
      userId: "u1",
      createdAt: iso,
      updatedAt: iso,
    },
    driverProfile: {
      id: "dp3",
      characterId: "c3",
      number: null,
      teamId: "t1",
      updatedAt: iso,
    },
    entry: {
      id: "e3",
      seasonId: "s1",
      teamId: "t1",
      driverProfileId: "dp3",
      role: "RACE_SEAT",
      seat: 2,
      number: null,
      status: "ACTIVE",
      provenance: "CANONICAL",
      createdAt: iso,
      updatedAt: iso,
      driverProfile: {
        id: "dp3",
        characterId: "c3",
        number: null,
        teamId: "t1",
        character: {
          id: "c3",
          name: "Kimi",
          nationality: "Brasileira",
          imageUrl: null,
        },
      },
      team: {
        id: "t1",
        name: "McLaren",
        shortName: "MCL",
        color: "#ff8000",
      },
    },
    displaced: {
      entry: {
        id: "e2",
        seasonId: "s1",
        teamId: null,
        driverProfileId: "dp2",
        role: null,
        seat: null,
        number: null,
        status: "AVAILABLE",
        provenance: "CANONICAL",
        createdAt: iso,
        updatedAt: iso,
        driverProfile: {
          id: "dp2",
          characterId: "c2",
          number: null,
          teamId: "t1",
          character: {
            id: "c2",
            name: "Meu Piloto",
            nationality: "Monegasco",
            imageUrl: null,
          },
        },
        team: {
          id: "t1",
          name: "McLaren",
          shortName: "MCL",
          color: "#ff8000",
        },
      },
    },
    ...overrides,
  };
}

let seasonsFixture: PlayerEntrySeason[];
let teamsFixture: PlayerEntryTeam[];
let failSeasons: boolean;
const setupPaths: string[] = [];

beforeEach(() => {
  seasonsFixture = SEASONS;
  teamsFixture = TEAMS;
  failSeasons = false;
  setupPaths.length = 0;
  navigationMock.push.mockReset();
  apiMock.get.mockClear();
  apiMock.post.mockClear();

  apiMock.get.mockImplementation(async (path: string) => {
    setupPaths.push(path);
    if (path.startsWith("/api/universe/player-entry/setup")) {
      if (failSeasons) throw new ApiError("Falha", 500);
      const match = path.match(/seasonId=([^&]+)/);
      const seasonId = match ? decodeURIComponent(match[1]) : undefined;
      return {
        seasons: seasonsFixture,
        selection: seasonId ? { seasonId, teams: teamsFixture } : null,
      };
    }
    throw new ApiError("Não encontrado", 404);
  });

  apiMock.post.mockImplementation(async () => makeCreateResult());
  apiMock.patch.mockImplementation(async () => undefined);
  apiMock.put.mockImplementation(async () => undefined);
  apiMock.remove.mockImplementation(async () => undefined);
});

async function goToStep2() {
  const user = userEvent.setup();
  const trigger = await screen.findByLabelText("Temporada da fonte");
  await user.click(trigger);
  await user.click(
    await screen.findByRole("option", { name: /Temporada 2026/ }),
  );
  await user.click(screen.getByRole("button", { name: "Continuar" }));
}

async function goToStep4() {
  const user = userEvent.setup();
  await goToStep2();
  await user.click(
    await screen.findByRole("button", { name: /McLaren/ }),
  );
  await user.click(screen.getByRole("button", { name: "Continuar" }));
  await user.click(
    await screen.findByRole("button", { name: /Segundo piloto/ }),
  );
  await user.click(screen.getByRole("button", { name: "Continuar" }));
}

async function fillPilotIdentity() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Nome"), "Kimi");
  await user.type(screen.getByLabelText("Nacionalidade"), "Brasileira");
  fireEvent.change(screen.getByLabelText("Data de nascimento"), {
    target: { value: "1995-05-05" },
  });
}

describe("Player Entry - Entrar na F1", () => {
  it("renders the page header and wizard title", async () => {
    renderWithClient(<PlayerEntryPage />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Entrar na F1" }),
    ).toBeDefined();
    expect(screen.getByText("UNIVERSO / PLAYER ENTRY")).toBeDefined();
    expect(screen.getByText("Novo piloto no grid")).toBeDefined();
  });

  it("passo temporada: lista a temporada espelhada e carrega as equipes ao escolher", async () => {
    renderWithClient(<PlayerEntryPage />);
    await goToStep2();

    const mclarenCard = await screen.findByRole("button", { name: /McLaren/ });
    expect(
      within(mclarenCard as HTMLElement).getByText("ID externo: mclaren"),
    ).toBeDefined();

    const setupCalls = setupPaths.filter((path) =>
      path.startsWith("/api/universe/player-entry/setup"),
    );
    expect(setupCalls[0]).toBe("/api/universe/player-entry/setup");
    expect(setupCalls).toContain(
      "/api/universe/player-entry/setup?seasonId=s1",
    );
  });

  it("passo assento: mostra piloto da fonte, reserva e ocupante do universo", async () => {
    renderWithClient(<PlayerEntryPage />);
    const user = userEvent.setup();
    await goToStep2();
    await user.click(await screen.findByRole("button", { name: /McLaren/ }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    const seat2 = await screen.findByRole("button", { name: /Segundo piloto/ });
    expect(
      within(seat2 as HTMLElement).getByText(/Oscar Piastri/),
    ).toBeDefined();
    expect(
      within(seat2 as HTMLElement).getByText(/Meu Piloto/),
    ).toBeDefined();
    expect(
      within(seat2 as HTMLElement).getByText(/será deslocado/),
    ).toBeDefined();

    const seat1 = screen.getByRole("button", { name: /Primeiro piloto/ });
    expect(
      within(seat1 as HTMLElement).getByText(/Lando Norris/),
    ).toBeDefined();
    expect(
      within(seat1 as HTMLElement).getByText(/Vaga livre no seu universo/),
    ).toBeDefined();

    expect(screen.getByText(/Reservas na fonte:/)).toBeDefined();
    expect(screen.getByText(/Reserve X/)).toBeDefined();
  });

  it("fluxo completo: envia payload correto e exibe resultado com deslocamento", async () => {
    renderWithClient(<PlayerEntryPage />);
    const user = userEvent.setup();

    await goToStep4();

    await fillPilotIdentity();
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(screen.getByText(/Temporada 2026 · Ativa/)).toBeDefined();
    expect(screen.getByText(/McLaren \(MCL\)/)).toBeDefined();
    expect(
      screen.getByText(/Segundo piloto — substitui Oscar Piastri/),
    ).toBeDefined();
    expect(screen.getByText(/Kimi · Brasileira/)).toBeDefined();
    expect(screen.getByText("05/05/1995")).toBeDefined();
    expect(
      screen.getByText(/Meu Piloto/),
    ).toBeDefined();
    expect(screen.getByText(/será deslocado para abrir espaço para Kimi/)).toBeDefined();

    await user.click(
      screen.getByRole("button", { name: "Confirmar entrada na F1" }),
    );

    expect(apiMock.post).toHaveBeenCalledTimes(1);
    expect(apiMock.post).toHaveBeenCalledWith("/api/universe/player-entry", {
      seasonId: "s1",
      teamId: "t1",
      seat: 2,
      name: "Kimi",
      nationality: "Brasileira",
      gender: null,
      birthDate: expect.any(String),
    });

    expect(
      await screen.findByText(/Kimi entrou no grid de 2026!/),
    ).toBeDefined();
    expect(screen.getByText(/Piloto de McLaren/)).toBeDefined();
    expect(screen.getByText(/Meu Piloto/)).toBeDefined();
    expect(
      screen.getByText(/foi deslocado\(a\) para liberar a vaga/),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Ver meus pilotos" }),
    ).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Ver meus pilotos" }));
    expect(navigationMock.push).toHaveBeenCalledWith("/app/drivers");
  });

  it("passo piloto: valida campos obrigatórios antes de avançar", async () => {
    renderWithClient(<PlayerEntryPage />);
    const user = userEvent.setup();

    await goToStep4();
    await user.type(screen.getByLabelText("Nacionalidade"), "Brasileira");
    fireEvent.change(screen.getByLabelText("Data de nascimento"), {
      target: { value: "1995-05-05" },
    });
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByText("Informe o nome")).toBeDefined();
    expect(screen.queryByText("Confirmar entrada na F1")).toBeNull();
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it("sem temporadas espelhadas: mostra estado vazio", async () => {
    seasonsFixture = [];
    renderWithClient(<PlayerEntryPage />);

    expect(
      await screen.findByText("Nenhuma temporada espelhada"),
    ).toBeDefined();
  });

  it("equipes sem espelhamento na temporada: estado vazio da equipe", async () => {
    teamsFixture = [];
    renderWithClient(<PlayerEntryPage />);
    const user = userEvent.setup();

    await goToStep2();

    expect(
      await screen.findByText("Nenhuma equipe espelhada"),
    ).toBeDefined();
  });

  it("erro ao carregar temporadas: estado de erro e retry recupera", async () => {
    failSeasons = true;
    renderWithClient(<PlayerEntryPage />);

    expect(await screen.findByText("Dados indisponíveis")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Tentar novamente" }),
    ).toBeDefined();

    failSeasons = false;
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));

    await screen.findByLabelText("Temporada da fonte");
    expect(screen.queryByText("Dados indisponíveis")).toBeNull();
  });
});