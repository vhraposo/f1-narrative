import { describe, expect, it } from "vitest";
import type { JolpicaCircuitRaw, JolpicaRaceRaw } from "./jolpica.client.js";
import {
  normalizeCircuits,
  normalizeCircuitsFromRaces,
  normalizeCountry,
  normalizeRaces,
} from "./jolpica.normalizer.js";

describe("normalizeCircuits", () => {
  it("mapeia circuito completo com coordenadas e país normalizado", () => {
    const circuits: JolpicaCircuitRaw[] = [
      {
        circuitId: "interlagos",
        url: "https://en.wikipedia.org/wiki/Interlagos",
        circuitName: "Autódromo José Carlos Pace",
        Location: {
          lat: "-23.7036",
          long: "-46.6997",
          locality: "São Paulo",
          country: "Brazil",
        },
      },
    ];
    const items = normalizeCircuits(circuits);
    expect(items).toHaveLength(1);
    expect(items[0].data).toEqual({
      externalId: "interlagos",
      name: "Autódromo José Carlos Pace",
      url: "https://en.wikipedia.org/wiki/Interlagos",
      locality: "São Paulo",
      country: "Brazil",
      latitude: -23.7036,
      longitude: -46.6997,
    });
  });

  it("normaliza alias de país e ignora coordenadas inválidas sem inventar", () => {
    const items = normalizeCircuits([
      {
        circuitId: "silverstone",
        circuitName: "Silverstone Circuit",
        Location: {
          lat: "999",
          long: "abc",
          locality: "  Silverstone   Circuit ",
          country: "UK",
        },
      },
    ]);
    expect(items[0].data.country).toBe("United Kingdom");
    expect(items[0].data.locality).toBe("Silverstone Circuit");
    expect(items[0].data.latitude).toBeNull();
    expect(items[0].data.longitude).toBeNull();
  });

  it("descarta circuito sem id ou sem nome (payload incompleto)", () => {
    const items = normalizeCircuits([
      { circuitId: "sem_nome" },
      { circuitName: "Sem Id" },
      { circuitId: "ok", circuitName: "Completo" },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].data.externalId).toBe("ok");
  });
});

describe("normalizeCircuitsFromRaces", () => {
  it("deduplica circuitos repetidos entre corridas", () => {
    const races: JolpicaRaceRaw[] = [
      {
        round: "1",
        Circuit: { circuitId: "interlagos", circuitName: "Interlagos" },
      },
      {
        round: "2",
        Circuit: { circuitId: "interlagos", circuitName: "Interlagos" },
      },
      { round: "3", Circuit: { circuitName: "Sem Id" } },
    ];
    const items = normalizeCircuitsFromRaces(races);
    expect(items).toHaveLength(1);
    expect(items[0].data.externalId).toBe("interlagos");
  });
});

describe("normalizeCountry", () => {
  it("aplica aliases conhecidos e preserva demais valores", () => {
    expect(normalizeCountry("USA")).toBe("United States");
    expect(normalizeCountry("uae")).toBe("United Arab Emirates");
    expect(normalizeCountry("  Italy ")).toBe("Italy");
    expect(normalizeCountry("")).toBeNull();
    expect(normalizeCountry(null)).toBeNull();
  });
});

describe("normalizeRaces (campos externos ampliados)", () => {
  it("preserva país, localidade, horário e url sem perder consistência", () => {
    const races: JolpicaRaceRaw[] = [
      {
        season: "2026",
        round: "1",
        url: "https://en.wikipedia.org/wiki/2026_São_Paulo_Grand_Prix",
        raceName: "São Paulo Grand Prix",
        Circuit: {
          circuitId: "interlagos",
          circuitName: "Autódromo José Carlos Pace",
          Location: {
            lat: "-23.7036",
            long: "-46.6997",
            locality: "São Paulo",
            country: "Brazil",
          },
        },
        date: "2026-03-15",
        time: "15:00:00Z",
      },
    ];
    const items = normalizeRaces(races, 2026);
    expect(items[0].data).toEqual({
      seasonYear: 2026,
      round: 1,
      grandPrix: "São Paulo Grand Prix",
      name: "São Paulo Grand Prix",
      officialName: null,
      circuitName: "Autódromo José Carlos Pace",
      circuitExternalId: "interlagos",
      locality: "São Paulo",
      country: "Brazil",
      latitude: -23.7036,
      longitude: -46.6997,
      date: new Date("2026-03-15T00:00:00.000Z"),
      time: "15:00:00Z",
      url: "https://en.wikipedia.org/wiki/2026_São_Paulo_Grand_Prix",
      status: null,
    });
  });

  it("não bloqueia o lote por causa de corrida sem round", () => {
    const items = normalizeRaces(
      [
        { round: undefined, raceName: "Inválida" },
        { round: "2", raceName: "Válida" },
      ],
      2026,
    );
    expect(items).toHaveLength(1);
    expect(items[0].data.round).toBe(2);
  });
});
