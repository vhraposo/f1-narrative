import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SeasonNewsFeed } from "@/components/news/season-news-feed";
import { ApiError } from "@/lib/api";
import type { NewsFeedResult } from "@/lib/news";
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

function feedFixture(overrides: Partial<NewsFeedResult> = {}): NewsFeedResult {
  return {
    news: [
      {
        id: "n1",
        eventId: "e1",
        title: "[RACE] — Alfa vence o GP Alfa",
        body: "Cobertura.",
        source: "GENERATED_EVENT",
        worldDate: "2044-03-08T00:00:00.000Z",
        createdAt: "2044-03-08T01:00:00.000Z",
        context: {
          season: { id: "s1", year: 2044 },
          race: { id: "r1", name: "GP Alfa", round: 1 },
        },
      },
      {
        id: "n2",
        eventId: null,
        title: "[NEWS] — Notícia sem corrida",
        body: null,
        source: "USER_DEFINED",
        worldDate: "2044-03-09T00:00:00.000Z",
        createdAt: "2044-03-09T01:00:00.000Z",
        context: {
          season: { id: "s1", year: 2044 },
          race: null,
        },
      },
    ],
    context: { season: { id: "s1", year: 2044 }, race: null },
    hasMore: false,
    nextOffset: null,
    ...overrides,
  };
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.get.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/news")) {
      return feedFixture();
    }
    throw new ApiError("Não encontrado", 404);
  });
});

describe("SeasonNewsFeed", () => {
  it("mostra notícias com contexto de temporada e corrida e link para o evento", async () => {
    renderWithClient(<SeasonNewsFeed seasonId="s1" />);

    const first = await screen.findByText("[RACE] — Alfa vence o GP Alfa");
    expect(first.closest("a")?.getAttribute("href")).toBe("/app/events/e1");
    expect(screen.getByText("R1 · GP Alfa")).toBeDefined();
    expect(
      screen.getByText("[NEWS] — Notícia sem corrida"),
    ).toBeDefined();
    expect(
      screen.getByText("[NEWS] — Notícia sem corrida").closest("a"),
    ).toBeNull();
    expect(apiMock.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/news?seasonId=s1"),
    );
  });

  it("mostra loading enquanto a consulta está pendente", async () => {
    let resolveFeed: (value: NewsFeedResult) => void = () => undefined;
    apiMock.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFeed = resolve;
        }),
    );

    renderWithClient(<SeasonNewsFeed seasonId="s1" />);

    expect(await screen.findByText("Carregando notícias…")).toBeDefined();
    resolveFeed(feedFixture());
    expect(
      await screen.findByText("[RACE] — Alfa vence o GP Alfa"),
    ).toBeDefined();
  });

  it("mostra erro e permite tentar novamente", async () => {
    apiMock.get
      .mockRejectedValueOnce(new ApiError("Falha ao carregar", 500))
      .mockImplementationOnce(async () => feedFixture());

    renderWithClient(<SeasonNewsFeed seasonId="s1" />);

    expect(
      await screen.findByText(/Não foi possível carregar as notícias/),
    ).toBeDefined();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(
      await screen.findByText("[RACE] — Alfa vence o GP Alfa"),
    ).toBeDefined();
  });

  it("mostra estado vazio quando não há notícias", async () => {
    apiMock.get.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/news")) {
        return feedFixture({ news: [] });
      }
      throw new ApiError("Não encontrado", 404);
    });

    renderWithClient(<SeasonNewsFeed seasonId="s1" />);
    expect(
      await screen.findByText("Sem notícias nesta temporada."),
    ).toBeDefined();
  });

  it("não busca nem lista notícias sem temporada ativa", async () => {
    renderWithClient(<SeasonNewsFeed seasonId={null} />);

    expect(await screen.findByText("Sem temporada ativa.")).toBeDefined();
    expect(
      apiMock.get.mock.calls.some(([path]) =>
        String(path).startsWith("/api/news"),
      ),
    ).toBe(false);
  });

  it("refaz a consulta quando as queries de notícias são invalidadas", async () => {
    const { client } = renderWithClient(<SeasonNewsFeed seasonId="s1" />);
    await screen.findByText("[RACE] — Alfa vence o GP Alfa");
    const callsBefore = apiMock.get.mock.calls.filter(([path]) =>
      String(path).startsWith("/api/news"),
    ).length;

    await client.invalidateQueries({ queryKey: ["news"] });

    await waitFor(() => {
      const callsAfter = apiMock.get.mock.calls.filter(([path]) =>
        String(path).startsWith("/api/news"),
      ).length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });
  });

  it("renderiza cada notícia em um item próprio", async () => {
    renderWithClient(<SeasonNewsFeed seasonId="s1" />);

    await screen.findByText("[RACE] — Alfa vence o GP Alfa");
    const region = screen.getByRole("region", {
      name: "Notícias da temporada",
    });
    const items = within(region).getAllByRole("listitem");
    expect(items).toHaveLength(2);
  });
});
