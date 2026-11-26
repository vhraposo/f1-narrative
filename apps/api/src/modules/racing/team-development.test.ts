import { describe, expect, it } from "vitest";
import {
  TEAM_DIMENSION_KEYS,
  applyAvailableUpgrades,
  applyTeamUpgrade,
  createTeamDevelopmentProfile,
  isUpgradeAvailable,
  teamStrength,
  teamUpgradeCost,
  type TeamDimensions,
  type TeamUpgrade,
} from "./team-development.js";

function dimensions(value: number): TeamDimensions {
  const result = {} as TeamDimensions;
  for (const key of TEAM_DIMENSION_KEYS) result[key] = value;
  return result;
}

function upgrade(overrides: Partial<TeamUpgrade> = {}): TeamUpgrade {
  return {
    id: "aero-1",
    area: "aero",
    magnitude: 2,
    confidence: 0.9,
    availableFrom: "2026-03-01",
    ...overrides,
  };
}

describe("team development", () => {
  it("clamps dimensions and potential", () => {
    const profile = createTeamDevelopmentProfile({
      dimensions: { aero: 140, power: -10 },
      potential: { aero: 60 },
    });
    expect(profile.dimensions.aero).toBe(100);
    expect(profile.dimensions.power).toBe(0);
    expect(profile.potential.aero).toBe(100);
  });

  it("applies an upgrade within budget, confidence and headroom", () => {
    const profile = createTeamDevelopmentProfile({
      dimensions: dimensions(50),
      potential: { ...dimensions(50), aero: 80 },
    });
    const cost = teamUpgradeCost(profile, upgrade());
    const result = applyTeamUpgrade({ profile, upgrade: upgrade(), availableBudget: cost, appliedAt: "2026-03-10" });
    expect(result.applied).toBe(true);
    expect(result.gain).toBeGreaterThan(0);
    expect(result.profile.dimensions.aero).toBeGreaterThan(50);
    expect(result.profile.dimensions.aero).toBeLessThanOrEqual(80);
    expect(result.profile.upgrades).toHaveLength(1);
    expect(result.profile.upgrades[0].spent).toBe(cost);
  });

  it("rejects duplicate, unaffordable or capped upgrades", () => {
    const profile = createTeamDevelopmentProfile({
      dimensions: dimensions(50),
      potential: { ...dimensions(50), aero: 51 },
    });
    const cost = teamUpgradeCost(profile, upgrade());
    const applied = applyTeamUpgrade({ profile, upgrade: upgrade(), availableBudget: cost, appliedAt: "2026-03-10" });
    expect(applyTeamUpgrade({ profile: applied.profile, upgrade: upgrade(), availableBudget: 100, appliedAt: "2026-04-10" }).applied).toBe(false);
    expect(applyTeamUpgrade({ profile, upgrade: upgrade(), availableBudget: 0, appliedAt: "2026-03-10" }).applied).toBe(false);
    const capped = createTeamDevelopmentProfile({
      dimensions: { ...dimensions(50), aero: 60 },
      potential: { ...dimensions(50), aero: 60 },
    });
    expect(applyTeamUpgrade({ profile: capped, upgrade: upgrade(), availableBudget: 100, appliedAt: "2026-03-10" }).applied).toBe(false);
  });

  it("diminishes gains as the dimension approaches its ceiling", () => {
    const low = createTeamDevelopmentProfile({
      dimensions: dimensions(40),
      potential: { ...dimensions(40), aero: 90 },
    });
    const high = createTeamDevelopmentProfile({
      dimensions: dimensions(85),
      potential: { ...dimensions(85), aero: 90 },
    });
    const lowResult = applyTeamUpgrade({ profile: low, upgrade: upgrade(), availableBudget: 1000, appliedAt: "2026-03-10" });
    const highResult = applyTeamUpgrade({ profile: high, upgrade: upgrade(), availableBudget: 1000, appliedAt: "2026-03-10" });
    expect(lowResult.gain).toBeGreaterThan(highResult.gain);
  });

  it("only applies upgrades available at the current date", () => {
    const profile = createTeamDevelopmentProfile({
      dimensions: dimensions(50),
      potential: dimensions(90),
    });
    const upgrades = [
      upgrade({ id: "early", availableFrom: "2026-03-01" }),
      upgrade({ id: "late", area: "power", availableFrom: "2026-06-01" }),
    ];
    expect(isUpgradeAvailable(upgrades[1], "2026-05-01")).toBe(false);
    const result = applyAvailableUpgrades({ profile, upgrades, date: "2026-05-01", availableBudget: 100 });
    expect(result.applied).toEqual(["early"]);
    expect(result.profile.dimensions.power).toBe(50);
  });

  it("weights team strength by requested dimensions", () => {
    const profile = createTeamDevelopmentProfile({
      dimensions: { ...dimensions(50), power: 90 },
      potential: dimensions(100),
    });
    const zero = Object.fromEntries(TEAM_DIMENSION_KEYS.map((key) => [key, 0])) as Partial<TeamDimensions>;
    expect(teamStrength(profile)).toBeGreaterThan(teamStrength(profile, zero));
    expect(teamStrength(profile, { ...zero, power: 1 })).toBe(90);
    expect(teamStrength(profile, { ...Object.fromEntries(TEAM_DIMENSION_KEYS.map((key) => [key, 0])) })).toBe(0);
  });
});
