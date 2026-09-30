import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TimelineView } from "@/components/timeline/timeline-view";
import { ApiError } from "@/lib/api";
import type {
  TimelineEventDetail,
  TimelineEventEditModel,
  TimelineItem,
} from "@/lib/timeline";
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

function makeItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: "e-corr",
    sequence: 3,
    worldDate: "2087-01-04T00:00:00.000Z",
    kind: "RACE_RESULT_CORRECTED",
    causedBy: "USER",
    supersedesId: "e-old",
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

function makeEdit(
  overrides: Partial<TimelineEventEditModel> = {},
): TimelineEventEditModel {
  return {
    editorKind: "RACE_RESULT",
    canEdit: true,
    blockedReason: null,
    defaultWorldDate: "2087-06-01T00:00:00.000Z",
    suggestedSupersedesId: "e-corr",
    values: { position: 1 },
    currentValues: { position: 1, grid: 1, status: "Finished" },
    narrativeStaleEventIds: [],
    ...overrides,
  };
}

function makeDetail(edit: TimelineEventEditModel): TimelineEventDetail {
  return {
    item: makeItem(),
    supersedesChain: [makeItem({ id: "e-old", sequence: 2, isSuperseded: true })],
    supersededByChain: [],
    edit,
  };
}

const DRIVERS = [
  {
    id: "d1",
    character: { id: "c1", name: "Piloto Um" },
  },
  {
    id: "d2",
    character: { id: "c2", name: "Piloto Dois" },
  },
];

const DIVERGENCE = {
  season: { id: "s1", year: 2087, name: "2087" },
  summary: { match: 1, divergent: 0, noExternal: 0, universeOnly: 0, externalOnly: 0 },
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
  ],
  results: [],
  standings: [],
};

function listResponse() {
  return {
    events: [makeItem()],
    nextCursor: null,
    hasMore: false,
    beyondScanLimit: false,
  };
}

function mockRoutes(detail: TimelineEventDetail) {
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
    if (path === "/api/drivers") return { drivers: DRIVERS };
    if (path === "/api/teams") return { teams: [] };
    if (path === "/api/seasons/s1/races") return { races: [] };
    if (path.startsWith("/api/timeline/events/")) return detail;
    if (path.startsWith("/api/timeline/divergence")) {
      return { divergence: DIVERGENCE };
    }
    if (path.startsWith("/api/timeline")) return listResponse();
    throw new ApiError("Não encontrado", 404);
  });
}

async function openDetail(user: ReturnType<typeof userEvent.setup>) {
  renderWithClient(<TimelineView />);
  await user.click(
    await screen.findByRole("button", {
      name: /Resultado corrigido em GP Sintético 1: Piloto Um/,
    }),
  );
  return await screen.findByRole("region", { name: "Detalhe do evento" });
}

function previewResponse(overrides: Record<string, unknown> = {}) {
  return {
    preview: {
      previewToken: "tok-1",
      kind: "RACE_RESULT_CORRECTED",
      changes: [
        {
          area: "RESULT",
          label: "GP Sintético 1",
          field: "position",
          before: 1,
          after: 2,
        },
      ],
      championBefore: null,
      championAfter: null,
      narrativeStaleEventIds: [],
      numberImpact: null,
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRoutes(makeDetail(makeEdit()));
  apiMock.post.mockImplementation(async () => undefined);
  apiMock.patch.mockImplementation(async () => undefined);
  apiMock.put.mockImplementation(async () => undefined);
  apiMock.remove.mockImplementation(async () => undefined);
});

describe("TimelineEventPanel editor", () => {
  it("1) mostra abas, estado atual e formulário por kind", async () => {
    const user = userEvent.setup();
    const detail = await openDetail(user);

    expect(within(detail).getByRole("tab", { name: "Detalhes" })).toBeDefined();
    expect(within(detail).getByRole("tab", { name: "Impacto" })).toBeDefined();
    expect(within(detail).getByRole("tab", { name: "Histórico" })).toBeDefined();
    expect(within(detail).getByText("Estado atual")).toBeDefined();
    expect(within(detail).getByText(/position:/)).toBeDefined();

    await user.click(within(detail).getByRole("button", { name: "Editar" }));
    expect(within(detail).getByText("Editar: Resultado de corrida")).toBeDefined();
    expect(within(detail).getByLabelText("Posição")).toHaveProperty("value", "1");
    expect(within(detail).getByLabelText("Grid")).toHaveProperty("value", "1");
    expect(within(detail).getByLabelText("Status")).toHaveProperty(
      "value",
      "Finished",
    );
  });

  it("2) pré-visualiza com ANTES/DEPOIS e IMPACTOS, confirma e aplica", async () => {
    const user = userEvent.setup();
    apiMock.post.mockImplementation(async (path: string) => {
      if (path === "/api/timeline/corrections/preview") {
        return previewResponse({
          championBefore: "d1",
          championAfter: "d2",
          narrativeStaleEventIds: ["x1", "x2"],
          numberImpact: {
            seasonId: "s1",
            year: 2087,
            currentHolderId: "d1",
            expectedChampionId: "d2",
            requiresAction: true,
          },
        });
      }
      if (path === "/api/timeline/corrections/apply") {
        return {
          event: {
            id: "e-new",
            sequence: 4,
            kind: "RACE_RESULT_CORRECTED",
            supersedesId: "e-corr",
          },
        };
      }
      return undefined;
    });

    const detail = await openDetail(user);
    await user.click(within(detail).getByRole("button", { name: "Editar" }));

    const position = within(detail).getByLabelText("Posição");
    await user.clear(position);
    await user.type(position, "2");
    await user.click(
      within(detail).getByRole("button", { name: "Pré-visualizar correção" }),
    );

    await waitFor(() => {
      expect(apiMock.post).toHaveBeenCalledWith(
        "/api/timeline/corrections/preview",
        expect.objectContaining({
          kind: "RACE_RESULT_CORRECTED",
          worldDate: "2087-06-01T00:00:00.000Z",
          raceId: "r1",
          driverProfileId: "d1",
          position: 2,
          supersedesId: "e-corr",
        }),
      );
    });

    expect(within(detail).getByText("Pré-visualização da correção")).toBeDefined();
    expect(within(detail).getByText("Antes / Depois")).toBeDefined();
    expect(
      within(detail).getByText(
        (_content, element) =>
          element?.tagName === "P" &&
          element.textContent === "GP Sintético 1 · position: 1 → 2",
      ),
    ).toBeDefined();
    expect(within(detail).getByText(/Piloto Um → Piloto Dois/)).toBeDefined();
    expect(
      within(detail).getByText(/reatribuição manual necessária/),
    ).toBeDefined();
    expect(
      within(detail).getByText(/pode ficar desatualizada \(2 registro\(s\)\)/),
    ).toBeDefined();

    await user.click(
      within(detail).getByRole("button", { name: "Aplicar correção" }),
    );
    expect(within(detail).getByText("Aplicar correção histórica?")).toBeDefined();
    await user.click(
      within(detail).getByRole("button", { name: "Aplicar correção" }),
    );

    await waitFor(() => {
      expect(apiMock.post).toHaveBeenCalledWith(
        "/api/timeline/corrections/apply",
        expect.objectContaining({
          previewToken: "tok-1",
          command: expect.objectContaining({
            kind: "RACE_RESULT_CORRECTED",
            position: 2,
          }),
        }),
      );
    });
    expect(
      await within(detail).findByText(
        "Correção aplicada. O evento anterior foi preservado no histórico.",
      ),
    ).toBeDefined();
    await waitFor(() => {
      const detailCalls = apiMock.get.mock.calls.filter(
        (call) => call[0] === "/api/timeline/events/e-corr",
      );
      expect(detailCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("3) PREVIEW_STALE no apply exige nova pré-visualização", async () => {
    const user = userEvent.setup();
    let previewCalls = 0;
    apiMock.post.mockImplementation(async (path: string, body: unknown) => {
      if (path === "/api/timeline/corrections/preview") {
        previewCalls += 1;
        return previewResponse({
          previewToken: previewCalls === 1 ? "tok-1" : "tok-2",
        });
      }
      if (path === "/api/timeline/corrections/apply") {
        const token = (body as { previewToken: string }).previewToken;
        if (token === "tok-1") {
          throw new ApiError("Pré-visualização expirada", 409, "PREVIEW_STALE");
        }
        return {
          event: {
            id: "e-new",
            sequence: 4,
            kind: "RACE_RESULT_CORRECTED",
            supersedesId: "e-corr",
          },
        };
      }
      return undefined;
    });

    const detail = await openDetail(user);
    await user.click(within(detail).getByRole("button", { name: "Editar" }));
    await user.click(
      within(detail).getByRole("button", { name: "Pré-visualizar correção" }),
    );
    await within(detail).findByText("Pré-visualização da correção");

    await user.click(
      within(detail).getByRole("button", { name: "Aplicar correção" }),
    );
    await user.click(
      within(detail).getByRole("button", { name: "Aplicar correção" }),
    );

    expect(
      await within(detail).findByText(/Gere uma nova pré-visualização antes de aplicar/),
    ).toBeDefined();
    await user.click(
      within(detail).getByRole("button", { name: "Gerar nova pré-visualização" }),
    );
    await within(detail).findByText("Pré-visualização da correção");
    expect(previewCalls).toBe(2);

    await user.click(
      within(detail).getByRole("button", { name: "Aplicar correção" }),
    );
    await user.click(
      within(detail).getByRole("button", { name: "Aplicar correção" }),
    );

    await waitFor(() => {
      const applyCalls = apiMock.post.mock.calls.filter(
        (call) => call[0] === "/api/timeline/corrections/apply",
      );
      expect(
        applyCalls.map((call) => (call[1] as { previewToken: string }).previewToken),
      ).toEqual(["tok-1", "tok-2"]);
    });
  });

  it("4) kind bloqueado desabilita o botão e explica o motivo", async () => {
    const user = userEvent.setup();
    mockRoutes(
      makeDetail(
        makeEdit({
          editorKind: "STANDING",
          canEdit: false,
          blockedReason: "DERIVED_STANDING",
          suggestedSupersedesId: null,
        }),
      ),
    );

    const detail = await openDetail(user);
    const editButton = within(detail).getByRole("button", { name: "Editar" });
    expect(editButton).toHaveProperty("disabled", true);
    expect(
      within(detail).getByText(/a classificação é derivada/),
    ).toBeDefined();
  });

  it("5) número vazio vira null no comando", async () => {
    const user = userEvent.setup();
    mockRoutes(
      makeDetail(
        makeEdit({
          editorKind: "NUMBER",
          currentValues: { number: 44 },
          values: { number: 44 },
          suggestedSupersedesId: "e-corr",
        }),
      ),
    );

    const detail = await openDetail(user);
    await user.click(within(detail).getByRole("button", { name: "Editar" }));
    const number = within(detail).getByLabelText("Número");
    await user.clear(number);
    await user.click(
      within(detail).getByRole("button", { name: "Pré-visualizar correção" }),
    );

    await waitFor(() => {
      expect(apiMock.post).toHaveBeenCalledWith(
        "/api/timeline/corrections/preview",
        expect.objectContaining({
          kind: "NUMBER_CORRECTED",
          seasonId: "s1",
          driverProfileId: "d1",
          number: null,
          supersedesId: "e-corr",
        }),
      );
    });
  });

  it("6) sprint envia elegibilidade com neutralizedStart e distancePct", async () => {
    const user = userEvent.setup();
    mockRoutes(
      makeDetail(
        makeEdit({
          editorKind: "SPRINT",
          currentValues: {
            position: 3,
            status: "Finished",
            neutralizedStart: 1,
            distancePct: 67,
          },
        }),
      ),
    );

    const detail = await openDetail(user);
    await user.click(within(detail).getByRole("button", { name: "Editar" }));
    const start = within(detail).getByLabelText("Largada neutralizada");
    expect(start).toHaveProperty("checked", true);
    const distance = within(detail).getByLabelText("Distância percorrida (%)");
    await user.clear(distance);
    await user.type(distance, "50");
    await user.click(
      within(detail).getByRole("button", { name: "Pré-visualizar correção" }),
    );

    await waitFor(() => {
      expect(apiMock.post).toHaveBeenCalledWith(
        "/api/timeline/corrections/preview",
        expect.objectContaining({
          kind: "RACE_SESSION_RESULT_CORRECTED",
          raceId: "r1",
          driverProfileId: "d1",
          eligibility: { neutralizedStart: true, distancePct: 50 },
        }),
      );
    });
  });
});
