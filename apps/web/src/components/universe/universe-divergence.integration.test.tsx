import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import UniverseEditorPage from "@/app/app/universe/page";
import { ApiError } from "@/lib/api";
import type { PlayerEntrySeason, PlayerEntrySetup } from "@/lib/player-entry";
import type { RosterComparison, UniverseDivergence } from "@/lib/universe";
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

const sessionMock = vi.hoisted(() => ({
  session: {
    data: {
      user: { role: "ADMIN" as string },
    },
    isPending: false,
  },
}));

vi.mock("@/providers/session-provider", () => ({
  useSession: () => sessionMock.session,
}));

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

const DIVERGENCE: UniverseDivergence = {
  kind: "CREATED",
  origin: "ROSTER_HIRE",
  eventId: "evt-0001",
  occurredAt: "2026-09-11T12:00:00.000Z",
  summary: "Piloto foi contratado pelo time do universo",
  readOnly: true,
};

const seat = (overrides: Partial<Record<string, unknown>> = {}) => ({
  seat: 2,
  status: "DIVERGENCE",
  source: { externalDriverId: "e2", name: "Oscar Piastri", number: 81 },
  universe: {
    entryId: "en2",
    driverProfileId: "d2",
    characterId: "c2",
    characterName: "Meu Piloto",
    provenance: "CANONICAL",
  },
  canRestore: true,
  ...overrides,
});

function makeRosterComparison(overrides: Partial<RosterComparison> = {}): RosterComparison {
  return {
    season: { id: "s1", year: 2026, name: "2026", status: "ACTIVE" },
    comparable: true,
    teams: [
      {
        id: "t1",
        name: "McLaren",
        shortName: "MCL",
        color: "#ff8000",
        externalTeamId: "mclaren",
        status: "DIVERGENT",
        seats: [
          {
            seat: 1,
            status: "MATCH",
            source: { externalDriverId: "e1", name: "Lando Norris", number: 1 },
            universe: {
              entryId: "en1",
              driverProfileId: "d1",
              characterId: "c1",
              characterName: "Lando Norris",
              provenance: "IMPORTED",
            },
            canRestore: true,
          },
          seat({ divergence: DIVERGENCE }),
        ],
      },
    ],
    ...overrides,
  };
}

const worldFixture = {
  id: "w1",
  key: "default",
  currentDate: "2026-09-11T00:00:00.000Z",
  currentSeasonId: "s1",
  currentRaceId: null,
  currentSession: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z",
};

let comparisonFixture: RosterComparison | null;
let failComparison: boolean;
let holdComparison: boolean;
let releaseComparison: (() => void) | null;

function comparisonPayload(path: string) {
  if (failComparison) throw new ApiError("Falha", 500);
  if (holdComparison) {
    return new Promise<void>((resolve) => {
      releaseComparison = resolve;
    });
  }
  return comparisonFixture ?? { season: { id: path, year: 2025, name: null, status: "ACTIVE" }, comparable: false, teams: [] };
}

beforeEach(() => {
  comparisonFixture = makeRosterComparison();
  failComparison = false;
  holdComparison = false;
  releaseComparison = null;
  sessionMock.session.data.user.role = "ADMIN";
  apiMock.get.mockClear();
  apiMock.post.mockClear();

  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/world") {
      return { world: worldFixture };
    }
    if (path.startsWith("/api/universe/player-entry/setup")) {
      const setup: PlayerEntrySetup = { seasons: SEASONS, selection: null };
      return setup;
    }
    if (path.match(/\/api\/universe\/roster-comparison\//)) {
      return comparisonPayload(path);
    }
    throw new ApiError("Não encontrado", 404);
  });

  apiMock.post.mockImplementation(async () => ({
    team: makeRosterComparison().teams[0],
  }));
});

async function renderPage() {
  const utils = renderWithClient(<UniverseEditorPage />);
  await screen.findByRole("heading", { level: 1, name: "Editor de Universo" });
  return utils;
}

describe("Universe Editor — histórico da divergência (web)", () => {
  it("divergência com evento histórico mostra a origem identificada", async () => {
    await renderPage();

    expect(await screen.findByText("Origem da divergência")).toBeDefined();
    expect(screen.getByText("Contratação (roster)")).toBeDefined();
    expect(screen.getByText("Piloto foi contratado pelo time do universo")).toBeDefined();
    expect(screen.getByText(/Ocorrido em 11\/09\/2026/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Ver evento" })).toBeDefined();
  });

  it("divergência sem evento histórico fica neutra e não inventa a origem", async () => {
    comparisonFixture = makeRosterComparison({
      teams: [
        {
          id: "t1",
          name: "McLaren",
          shortName: "MCL",
          color: "#ff8000",
          externalTeamId: "mclaren",
          status: "DIVERGENT",
          seats: [
            {
              seat: 1,
              status: "MATCH",
              source: { externalDriverId: "e1", name: "Lando Norris", number: 1 },
              universe: {
                entryId: "en1",
                driverProfileId: "d1",
                characterId: "c1",
                characterName: "Lando Norris",
                provenance: "IMPORTED",
              },
              canRestore: true,
            },
            seat({ divergence: null }),
          ],
        },
      ],
    });
    await renderPage();

    expect(
      await screen.findByText(/Sem evento registrado para este assento/),
    ).toBeDefined();
    expect(screen.queryByText("Contratação (roster)")).toBeNull();
    expect(screen.queryByRole("button", { name: "Ver evento" })).toBeNull();
  });

  it("MATCH não mostra bloco de divergência histórica", async () => {
    comparisonFixture = makeRosterComparison({
      teams: [
        {
          id: "t1",
          name: "McLaren",
          shortName: "MCL",
          color: "#ff8000",
          externalTeamId: "mclaren",
          status: "MATCH",
          seats: [
            {
              seat: 1,
              status: "MATCH",
              source: { externalDriverId: "e1", name: "Lando Norris", number: 1 },
              universe: {
                entryId: "en1",
                driverProfileId: "d1",
                characterId: "c1",
                characterName: "Lando Norris",
                provenance: "IMPORTED",
              },
              canRestore: true,
            },
          ],
        },
      ],
    });
    await renderPage();

    await screen.findByText("McLaren");
    expect(screen.queryByText("Origem da divergência")).toBeNull();
    expect(screen.queryByText("Sem evento registrado para este assento")).toBeNull();
  });

  it("SOURCE_ONLY não mostra bloco de divergência", async () => {
    comparisonFixture = makeRosterComparison({
      teams: [
        {
          id: "t1",
          name: "Ferrari",
          shortName: "FER",
          color: "#dc0000",
          externalTeamId: "ferrari",
          status: "DIVERGENT",
          seats: [
            {
              seat: 1,
              status: "SOURCE_ONLY",
              source: { externalDriverId: "e1", name: "Charles Leclerc", number: 16 },
              universe: null,
              canRestore: false,
            },
          ],
        },
      ],
    });
    await renderPage();

    await screen.findByText("Charles Leclerc");
    expect(screen.getByText("Charles Leclerc")).toBeDefined();
    expect(screen.queryByText("Origem da divergência")).toBeNull();
    expect(screen.queryByText("Sem evento registrado para este assento")).toBeNull();
  });

  it("UNIVERSE_ONLY sem evento fica neutro e não inventa a origem", async () => {
    comparisonFixture = makeRosterComparison({
      teams: [
        {
          id: "t1",
          name: "Ferrari",
          shortName: "FER",
          color: "#dc0000",
          externalTeamId: "ferrari",
          status: "DIVERGENT",
          seats: [
            {
              seat: 1,
              status: "UNIVERSE_ONLY",
              source: null,
              universe: {
                entryId: "en2",
                driverProfileId: "d2",
                characterId: "c2",
                characterName: "Meu Piloto",
                provenance: "CANONICAL",
              },
              canRestore: false,
              divergence: null,
            },
          ],
        },
      ],
    });
    await renderPage();

    expect(
      await screen.findByText(/Sem evento registrado para este assento/),
    ).toBeDefined();
    expect(screen.queryByText("Inicialização do universo")).toBeNull();
    expect(screen.queryByRole("button", { name: "Ver evento" })).toBeNull();
  });

  it("Ver evento abre o diálogo somente leitura", async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(await screen.findByRole("button", { name: "Ver evento" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Evento histórico do assento" }),
    ).toBeDefined();
    expect(within(dialog).getByText("Somente leitura · evento histórico")).toBeDefined();
    expect(within(dialog).getByText("Criação da entrada")).toBeDefined();
    expect(within(dialog).getByText("Contratação (roster)")).toBeDefined();
    expect(within(dialog).getByText("evt-0001")).toBeDefined();
    expect(within(dialog).getByText(/O evento é apenas o histórico/)).toBeDefined();
    expect(within(dialog).queryByRole("button", { name: /Editar|Excluir/i })).toBeNull();

    await user.click(within(dialog).getAllByRole("button", { name: "Fechar" })[1]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("mostra carregamento enquanto a comparação é buscada", async () => {
    holdComparison = true;
    const utils = renderWithClient(<UniverseEditorPage />);
    await screen.findByRole("heading", { level: 1, name: "Editor de Universo" });

    expect(utils.container.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.queryByText("Origem da divergência")).toBeNull();

    holdComparison = false;
    if (releaseComparison) releaseComparison();

    await screen.findByText("McLaren");
  });

  it("erro ao carregar a comparação: estado de erro e retry recupera", async () => {
    failComparison = true;
    await renderPage();

    expect(
      await screen.findByText(
        "Não foi possível comparar o universo com a fonte.",
      ),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Tentar novamente" }),
    ).toBeDefined();

    failComparison = false;
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));

    expect(await screen.findByText("Origem da divergência")).toBeDefined();
  });

  it("ADMIN visualiza a origem e o evento histórico", async () => {
    await renderPage();

    expect(await screen.findByText("Origem da divergência")).toBeDefined();
    expect(screen.getByRole("button", { name: "Ver evento" })).toBeDefined();
  });

  it("usuário comum também visualiza a origem e o evento (somente leitura)", async () => {
    sessionMock.session.data.user.role = "USER";
    await renderPage();

    expect(await screen.findByText("Origem da divergência")).toBeDefined();
    expect(screen.getByText("Contratação (roster)")).toBeDefined();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Ver evento" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Somente leitura · evento histórico")).toBeDefined();
    expect(within(dialog).queryByRole("button", { name: /Editar|Excluir/i })).toBeNull();
  });
});