import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TimelineView } from "@/components/timeline/timeline-view";
import { ApiError } from "@/lib/api";
import type { TimelineEventDetail, TimelineItem } from "@/lib/timeline";
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

function makeItem(overrides: Partial<TimelineItem> & { id: string }): TimelineItem {
  return {
    sequence: 1,
    worldDate: "2087-01-04T00:00:00.000Z",
    kind: "RACE_RESULT_CORRECTED",
    causedBy: "USER",
    supersedesId: null,
    supersededById: null,
    isCorrection: true,
    isSuperseded: false,
    summary: "Resultado corrigido em GP Sintético 1: Piloto Um",
    race: { id: "r1", name: "GP Sintético 1", round: 1 },
    season: { id: "s1", year: 2087, name: "2087" },
    driver: { id: "d1", name: "Piloto Um" },
    team: null,
    number: null,
    values: { position: 1 },
    ...overrides,
  };
}

const CORRECTION = makeItem({ id: "e-corr" });
const SUPERSEDED = makeItem({
  id: "e-old",
  sequence: 2,
  kind: "RACE_RESULT_CORRECTED",
  isSuperseded: true,
  supersededById: "e-corr",
  summary: "Resultado corrigido em GP Sintético 1: Piloto Dois",
});

const DETAIL: TimelineEventDetail = {
  item: CORRECTION,
  supersedesChain: [SUPERSEDED],
  supersededByChain: [],
  edit: {
    editorKind: "RACE_RESULT",
    canEdit: true,
    blockedReason: null,
    defaultWorldDate: "2026-01-01T00:00:00.000Z",
    suggestedSupersedesId: "e-corr",
    values: { position: 1 },
    currentValues: { position: 1, grid: 1, status: "Finished", points: 25 },
    narrativeStaleEventIds: [],
  },
};

const DIVERGENCE = {
  season: { id: "s1", year: 2087, name: "2087" },
  summary: { match: 1, divergent: 1, noExternal: 0, universeOnly: 1, externalOnly: 1 },
  races: [
    {
      classification: "MATCH",
      raceId: "r1",
      externalRaceId: "er1",
      round: 1,
      name: "GP Sintético 1",
      date: "2087-03-01",
      fields: [],
    },
    {
      classification: "UNIVERSE_ONLY",
      raceId: "r2",
      externalRaceId: null,
      round: 2,
      name: "GP Sintético 2",
      date: "2087-03-15",
      fields: [],
    },
  ],
  results: [
    {
      classification: "DIVERGENT",
      raceId: "r1",
      raceName: "GP Sintético 1",
      driverProfileId: "d1",
      driverName: "Piloto Um",
      position: 1,
      externalPosition: 2,
      grid: 1,
      externalGrid: 1,
      status: "Finished",
      externalStatus: "Finished",
      fields: ["position"],
    },
    {
      classification: "EXTERNAL_ONLY",
      raceId: null,
      raceName: "GP Sintético 1",
      driverProfileId: null,
      driverName: "Piloto Externo",
      position: null,
      externalPosition: 9,
      grid: null,
      externalGrid: 9,
      status: null,
      externalStatus: "Finished",
      fields: [],
    },
  ],
  standings: [],
};

function listResponse(events: TimelineItem[] = [CORRECTION, SUPERSEDED]) {
  return {
    events,
    nextCursor: null,
    hasMore: false,
    beyondScanLimit: false,
  };
}

beforeEach(() => {
  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/seasons") {
      return {
        seasons: [
          {
            id: "s1",
            year: 2087,
            name: "2087",
            status: "ACTIVE",
            createdAt: "2087-01-01T00:00:00.000Z",
            updatedAt: "2087-01-01T00:00:00.000Z",
          },
        ],
      };
    }
    if (path === "/api/drivers") return { drivers: [] };
    if (path === "/api/teams") return { teams: [] };
    if (path === "/api/seasons/s1/races") return { races: [] };
    if (path.startsWith("/api/timeline/events/")) return DETAIL;
    if (path.startsWith("/api/timeline/divergence")) {
      return { divergence: DIVERGENCE };
    }
    if (path.startsWith("/api/timeline")) return listResponse();
    throw new ApiError("Não encontrado", 404);
  });
  apiMock.post.mockImplementation(async () => undefined);
  apiMock.patch.mockImplementation(async () => undefined);
  apiMock.put.mockImplementation(async () => undefined);
  apiMock.remove.mockImplementation(async () => undefined);
});

describe("TimelineView", () => {
  it("1) mostra loading", () => {
    apiMock.get.mockImplementation(() => new Promise(() => undefined));
    renderWithClient(<TimelineView />);
    expect(screen.getByLabelText("Carregando linha do tempo")).toBeDefined();
  });

  it("2) mostra empty state", async () => {
    apiMock.get.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/timeline") && !path.includes("/divergence")) {
        return listResponse([]);
      }
      if (path === "/api/seasons") return { seasons: [] };
      if (path === "/api/drivers") return { drivers: [] };
      if (path === "/api/teams") return { teams: [] };
      throw new ApiError("Não encontrado", 404);
    });
    renderWithClient(<TimelineView />);
    expect(await screen.findByText("Nenhum evento encontrado")).toBeDefined();
  });

  it("3) lista eventos com badges de correção e supersession", async () => {
    renderWithClient(<TimelineView />);
    expect(
      await screen.findByText("Resultado corrigido em GP Sintético 1: Piloto Um"),
    ).toBeDefined();
    expect(
      screen.getByText("Resultado corrigido em GP Sintético 1: Piloto Dois"),
    ).toBeDefined();
    expect(screen.getAllByText("Correção de resultado").length).toBe(2);
    expect(screen.getByText("Substituído")).toBeDefined();
    expect(screen.getByText("Efetivo")).toBeDefined();
  });

  it("4) filtros de data e somente correções chegam à API", async () => {
    renderWithClient(<TimelineView />);
    await screen.findByText("Resultado corrigido em GP Sintético 1: Piloto Um");

    fireEvent.change(screen.getByLabelText("De"), {
      target: { value: "2087-01-07" },
    });
    await screen.findByText("Resultado corrigido em GP Sintético 1: Piloto Um");
    const dateCall = apiMock.get.mock.calls
      .map((call) => String(call[0]))
      .find((path) => path.includes("from=2087-01-07"));
    expect(dateCall).toBeTruthy();

    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/Somente correções/));
    const correctionsCall = apiMock.get.mock.calls
      .map((call) => String(call[0]))
      .find((path) => path.includes("correctionsOnly=true"));
    expect(correctionsCall).toBeTruthy();
  });

  it("5) abre detalhe com cadeia de supersession", async () => {
    const user = userEvent.setup();
    renderWithClient(<TimelineView />);
    await user.click(
      await screen.findByRole("button", {
        name: /Resultado corrigido em GP Sintético 1: Piloto Um/,
      }),
    );
    const detail = await screen.findByRole("region", {
      name: "Detalhe do evento",
    });
    await user.click(within(detail).getByRole("tab", { name: "Histórico" }));
    expect(within(detail).getByText("Cadeia de correções")).toBeDefined();
    expect(within(detail).getByText("#2")).toBeDefined();
    expect(
      within(detail).getByText(/Resultado corrigido em GP Sintético 1: Piloto Dois/),
    ).toBeDefined();
    expect(within(detail).getByText("Atual")).toBeDefined();
    expect(apiMock.get).toHaveBeenCalledWith("/api/timeline/events/e-corr");
  });

  it("6) erro de API mostra alerta com retry", async () => {
    apiMock.get.mockImplementation(async (path: string) => {
      if (path === "/api/seasons") return { seasons: [] };
      if (path === "/api/drivers") return { drivers: [] };
      if (path === "/api/teams") return { teams: [] };
      throw new ApiError("Serviço indisponível", 500);
    });
    const user = userEvent.setup();
    renderWithClient(<TimelineView />);
    expect(await screen.findByText("Serviço indisponível")).toBeDefined();
    const before = apiMock.get.mock.calls.length;
    await user.click(screen.getByRole("button", { name: /Tentar novamente/ }));
    expect(apiMock.get.mock.calls.length).toBeGreaterThan(before);
  });

  it("7) divergência externa é exibida com classificações", async () => {
    const user = userEvent.setup();
    renderWithClient(<TimelineView />);
    await screen.findByText("Resultado corrigido em GP Sintético 1: Piloto Um");

    await user.click(screen.getByRole("button", { name: "Temporada" }));
    await user.click(await screen.findByRole("option", { name: "2087" }));
    await user.click(
      await screen.findByRole("button", {
        name: /Verificar divergência externa/,
      }),
    );

    const panel = await screen.findByRole("region", {
      name: "Divergência externa",
    });
    expect(within(panel).getByText("Alinhado")).toBeDefined();
    expect(within(panel).getByText("Divergente")).toBeDefined();
    expect(within(panel).getByText("Somente Universe")).toBeDefined();
    expect(within(panel).getByText("Somente externo")).toBeDefined();
    expect(
      within(panel).getByText(/Realidade externa × Universe/),
    ).toBeDefined();
  });

  it("8) não expõe JSON bruto da timeline", async () => {
    const { container } = renderWithClient(<TimelineView />);
    await screen.findByText("Resultado corrigido em GP Sintético 1: Piloto Um");
    expect(container.querySelector("pre")).toBeNull();
    expect(container.textContent).not.toContain("supersedesId");
  });
});
