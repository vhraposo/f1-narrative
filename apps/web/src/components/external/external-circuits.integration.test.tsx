import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExternalCircuitsCatalog } from "@/components/external/external-circuits";
import { ApiError } from "@/lib/api";
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

const LIST_ITEM = {
  id: "circ-1",
  name: "Autódromo José Carlos Pace",
  locality: "São Paulo",
  country: "Brazil",
  latitude: -23.7,
  longitude: -46.69,
  lengthMeters: 4309,
  turns: 15,
  direction: null,
  firstRaceYear: 1973,
  lastRaceYear: 2026,
  raceCount: 40,
  media: {
    layout: { key: "interlagos-modern", url: null, source: null, available: false },
    photo: null,
    attributionRequired: false,
  },
};

const DETAIL = {
  ...LIST_ITEM,
  source: "jolpica",
  sourceUrl: "https://en.wikipedia.org/wiki/Interlagos",
  topWinners: [
    { externalDriverId: "d-senna", name: "Ayrton Senna", wins: 2 },
    { externalDriverId: "d-alonso", name: "Fernando Alonso", wins: 1 },
  ],
  recentWinners: [
    {
      externalRaceId: "r-2095",
      raceName: "GP São Paulo 2095",
      seasonYear: 2095,
      round: 3,
      date: "2095-04-01T00:00:00.000Z",
      externalDriverId: "d-senna",
      driverName: "Ayrton Senna",
    },
  ],
  fastestRaceLap: {
    externalDriverId: "d-senna",
    driverName: "Ayrton Senna",
    time: "1:12.345",
    seasonYear: 2095,
    round: 3,
    raceName: "GP São Paulo 2095",
  },
  officialLapRecord: { available: false, reason: "LAP_RECORD_SOURCE_UNAVAILABLE" },
};

beforeEach(() => {
  apiMock.get.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/external/circuits?")) {
      return { circuits: [LIST_ITEM], total: 1 };
    }
    if (path === "/api/external/circuits") {
      return { circuits: [LIST_ITEM], total: 1 };
    }
    if (path === "/api/external/circuits/circ-1") {
      return { circuit: DETAIL };
    }
    throw new ApiError("Não encontrado", 404);
  });
});

describe("ExternalCircuitsCatalog", () => {
  it("1) lista circuitos com país/cidade/extensão e sem inventar mídia", async () => {
    renderWithClient(<ExternalCircuitsCatalog />);
    expect(await screen.findByText("Autódromo José Carlos Pace")).toBeDefined();
    expect(screen.getByText(/Brasil · São Paulo/)).toBeDefined();    expect(screen.getByText(/4,309 km · 15 curvas · 1º GP de F1 em 1973/)).toBeDefined();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("2) busca envia o termo para a API", async () => {
    const user = userEvent.setup();
    renderWithClient(<ExternalCircuitsCatalog />);
    await screen.findByText("Autódromo José Carlos Pace");
    await user.type(screen.getByLabelText("Buscar circuito"), "Interlagos");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    expect(
      apiMock.get.mock.calls.some((call) =>
        String(call[0]).includes("/api/external/circuits?search=Interlagos"),
      ),
    ).toBe(true);
  });

  it("3) detalhe mostra vencedores, recentes, volta mais rápida e recorde oficial indisponível", async () => {
    const user = userEvent.setup();
    renderWithClient(<ExternalCircuitsCatalog />);
    await user.click(
      await screen.findByRole("button", { name: "Abrir circuito Autódromo José Carlos Pace" }),
    );
    expect(await screen.findByText("Maiores vencedores")).toBeDefined();
    expect(screen.getAllByText("Ayrton Senna").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("2 vitórias")).toBeDefined();
    expect(screen.getByText("Vencedores recentes")).toBeDefined();
    expect(screen.getByText(/2095 · GP São Paulo 2095/)).toBeDefined();
    expect(screen.getByText(/Ayrton Senna · 1:12.345 · 2095/)).toBeDefined();
    expect(screen.getByText(/Recorder oficial de volta/)).toBeDefined();
    expect(screen.getByText(/Foto real licenciada não disponível/)).toBeDefined();
    expect(screen.getByText(/Layout não disponível/)).toBeDefined();
  });

  it("4) estado vazio e erro usam mensagens honestas", async () => {
    apiMock.get.mockImplementation(async () => ({ circuits: [], total: 0 }));
    const { unmount } = renderWithClient(<ExternalCircuitsCatalog />);
    expect(await screen.findByText("Nenhum circuito encontrado no espelho.")).toBeDefined();
    unmount();

    apiMock.get.mockImplementation(async () => {
      throw new ApiError("Serviço indisponível", 500);
    });
    renderWithClient(<ExternalCircuitsCatalog />);
    expect(await screen.findByText(/Não foi possível carregar o catálogo/)).toBeDefined();
  });
});
