import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRAINING_PROGRAMS,
  DRIVER_ATTRIBUTE_KEYS,
  advanceAge,
  applyTraining,
  chooseAiTraining,
  createDriverDevelopmentProfile,
  effectiveAttributes,
  recover,
  simulateDevelopmentSeason,
  type DriverAttributes,
} from "./driver-development.js";

function attributes(value: number): DriverAttributes {
  const result = {} as DriverAttributes;
  for (const key of DRIVER_ATTRIBUTE_KEYS) result[key] = value;
  return result;
}

describe("driver development", () => {
  it("clamps attributes and never lets potential sit below current ability", () => {
    const profile = createDriverDevelopmentProfile({
      attributes: { racePace: 120, qualifyingPace: -5 },
      potential: { racePace: 70 },
      age: 24,
      experienceYears: 3,
    });
    expect(profile.attributes.racePace).toBe(100);
    expect(profile.attributes.qualifyingPace).toBe(0);
    expect(profile.potential.racePace).toBe(100);
  });

  it("never exceeds potential and stops gaining when capped", () => {
    const profile = createDriverDevelopmentProfile({
      attributes: attributes(60),
      potential: attributes(62),
      age: 23,
      experienceYears: 2,
    });
    const program = DEFAULT_TRAINING_PROGRAMS.find((item) => item.id === "race-pace")!;
    let current = profile;
    for (let session = 0; session < 20; session += 1) {
      current = applyTraining({ profile: current, program, availableXp: 100 }).profile;
    }
    expect(current.attributes.racePace).toBeLessThanOrEqual(62);
    expect(current.attributes.racePace).toBeGreaterThan(60);
    const capped = applyTraining({ profile: current, program, availableXp: 100 });
    expect(capped.gains.racePace ?? 0).toBe(0);
  });

  it("applies diminishing returns as the attribute approaches potential", () => {
    const program = DEFAULT_TRAINING_PROGRAMS.find((item) => item.id === "race-pace")!;
    const low = createDriverDevelopmentProfile({
      attributes: attributes(50),
      potential: attributes(95),
      age: 23,
      experienceYears: 2,
    });
    const high = createDriverDevelopmentProfile({
      attributes: attributes(90),
      potential: attributes(95),
      age: 23,
      experienceYears: 2,
    });
    const lowGain = applyTraining({ profile: low, program, availableXp: 20 }).gains.racePace ?? 0;
    const highGain = applyTraining({ profile: high, program, availableXp: 20 }).gains.racePace ?? 0;
    expect(lowGain).toBeGreaterThan(highGain);
  });

  it("fatigue hurts physical attributes but not composure", () => {
    const fresh = createDriverDevelopmentProfile({
      attributes: attributes(80),
      age: 27,
      experienceYears: 5,
      fatigue: 0,
      confidence: 90,
    });
    const tired = { ...fresh, fatigue: 90 };
    expect(effectiveAttributes(tired).racePace).toBeLessThan(effectiveAttributes(fresh).racePace);
    expect(effectiveAttributes(tired).composure).toBe(effectiveAttributes(fresh).composure);
  });

  it("AI training targets the largest remaining headroom", () => {
    const profile = createDriverDevelopmentProfile({
      attributes: attributes(50),
      potential: { ...attributes(50), racePace: 95 },
      age: 24,
      experienceYears: 3,
    });
    const program = chooseAiTraining(profile, DEFAULT_TRAINING_PROGRAMS);
    expect(program?.id).toBe("race-pace");
  });

  it("keeps a season bounded and deterministic", () => {
    const profile = createDriverDevelopmentProfile({
      attributes: attributes(55),
      potential: attributes(90),
      age: 24,
      experienceYears: 2,
    });
    const options = {
      profile,
      programs: DEFAULT_TRAINING_PROGRAMS,
      weeks: 12,
      sessionsPerWeek: 2,
      xpPerWeek: 12,
      recoveryPerWeek: 6,
    };
    const first = simulateDevelopmentSeason(options);
    const second = simulateDevelopmentSeason(options);
    expect(first.totalGain).toBe(second.totalGain);
    expect(first.profile).toEqual(second.profile);
    expect(first.totalGain).toBeGreaterThan(0);
    expect(first.totalGain).toBeLessThanOrEqual(45);
    for (const key of DRIVER_ATTRIBUTE_KEYS) {
      expect(first.profile.attributes[key]).toBeLessThanOrEqual(first.profile.potential[key]);
    }
  });

  it("recovers fatigue and ages physical attributes", () => {
    const profile = createDriverDevelopmentProfile({
      attributes: attributes(80),
      potential: attributes(90),
      age: 31,
      experienceYears: 10,
      fatigue: 60,
    });
    expect(recover(profile, 20).fatigue).toBe(40);
    const aged = advanceAge(profile, 2);
    expect(aged.attributes.racePace).toBeLessThan(profile.attributes.racePace);
    expect(aged.attributes.technicalFeedback).toBeGreaterThan(profile.attributes.technicalFeedback);
    expect(aged.age).toBe(33);
  });
});
