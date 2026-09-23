import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HomeTiles, type TileCounts } from "./home-tiles";

const FULL_COUNTS: TileCounts = {
  characters: 12,
  drivers: 20,
  teams: 10,
  relationships: 4,
  seasons: 2,
  events: 7,
  conversations: 3,
};

function renderTiles(counts: TileCounts = FULL_COUNTS) {
  return render(<HomeTiles counts={counts} />);
}

describe("HomeTiles", () => {
  it("exibe os 7 tiles do universo incluindo Conversas", () => {
    const { container } = renderTiles();
    const links = [...container.querySelectorAll("a")].map(
      (a) => a.getAttribute("href") ?? "",
    );
    expect(links).toEqual(
      expect.arrayContaining([
        "/app/characters",
        "/app/drivers",
        "/app/teams",
        "/app/relationships",
        "/app/championship",
        "/app/events",
        "/app/conversations",
      ]),
    );
    expect(links).toHaveLength(7);
  });

  it("apresenta o Conversas tile com contagem", () => {
    const { getByText } = renderTiles();
    expect(getByText("Conversas")).toBeTruthy();
    expect(getByText("3 conversas")).toBeTruthy();
  });

  it("pluraliza a contagem de conversas", () => {
    const { getByText } = renderTiles({ ...FULL_COUNTS, conversations: 1 });
    expect(getByText("1 conversa")).toBeTruthy();
  });

  it("mostra estado de carregamento quando a contagem é undefined", () => {
    const { getByText } = renderTiles({ ...FULL_COUNTS, conversations: undefined });
    expect(getByText("carregando…")).toBeTruthy();
  });
});
