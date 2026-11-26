import { describe, expect, it } from "vitest";

import {
  buildTrackProfileDataset,
  type BuildCircuit,
  type BuildRace,
  type BuildResult,
} from "./track-profile.build.js";
import {
  assertTrackProfileInvariants,
  validateTrackProfileDataset,
  type TrackProfileDataset,
  type TrackWeatherMonth,
} from "./track-profile.js";
import { loadTrackProfileDataset } from "./track-profile.read.js";

function months(): TrackWeatherMonth[] {
  return Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    rainDayProbability: 0.1 + index * 0.01,
    avgTempC: 20,
    avgWindKmh: 10,
    sampleDays: 300,
  }));
}

function circuit(id: string, name: string, type = "RACE_TRACK"): BuildCircuit {
  return {
    id,
    name,
    fullName: `${name} Full`,
    countryId: id === "monza" ? "italy" : "monaco",
    type,
    direction: "CLOCKWISE",
    placeName: id,
    latitude: 45.6,
    longitude: 9.2,
    lengthKm: 5.8,
    turns: 11,
  };
}

function race(input: {
  id: string;
  year: number;
  round: number;
  circuitId: string;
  layout: string;
  date: string;
}): BuildRace {
  return {
    id: input.id,
    year: input.year,
    round: input.round,
    officialName: `GP ${input.circuitId} ${input.year}`,
    circuitId: input.circuitId,
    circuitLayoutId: input.layout,
    laps: 53,
    turns: 11,
    courseLengthKm: 5.8,
    date: input.date,
  };
}

function result(input: Partial<BuildResult> & { raceId: string }): BuildResult {
  return {
    raceId: input.raceId,
    positionNumber: input.positionNumber === undefined ? 1 : input.positionNumber,
    positionText: input.positionText ?? "1",
    gridPositionNumber: input.gridPositionNumber === undefined ? 1 : input.gridPositionNumber,
    reasonRetired: input.reasonRetired ?? "",
    positionsGained: input.positionsGained === undefined ? 0 : input.positionsGained,
    pitStops: input.pitStops === undefined ? 1 : input.pitStops,
  };
}

function fixture(): TrackProfileDataset {
  return buildTrackProfileDataset({
    targetYear: 2026,
    generatedAt: "2026-10-01T00:00:00.000Z",
    sourceVersion: "test",
    circuits: [circuit("monza", "Monza"), circuit("monaco", "Monaco", "STREET")],
    races: [
      race({ id: "r26a", year: 2026, round: 1, circuitId: "monza", layout: "l1", date: "2026-09-06" }),
      race({ id: "r26b", year: 2026, round: 2, circuitId: "monaco", layout: "l2", date: "2026-06-07" }),
      race({ id: "r25a", year: 2025, round: 1, circuitId: "monza", layout: "l1", date: "2025-09-07" }),
      race({ id: "r25b", year: 2025, round: 2, circuitId: "monaco", layout: "l2", date: "2025-06-08" }),
    ],
    results: [
      result({ raceId: "r25a", gridPositionNumber: 1, positionsGained: 0, pitStops: 2 }),
      result({ raceId: "r25a", gridPositionNumber: 4, positionsGained: 2, pitStops: 2 }),
      result({
        raceId: "r25a",
        positionNumber: null,
        positionText: "R",
        gridPositionNumber: 3,
        reasonRetired: "Engine",
        positionsGained: null,
        pitStops: 1,
      }),
      result({ raceId: "r25a", gridPositionNumber: 10, positionsGained: 0, pitStops: 1 }),
      result({ raceId: "r25b", gridPositionNumber: 10, positionsGained: 4, pitStops: 2 }),
      result({ raceId: "r25b", gridPositionNumber: 8, positionsGained: 5, pitStops: 1 }),
      result({ raceId: "r25b", gridPositionNumber: 6, positionsGained: 2, pitStops: 2 }),
    ],
    weather: [
      { circuitId: "monza", months: months(), source: "open-meteo" },
      { circuitId: "monaco", months: months(), source: "open-meteo" },
    ],
  });
}

describe("V5.1 — track profiles", () => {
  it("gera perfis validados a partir de dados reais de entrada", () => {
    const dataset = validateTrackProfileDataset(fixture());
    assertTrackProfileInvariants(dataset);
    expect(dataset.circuits).toHaveLength(2);
    const monza = dataset.circuits.find((entry) => entry.circuitId === "monza");
    expect(monza?.derived.sampleStarts).toBe(4);
    expect(monza?.derived.dnfRate).toBe(0.25);
    expect(monza?.derived.avgPositionsGained).toBe(0.67);
    expect(monza?.derived.pitStopsPerRace).toBe(1.5);
    expect(monza?.eventMonth).toBe(9);
    expect(monza?.weather?.eventMonthRainProbability).toBe(0.18);
    expect(monza?.derived.overtakingDifficulty).toBeGreaterThanOrEqual(1);
    expect(monza?.derived.overtakingDifficulty).toBeLessThanOrEqual(10);
    expect(monza?.unavailable).toContain("pitLossSeconds");
    expect(monza?.sources.some((source) => source.license === "CC BY 4.0")).toBe(true);
  });

  it("dificuldade de ultrapassagem é relativa entre circuitos", () => {
    const dataset = fixture();
    const monza = dataset.circuits.find((entry) => entry.circuitId === "monza");
    const monaco = dataset.circuits.find((entry) => entry.circuitId === "monaco");
    expect(monaco?.derived.avgPositionsGained).toBeGreaterThan(
      monza?.derived.avgPositionsGained ?? 0,
    );
    expect(monaco?.derived.overtakingDifficulty).toBeLessThan(
      monza?.derived.overtakingDifficulty ?? 0,
    );
  });

  it("rejeita duplicata e evento sem clima", () => {
    const dataset = validateTrackProfileDataset(fixture());
    expect(() =>
      assertTrackProfileInvariants({
        ...dataset,
        circuits: [dataset.circuits[0]!, dataset.circuits[0]!],
      }),
    ).toThrow(/duplicado/);
    expect(() =>
      assertTrackProfileInvariants({
        ...dataset,
        circuits: [{ ...dataset.circuits[0]!, weather: null }],
      }),
    ).toThrow(/clima ausente/);
  });

  it("dataset real cobre o calendário com proveniência", () => {
    const dataset = loadTrackProfileDataset();
    expect(dataset.circuits.length).toBeGreaterThanOrEqual(20);
    for (const circuit of dataset.circuits) {
      expect(circuit.sources.length).toBeGreaterThan(0);
      expect(circuit.sources.every((source) => source.license.length > 0)).toBe(true);
      expect(circuit.weather?.months).toHaveLength(12);
      if (circuit.derived.sampleStarts >= 20) {
        expect(circuit.derived.overtakingDifficulty).not.toBeNull();
      }
    }
    const newCircuits = dataset.circuits.filter((circuit) => circuit.derived.sampleStarts === 0);
    for (const circuit of newCircuits) {
      expect(circuit.derived.overtakingDifficulty).toBeNull();
      expect(circuit.derived.dnfRate).toBeNull();
    }
  });
});
