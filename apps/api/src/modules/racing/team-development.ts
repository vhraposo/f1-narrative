export const TEAM_DIMENSION_KEYS = [
  "aero",
  "power",
  "chassis",
  "tyres",
  "reliability",
  "pitCrew",
  "development",
  "strategy",
] as const;

export type TeamDimensionKey = (typeof TEAM_DIMENSION_KEYS)[number];
export type TeamDimensions = Record<TeamDimensionKey, number>;

export type TeamUpgrade = {
  id: string;
  area: TeamDimensionKey;
  magnitude: number;
  confidence: number;
  availableFrom: string;
  description?: string;
};

export type AppliedTeamUpgrade = TeamUpgrade & {
  appliedAt: string;
  spent: number;
};

export type TeamDevelopmentProfile = {
  dimensions: TeamDimensions;
  potential: TeamDimensions;
  upgrades: AppliedTeamUpgrade[];
};

export function clampTeamValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function fillDimensions(input: Partial<TeamDimensions> | undefined, fallback: number): TeamDimensions {
  const result = {} as TeamDimensions;
  for (const key of TEAM_DIMENSION_KEYS) {
    result[key] = clampTeamValue(input?.[key] ?? fallback);
  }
  return result;
}

export function createTeamDevelopmentProfile(input: {
  dimensions: Partial<TeamDimensions>;
  potential?: Partial<TeamDimensions>;
}): TeamDevelopmentProfile {
  const dimensions = fillDimensions(input.dimensions, 50);
  const potential = fillDimensions(input.potential, 65);
  for (const key of TEAM_DIMENSION_KEYS) {
    potential[key] = clampTeamValue(Math.max(dimensions[key], potential[key]));
  }
  return { dimensions, potential, upgrades: [] };
}

export function teamUpgradeCost(profile: TeamDevelopmentProfile, upgrade: TeamUpgrade): number {
  const current = profile.dimensions[upgrade.area];
  const confidence = Math.max(0.1, Math.min(1, upgrade.confidence));
  return Math.max(1, Math.ceil((upgrade.magnitude * (4 + current / 12)) / confidence));
}

export function applyTeamUpgrade(input: {
  profile: TeamDevelopmentProfile;
  upgrade: TeamUpgrade;
  availableBudget: number;
  appliedAt: string;
}): { profile: TeamDevelopmentProfile; applied: boolean; spent: number; gain: number } {
  const cost = teamUpgradeCost(input.profile, input.upgrade);
  if (input.availableBudget < cost) {
    return { profile: input.profile, applied: false, spent: 0, gain: 0 };
  }
  if (input.profile.upgrades.some((item) => item.id === input.upgrade.id)) {
    return { profile: input.profile, applied: false, spent: 0, gain: 0 };
  }
  const current = input.profile.dimensions[input.upgrade.area];
  const headroom = input.profile.potential[input.upgrade.area] - current;
  if (headroom <= 0) {
    return { profile: input.profile, applied: false, spent: 0, gain: 0 };
  }
  const confidence = Math.max(0.1, Math.min(1, input.upgrade.confidence));
  const rawGain = input.upgrade.magnitude * confidence * (0.5 + headroom / 20);
  const gain = Math.round(Math.min(headroom, Math.max(0.1, rawGain)) * 10) / 10;
  const dimensions = { ...input.profile.dimensions };
  dimensions[input.upgrade.area] = clampTeamValue(current + gain);
  return {
    profile: {
      dimensions,
      potential: input.profile.potential,
      upgrades: [
        ...input.profile.upgrades,
        { ...input.upgrade, appliedAt: input.appliedAt, spent: cost },
      ],
    },
    applied: true,
    spent: cost,
    gain,
  };
}

export function isUpgradeAvailable(upgrade: TeamUpgrade, date: string): boolean {
  return upgrade.availableFrom <= date;
}

export function applyAvailableUpgrades(input: {
  profile: TeamDevelopmentProfile;
  upgrades: readonly TeamUpgrade[];
  date: string;
  availableBudget: number;
}): { profile: TeamDevelopmentProfile; spent: number; applied: string[] } {
  let profile = input.profile;
  let budget = input.availableBudget;
  const applied: string[] = [];
  const ordered = [...input.upgrades]
    .filter((upgrade) => isUpgradeAvailable(upgrade, input.date))
    .sort((left, right) => {
      const leftGap = profile.potential[left.area] - profile.dimensions[left.area];
      const rightGap = profile.potential[right.area] - profile.dimensions[right.area];
      return rightGap - leftGap || left.id.localeCompare(right.id);
    });
  for (const upgrade of ordered) {
    const result = applyTeamUpgrade({ profile, upgrade, availableBudget: budget, appliedAt: input.date });
    if (result.applied) {
      profile = result.profile;
      budget -= result.spent;
      applied.push(upgrade.id);
    }
  }
  return { profile, spent: input.availableBudget - budget, applied };
}

export function teamStrength(profile: TeamDevelopmentProfile, weights?: Partial<TeamDimensions>): number {
  let weighted = 0;
  let total = 0;
  for (const key of TEAM_DIMENSION_KEYS) {
    const weight = weights?.[key] ?? 1;
    if (weight <= 0) continue;
    weighted += profile.dimensions[key] * weight;
    total += weight;
  }
  return total > 0 ? Math.round((weighted / total) * 10) / 10 : 0;
}
