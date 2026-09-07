import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChampionshipContext } from "@/components/championship/championship-context";
import type { Season } from "@/lib/championship";

function makeSeason(overrides: Partial<Season> = {}): Season {
  return {
    id: "s1",
    year: 2026,
    name: null,
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ChampionshipContext", () => {
  it("mostra rodada, ano, corrida, circuito e sessão atual", () => {
    render(
      <ChampionshipContext
        season={makeSeason()}
        race={{
          name: "GP de Interlagos",
          round: 14,
          circuit: "Autódromo de Interlagos",
          country: "Brasil",
          date: "2026-09-05T12:00:00.000Z",
        }}
        session="RACE"
        isCurrentSeason
      />,
    );

    expect(screen.getByText("R14")).toBeDefined();
    expect(screen.getByText("2026")).toBeDefined();
    expect(screen.getByText("Rodada atual")).toBeDefined();
    expect(
      screen.getByRole("heading", { name: "GP de Interlagos" }),
    ).toBeDefined();
    expect(
      screen.getByText("Autódromo de Interlagos — Brasil"),
    ).toBeDefined();
    expect(screen.getByText("Sessão atual")).toBeDefined();
    expect(screen.getByText("Corrida")).toBeDefined();
  });

  it("sem corrida atual usa o nome da temporada e não inventa rodada", () => {
    render(
      <ChampionshipContext
        season={makeSeason({ name: "Sexta temporada" })}
        race={null}
        session={null}
        isCurrentSeason={false}
      />,
    );

    expect(screen.getByText("2026")).toBeDefined();
    expect(
      screen.getByRole("heading", { name: "Sexta temporada" }),
    ).toBeDefined();
    expect(screen.queryByText(/^R\d+$/)).toBeNull();
    expect(screen.queryByText("Rodada atual")).toBeNull();
    expect(screen.queryByText("Sessão atual")).toBeNull();
  });

  it("sem rodada define a sessão quando está disponível", () => {
    render(
      <ChampionshipContext
        season={makeSeason()}
        race={{
          name: "GP do Bahrein",
          round: null,
          circuit: null,
          country: "Bahrein",
          date: null,
        }}
        session="QUALIFYING"
        isCurrentSeason
      />,
    );

    expect(screen.getByText("Rodada atual")).toBeDefined();
    expect(screen.getByText("Bahrein")).toBeDefined();
    expect(screen.getByText("Classificação")).toBeDefined();
    expect(screen.queryByText(/^R\d+$/)).toBeNull();
  });
});
