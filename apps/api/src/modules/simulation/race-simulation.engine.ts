import {
  hashString,
  mulberry32,
} from "./qualifying.engine.js";

export type RaceContender = {
  driverProfileId: string;
  carSpeed: number;
  speed: number;
  consistency: number;
  racecraft: number;
  reliability: number;
  startGrid: number;
};

export type RaceDriverResult = {
  driverProfileId: string;
  carSpeed: number;
  speed: number;
  consistency: number;
  racecraft: number;
  reliability: number;
  startGrid: number;
  pace: number;
  position: number | null;
  status: "Finished" | "Retired";
};

export type RaceIncident = {
  driverProfileId: string;
  type: "RETIREMENT";
};

export type RaceSimulation = {
  results: RaceDriverResult[];
  incidents: RaceIncident[];
};

const CARS_SPEED_WEIGHT = 0.5;
const DRIVER_SPEED_WEIGHT = 0.25;
const RACECRAFT_WEIGHT = 0.25;
const JITTER_FACTOR = 6;
const RETIRE_RELIABILITY_THRESHOLD = 10;

export function racePace(contender: RaceContender): number {
  return (
    CARS_SPEED_WEIGHT * contender.carSpeed +
    DRIVER_SPEED_WEIGHT * contender.speed +
    RACECRAFT_WEIGHT * contender.racecraft
  );
}

export function raceJitter(contender: RaceContender): number {
  return JITTER_FACTOR * (1 - contender.consistency / 100);
}

export function retirementChance(contender: RaceContender): number {
  return (100 - contender.reliability) / 200;
}

export function simulateRace(
  contenders: RaceContender[],
  seed: number,
): RaceSimulation {
  const rng = mulberry32(seed);
  const retireRng = mulberry32(hashString(`${seed}:retire`));

  const scored = contenders.map((contender) => {
    const pace = racePace(contender);
    const jitter = raceJitter(contender);
    const finishPace = Math.max(
      0,
      Math.min(100, pace + (rng() * 2 - 1) * jitter),
    );
    const forcedRetire = contender.reliability <= RETIRE_RELIABILITY_THRESHOLD;
    const retired =
      forcedRetire || retireRng() < retirementChance(contender);
    return { ...contender, pace, finishPace, retired };
  });

  const finishers = scored
    .filter((row) => !row.retired)
    .sort((a, b) => {
      if (b.finishPace !== a.finishPace) return b.finishPace - a.finishPace;
      return a.driverProfileId.localeCompare(b.driverProfileId);
    })
    .map((row, index) => ({
      driverProfileId: row.driverProfileId,
      carSpeed: row.carSpeed,
      speed: row.speed,
      consistency: row.consistency,
      racecraft: row.racecraft,
      reliability: row.reliability,
      startGrid: row.startGrid,
      pace: row.pace,
      position: index + 1,
      status: "Finished" as const,
    }));

  const retired = scored
    .filter((row) => row.retired)
    .sort((a, b) => {
      if (b.finishPace !== a.finishPace) return b.finishPace - a.finishPace;
      return a.driverProfileId.localeCompare(b.driverProfileId);
    })
    .map((row) => ({
      driverProfileId: row.driverProfileId,
      carSpeed: row.carSpeed,
      speed: row.speed,
      consistency: row.consistency,
      racecraft: row.racecraft,
      reliability: row.reliability,
      startGrid: row.startGrid,
      pace: row.pace,
      position: null,
      status: "Retired" as const,
    }));

  const incidents: RaceIncident[] = retired.map((row) => ({
    driverProfileId: row.driverProfileId,
    type: "RETIREMENT" as const,
  }));

  return { results: [...finishers, ...retired], incidents };
}