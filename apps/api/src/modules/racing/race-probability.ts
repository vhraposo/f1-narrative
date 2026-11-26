import type { DriverDevelopmentProfile } from "./driver-development.js";
import { effectiveAttributes } from "./driver-development.js";
import type { TeamDevelopmentProfile } from "./team-development.js";
import type { TrackProfile } from "./track-profile.js";

export type ProbabilityDriver = {
  id: string;
  name?: string;
  teamId: string;
  driver: DriverDevelopmentProfile;
  team: TeamDevelopmentProfile;
};

export type RaceProbabilityOptions = {
  track: TrackProfile;
  drivers: readonly ProbabilityDriver[];
  seed: string | number;
  iterations?: number;
  wet?: boolean | null;
  homeDriverId?: string | null;
};

export type DriverRaceProbability = {
  id: string;
  teamId: string;
  win: number;
  podium: number;
  points: number;
  top10: number;
  dnf: number;
  expectedPosition: number;
  positionDistribution: number[];
  strength: number;
};

export type RaceProbabilityResult = {
  iterations: number;
  wetProbability: number;
  grid: string[];
  drivers: DriverRaceProbability[];
};

export function hashSeed(seed: string | number): number {
  const text = String(seed);
  let hash = 1779033703 ^ text.length;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return hash >>> 0;
}

export function createSeededRandom(seed: string | number): () => number {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number): number {
  const first = Math.max(Number.EPSILON, 1 - random());
  const second = random();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isStreet(track: TrackProfile): boolean {
  return /street|rua|urbano/i.test(track.type);
}

function driverRaceScore(profile: DriverDevelopmentProfile, track: TrackProfile, wet: boolean, home: boolean): number {
  const attributes = effectiveAttributes(profile);
  const difficulty = track.derived.overtakingDifficulty ?? 5;
  const street = isStreet(track);
  let score: number;
  if (wet) {
    score =
      0.3 * attributes.wetWeather +
      0.2 * attributes.adaptability +
      0.2 * attributes.racePace +
      0.12 * attributes.consistency +
      0.1 * attributes.racecraft +
      0.08 * attributes.composure;
  } else {
    score =
      0.45 * attributes.racePace +
      0.22 * attributes.qualifyingPace +
      0.12 * attributes.consistency +
      0.08 * attributes.starts +
      0.08 * attributes.racecraft +
      0.05 * attributes.adaptability;
  }
  if (street) {
    score = score * 0.92 + attributes.composure * 0.05 + attributes.consistency * 0.03;
  }
  score += (difficulty - 5) * 0.002 * attributes.racecraft;
  score = score * (0.94 + 0.06 * ((profile.morale + profile.confidence) / 200));
  if (home) score += 1.2;
  return clamp(score / 100, 0, 1);
}

function driverQualifyingScore(profile: DriverDevelopmentProfile, team: TeamDevelopmentProfile, wet: boolean): number {
  const attributes = effectiveAttributes(profile);
  const car =
    (team.dimensions.aero * 0.4 + team.dimensions.power * 0.3 + team.dimensions.chassis * 0.3) / 100;
  const pace = wet
    ? attributes.wetWeather * 0.45 + attributes.qualifyingPace * 0.35 + attributes.adaptability * 0.2
    : attributes.qualifyingPace * 0.75 + attributes.racePace * 0.15 + attributes.consistency * 0.1;
  return clamp((pace / 100) * 0.7 + car * 0.28 + (profile.confidence / 100) * 0.02, 0, 1);
}

function teamRaceScore(team: TeamDevelopmentProfile, track: TrackProfile): number {
  const street = isStreet(track);
  const weights = street
    ? { aero: 0.24, power: 0.08, chassis: 0.22, tyres: 0.18, reliability: 0.1, pitCrew: 0.08, development: 0.02, strategy: 0.08 }
    : { aero: 0.2, power: 0.2, chassis: 0.18, tyres: 0.16, reliability: 0.1, pitCrew: 0.06, development: 0.02, strategy: 0.08 };
  let total = 0;
  for (const [key, weight] of Object.entries(weights) as Array<[keyof typeof weights, number]>) {
    total += team.dimensions[key] * weight;
  }
  return clamp(total / 100, 0, 1);
}

export function computeDriverStrength(
  entry: ProbabilityDriver,
  track: TrackProfile,
  wet: boolean,
  homeDriverId?: string | null,
): number {
  const driver = driverRaceScore(entry.driver, track, wet, entry.id === homeDriverId);
  const team = teamRaceScore(entry.team, track);
  return clamp(driver * 0.58 + team * 0.42, 0, 1);
}

export function simulateQualifyingGrid(input: {
  track: TrackProfile;
  drivers: readonly ProbabilityDriver[];
  seed: string | number;
  wet?: boolean | null;
}): string[] {
  const wet = input.wet ?? false;
  const random = createSeededRandom(`quali:${input.seed}`);
  return [...input.drivers]
    .map((entry) => ({
      id: entry.id,
      score:
        driverQualifyingScore(entry.driver, entry.team, wet) +
        entry.driver.attributes.qualifyingPace / 100 * 0.02 +
        gaussian(random) * 0.035,
    }))
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.id);
}

function dnfProbability(entry: ProbabilityDriver, track: TrackProfile, wet: boolean): number {
  const reliability = entry.team.dimensions.reliability;
  const trackRisk = track.derived.dnfRate ?? 0.12;
  const base = 0.015 + trackRisk * (0.6 + ((100 - reliability) / 100) * 0.8);
  return clamp(base + (wet ? 0.025 : 0), 0.01, 0.55);
}

export function simulateRaceProbabilities(options: RaceProbabilityOptions): RaceProbabilityResult {
  const drivers = options.drivers;
  const total = drivers.length;
  if (total < 2) throw new Error("probabilidades exigem pelo menos 2 pilotos");
  const iterations = clamp(Math.round(options.iterations ?? 8000), 100, 20000);
  const rainProbability =
    options.wet === true
      ? 1
      : options.wet === false
        ? 0
        : (options.track.weather?.eventMonthRainProbability ?? 0);
  const grid = simulateQualifyingGrid({
    track: options.track,
    drivers,
    seed: `grid:${options.seed}`,
    wet: options.wet ?? false,
  });
  const gridIndex = new Map(grid.map((id, index) => [id, index]));
  const random = createSeededRandom(`race:${options.seed}`);
  const difficulty = options.track.derived.overtakingDifficulty ?? 5;
  const gridWeight = 0.03 + (difficulty / 10) * 0.05;

  const wins = new Map<string, number>();
  const podiums = new Map<string, number>();
  const points = new Map<string, number>();
  const dnfs = new Map<string, number>();
  const positionSums = new Map<string, number>();
  const distributions = new Map<string, number[]>(drivers.map((entry) => [entry.id, new Array(total + 1).fill(0)]));
  const strength = new Map<string, number>();
  let wetIterations = 0;

  for (const entry of drivers) {
    const dry = computeDriverStrength(entry, options.track, false, options.homeDriverId);
    const wet = computeDriverStrength(entry, options.track, true, options.homeDriverId);
    strength.set(entry.id, (1 - rainProbability) * dry + rainProbability * wet);
  }

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const wet = rainProbability >= 1 ? true : rainProbability <= 0 ? false : random() < rainProbability;
    if (wet) wetIterations += 1;
    const retired = new Set<string>();
    const finishers: Array<{ id: string; score: number }> = [];
    for (const entry of drivers) {
      const entryStrength = computeDriverStrength(entry, options.track, wet, options.homeDriverId);
      if (random() < dnfProbability(entry, options.track, wet)) {
        dnfs.set(entry.id, (dnfs.get(entry.id) ?? 0) + 1);
        retired.add(entry.id);
        continue;
      }
      const position = gridIndex.get(entry.id) ?? total - 1;
      const gridBonus = total > 1 ? (1 - position / (total - 1)) * gridWeight : 0;
      finishers.push({ id: entry.id, score: entryStrength + gridBonus + gaussian(random) * 0.05 });
    }
    finishers.sort((left, right) => right.score - left.score);
    const order = finishers.map((item) => item.id);
    for (const entry of drivers) {
      if (!order.includes(entry.id)) order.push(entry.id);
    }
    order.forEach((id, index) => {
      const place = index + 1;
      positionSums.set(id, (positionSums.get(id) ?? 0) + place);
      const distribution = distributions.get(id);
      if (distribution) distribution[place] += 1;
      if (retired.has(id)) return;
      if (place === 1) wins.set(id, (wins.get(id) ?? 0) + 1);
      if (place <= 3) podiums.set(id, (podiums.get(id) ?? 0) + 1);
      if (place <= 10) points.set(id, (points.get(id) ?? 0) + 1);
    });
  }

  for (const entry of drivers) {
    if (!positionSums.has(entry.id)) positionSums.set(entry.id, iterations * total);
  }

  return {
    iterations,
    wetProbability: wetIterations / iterations,
    grid,
    drivers: drivers.map((entry) => {
      const finishDnfs = dnfs.get(entry.id) ?? 0;
      return {
        id: entry.id,
        teamId: entry.teamId,
        win: (wins.get(entry.id) ?? 0) / iterations,
        podium: (podiums.get(entry.id) ?? 0) / iterations,
        points: (points.get(entry.id) ?? 0) / iterations,
        top10: (points.get(entry.id) ?? 0) / iterations,
        dnf: finishDnfs / iterations,
        expectedPosition: (positionSums.get(entry.id) ?? 0) / iterations,
        positionDistribution: (distributions.get(entry.id) ?? []).map((count) => count / iterations),
        strength: strength.get(entry.id) ?? 0,
      };
    }),
  };
}
