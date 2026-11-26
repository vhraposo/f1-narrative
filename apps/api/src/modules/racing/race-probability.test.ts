import { describe, expect, it } from "vitest";
import {
  DRIVER_ATTRIBUTE_KEYS,
  createDriverDevelopmentProfile,
  type DriverAttributes,
  type DriverDevelopmentProfile,
} from "./driver-development.js";
import {
  TEAM_DIMENSION_KEYS,
  createTeamDevelopmentProfile,
  type TeamDevelopmentProfile,
  type TeamDimensions,
} from "./team-development.js";
import type { TrackProfile } from "./track-profile.js";
import { simulateRaceProbabilities, type ProbabilityDriver } from "./race-probability.js";

function attributes(overrides: Partial<DriverAttributes>, fallback = 75): DriverAttributes {
  const result = {} as DriverAttributes;
  for (const key of DRIVER_ATTRIBUTE_KEYS) result[key] = overrides[key] ?? fallback;
  return result;
}

function driver(overrides: Partial<DriverAttributes> = {}): DriverDevelopmentProfile {
  return createDriverDevelopmentProfile({
    attributes: attributes(overrides),
    potential: attributes({}, 100),
    age: 27,
    experienceYears: 7,
    confidence: 80,
    morale: 80,
  });
}

function team(level = 75, reliability = 75): TeamDevelopmentProfile {
  const dimensions = {} as TeamDimensions;
  const potential = {} as TeamDimensions;
  for (const key of TEAM_DIMENSION_KEYS) {
    dimensions[key] = key === "reliability" ? reliability : level;
    potential[key] = 100;
  }
  return createTeamDevelopmentProfile({ dimensions, potential });
}

function track(overrides: { difficulty?: number | null; dnfRate?: number | null; type?: string; rain?: number } = {}): TrackProfile {
  const rain = overrides.rain;
  return {
    circuitId: "fixture",
    name: "Fixture",
    officialName: "Fixture Grand Prix",
    country: "Fixtureland",
    city: null,
    type: overrides.type ?? "road",
    direction: "clockwise",
    latitude: 0,
    longitude: 0,
    lengthKm: 5,
    laps: 50,
    turns: 15,
    layoutId: null,
    eventMonth: 6,
    firstRaceYear: 2000,
    racesHeld: 20,
    derived: {
      dnfRate: overrides.dnfRate ?? 0.1,
      avgPositionsGained: 1,
      pitStopsPerRace: 2,
      overtakingDifficulty: overrides.difficulty ?? 5,
      sampleStarts: 20,
      confidence: 0.9,
    },
    weather:
      rain === undefined
        ? null
        : {
            eventMonthRainProbability: rain,
            months: Array.from({ length: 12 }, (_, index) => ({
              month: index + 1,
              rainDayProbability: rain,
              avgTempC: 20,
              avgWindKmh: 10,
              sampleDays: 300,
            })),
          },
    unavailable: [],
    sources: [{ name: "fixture", url: null, license: "CC0", note: "fixture" }],
    confidence: 0.9,
  };
}

function entry(id: string, level = 75, reliability = 75): ProbabilityDriver {
  return { id, teamId: `team-${id}`, driver: driver({}), team: team(level, reliability) };
}

describe("race probability", () => {
  it("produces normalized exclusive probabilities", () => {
    const drivers = Array.from({ length: 12 }, (_, index) => entry(`d${index}`, 60 + index * 2));
    const result = simulateRaceProbabilities({ track: track({ dnfRate: 0 }), drivers, seed: "normalize", iterations: 2500 });
    const winSum = result.drivers.reduce((sum, item) => sum + item.win, 0);
    const podiumSum = result.drivers.reduce((sum, item) => sum + item.podium, 0);
    expect(winSum).toBeCloseTo(1, 6);
    expect(podiumSum).toBeCloseTo(3, 6);
    expect(result.grid).toHaveLength(12);
    for (const item of result.drivers) {
      expect(item.win).toBeGreaterThanOrEqual(0);
      expect(item.win).toBeLessThanOrEqual(1);
      expect(item.dnf).toBeGreaterThanOrEqual(0);
      expect(item.positionDistribution).toHaveLength(13);
      expect(item.expectedPosition).toBeGreaterThanOrEqual(1);
      expect(item.expectedPosition).toBeLessThanOrEqual(12);
    }
  });

  it("is deterministic for the same seed", () => {
    const drivers = [entry("a"), entry("b"), entry("c"), entry("d")];
    const options = { track: track(), drivers, seed: "repeat", iterations: 700 };
    expect(simulateRaceProbabilities(options)).toEqual(simulateRaceProbabilities(options));
  });

  it("favors stronger drivers", () => {
    const fast = entry("fast", 95);
    const slow = entry("slow", 50);
    const result = simulateRaceProbabilities({
      track: track(),
      drivers: [fast, slow, entry("mid", 70)],
      seed: "strength",
      iterations: 2000,
    });
    const byId = new Map(result.drivers.map((item) => [item.id, item]));
    expect(byId.get("fast")!.win).toBeGreaterThan(byId.get("slow")!.win);
    expect(byId.get("fast")!.expectedPosition).toBeLessThan(byId.get("slow")!.expectedPosition);
  });

  it("rewards wet specialists only in the rain", () => {
    const dryAce: ProbabilityDriver = {
      id: "dry",
      teamId: "same",
      driver: driver({ qualifyingPace: 95, racePace: 95, wetWeather: 40 }),
      team: team(80),
    };
    const wetAce: ProbabilityDriver = {
      id: "wet",
      teamId: "same",
      driver: driver({ qualifyingPace: 80, racePace: 80, wetWeather: 99, adaptability: 90 }),
      team: team(80),
    };
    const dry = simulateRaceProbabilities({ track: track({ rain: 0 }), drivers: [dryAce, wetAce], seed: "weather", iterations: 2500 });
    const wet = simulateRaceProbabilities({ track: track({ rain: 1 }), drivers: [dryAce, wetAce], seed: "weather", iterations: 2500 });
    const dryById = new Map(dry.drivers.map((item) => [item.id, item]));
    const wetById = new Map(wet.drivers.map((item) => [item.id, item]));
    expect(dryById.get("dry")!.win).toBeGreaterThan(dryById.get("wet")!.win);
    expect(wetById.get("wet")!.win).toBeGreaterThan(wetById.get("dry")!.win);
  });

  it("samples rain from the circuit climatology", () => {
    const result = simulateRaceProbabilities({
      track: track({ rain: 0.6 }),
      drivers: [entry("a"), entry("b"), entry("c")],
      seed: "rain-sample",
      iterations: 4000,
    });
    expect(result.wetProbability).toBeGreaterThan(0.54);
    expect(result.wetProbability).toBeLessThan(0.66);
  });

  it("keeps the home advantage small", () => {
    const home = entry("home");
    const rival = entry("rival");
    const homeRace = simulateRaceProbabilities({
      track: track(),
      drivers: [home, rival],
      seed: "home",
      iterations: 3000,
      homeDriverId: "home",
    });
    const rivalRace = simulateRaceProbabilities({
      track: track(),
      drivers: [home, rival],
      seed: "home",
      iterations: 3000,
      homeDriverId: "rival",
    });
    const homeWin = homeRace.drivers.find((item) => item.id === "home")!.win;
    const homeWinWithoutBonus = rivalRace.drivers.find((item) => item.id === "home")!.win;
    const rivalWin = rivalRace.drivers.find((item) => item.id === "rival")!.win;
    expect(homeWin).toBeGreaterThan(homeWinWithoutBonus);
    expect(homeWin / Math.max(0.0001, rivalWin)).toBeLessThan(2);
  });

  it("raises retirement odds for unreliable teams", () => {
    const fragile = entry("fragile", 75, 30);
    const solid = entry("solid", 75, 95);
    const result = simulateRaceProbabilities({
      track: track({ dnfRate: 0.2 }),
      drivers: [fragile, solid],
      seed: "reliability",
      iterations: 2500,
    });
    const byId = new Map(result.drivers.map((item) => [item.id, item]));
    expect(byId.get("fragile")!.dnf).toBeGreaterThan(byId.get("solid")!.dnf);
  });

  it("makes grid position matter more on hard-overtaking circuits", () => {
    const qualifier: ProbabilityDriver = {
      id: "qualifier",
      teamId: "qa",
      driver: driver({ qualifyingPace: 99, racePace: 60 }),
      team: team(75),
    };
    const racer: ProbabilityDriver = {
      id: "racer",
      teamId: "ra",
      driver: driver({ qualifyingPace: 60, racePace: 99 }),
      team: team(75),
    };
    const easy = simulateRaceProbabilities({
      track: track({ difficulty: 1 }),
      drivers: [qualifier, racer],
      seed: "grid-effect",
      iterations: 4000,
    });
    const hard = simulateRaceProbabilities({
      track: track({ difficulty: 10 }),
      drivers: [qualifier, racer],
      seed: "grid-effect",
      iterations: 4000,
    });
    const easyQualifier = easy.drivers.find((item) => item.id === "qualifier")!.win;
    const hardQualifier = hard.drivers.find((item) => item.id === "qualifier")!.win;
    expect(hardQualifier).toBeGreaterThan(easyQualifier);
  });
});
