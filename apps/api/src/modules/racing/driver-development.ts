export const DRIVER_ATTRIBUTE_KEYS = [
  "qualifyingPace",
  "racePace",
  "consistency",
  "tireManagement",
  "racecraft",
  "starts",
  "wetWeather",
  "adaptability",
  "composure",
  "technicalFeedback",
] as const;

export type DriverAttributeKey = (typeof DRIVER_ATTRIBUTE_KEYS)[number];
export type DriverAttributes = Record<DriverAttributeKey, number>;

export type DriverDevelopmentProfile = {
  attributes: DriverAttributes;
  potential: DriverAttributes;
  age: number;
  experienceYears: number;
  growthRate: number;
  morale: number;
  confidence: number;
  fatigue: number;
};

export type TrainingProgram = {
  id: string;
  label: string;
  focus: Partial<Record<DriverAttributeKey, number>>;
  xpCost: number;
  fatigue: number;
};

export const PHYSICAL_ATTRIBUTES: ReadonlySet<DriverAttributeKey> = new Set([
  "qualifyingPace",
  "racePace",
  "starts",
  "wetWeather",
  "adaptability",
  "racecraft",
]);

export function clampDriverValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function fillAttributes(input: Partial<DriverAttributes> | undefined, fallback: number): DriverAttributes {
  const result = {} as DriverAttributes;
  for (const key of DRIVER_ATTRIBUTE_KEYS) {
    result[key] = clampDriverValue(input?.[key] ?? fallback);
  }
  return result;
}

export function createDriverDevelopmentProfile(input: {
  attributes: Partial<DriverAttributes>;
  potential?: Partial<DriverAttributes>;
  age: number;
  experienceYears: number;
  growthRate?: number;
  morale?: number;
  confidence?: number;
  fatigue?: number;
}): DriverDevelopmentProfile {
  const attributes = fillAttributes(input.attributes, 50);
  const potential = fillAttributes(input.potential, 60);
  for (const key of DRIVER_ATTRIBUTE_KEYS) {
    potential[key] = clampDriverValue(Math.max(attributes[key], potential[key]));
  }
  return {
    attributes,
    potential,
    age: Math.max(16, Math.min(50, Math.round(input.age))),
    experienceYears: Math.max(0, Math.min(30, Math.round(input.experienceYears))),
    growthRate: Math.max(0, Math.min(1, input.growthRate ?? 0.5)),
    morale: clampDriverValue(input.morale ?? 70),
    confidence: clampDriverValue(input.confidence ?? 70),
    fatigue: clampDriverValue(input.fatigue ?? 10),
  };
}

export function effectiveAttributes(profile: DriverDevelopmentProfile): DriverAttributes {
  const fatiguePenalty = profile.fatigue / 200;
  const confidencePenalty = (100 - profile.confidence) / 400;
  const result = {} as DriverAttributes;
  for (const key of DRIVER_ATTRIBUTE_KEYS) {
    const base = profile.attributes[key];
    const penalty = PHYSICAL_ATTRIBUTES.has(key)
      ? base * fatiguePenalty
      : key === "composure"
        ? base * confidencePenalty
        : 0;
    result[key] = clampDriverValue(base - penalty);
  }
  return result;
}

function ageGrowthFactor(age: number): number {
  if (age <= 22) return 1.25;
  if (age <= 26) return 1.1;
  if (age <= 30) return 0.95;
  if (age <= 33) return 0.75;
  return 0.55;
}

export function trainingCost(profile: DriverDevelopmentProfile, program: TrainingProgram): number {
  const average =
    Object.values(program.focus).reduce((sum, weight) => sum + (weight ?? 0), 0) /
    Math.max(1, Object.keys(program.focus).length);
  return Math.max(1, Math.ceil(program.xpCost * (1 + average * 0.01)));
}

export function applyTraining(input: {
  profile: DriverDevelopmentProfile;
  program: TrainingProgram;
  availableXp: number;
}): {
  profile: DriverDevelopmentProfile;
  spentXp: number;
  gains: Partial<Record<DriverAttributeKey, number>>;
} {
  const cost = trainingCost(input.profile, input.program);
  if (input.availableXp < cost) {
    return { profile: input.profile, spentXp: 0, gains: {} };
  }
  const attributes = { ...input.profile.attributes };
  const gains: Partial<Record<DriverAttributeKey, number>> = {};
  const factor = ageGrowthFactor(input.profile.age) * (0.6 + input.profile.growthRate * 0.8);
  for (const [key, weightValue] of Object.entries(input.program.focus) as Array<
    [DriverAttributeKey, number | undefined]
  >) {
    const weight = weightValue ?? 0;
    if (weight <= 0) continue;
    const current = attributes[key];
    const headroom = input.profile.potential[key] - current;
    if (headroom <= 0) continue;
    const gain = Math.max(
      0,
      Math.min(
        headroom,
        Math.min(
          2.5,
          0.25 + weight * 1.2 * (headroom / 40) * factor + (headroom > 5 ? 0.15 : 0),
        ),
      ),
    );
    const rounded = Math.round(gain * 10) / 10;
    if (rounded > 0) {
      attributes[key] = clampDriverValue(current + rounded);
      gains[key] = rounded;
    }
  }
  const fatigue = clampDriverValue(input.profile.fatigue + input.program.fatigue);
  const morale = clampDriverValue(input.profile.morale + (Object.keys(gains).length > 0 ? 1 : -1));
  return {
    profile: {
      ...input.profile,
      attributes,
      fatigue,
      morale,
    },
    spentXp: cost,
    gains,
  };
}

export function recover(profile: DriverDevelopmentProfile, points: number): DriverDevelopmentProfile {
  return { ...profile, fatigue: clampDriverValue(profile.fatigue - Math.max(0, points)) };
}

export function advanceAge(profile: DriverDevelopmentProfile, years = 1): DriverDevelopmentProfile {
  const attributes = { ...profile.attributes };
  const potential = { ...profile.potential };
  for (const key of DRIVER_ATTRIBUTE_KEYS) {
    if (key === "technicalFeedback") {
      attributes[key] = clampDriverValue(attributes[key] + 0.4 * years);
      potential[key] = clampDriverValue(potential[key] + 0.4 * years);
    } else if (PHYSICAL_ATTRIBUTES.has(key)) {
      attributes[key] = clampDriverValue(attributes[key] - 0.6 * years);
    }
  }
  return {
    ...profile,
    attributes,
    potential,
    age: profile.age + years,
    experienceYears: profile.experienceYears + years,
    fatigue: clampDriverValue(profile.fatigue - 5 * years),
  };
}

export function chooseAiTraining(
  profile: DriverDevelopmentProfile,
  programs: readonly TrainingProgram[],
): TrainingProgram | null {
  let weakestKey: DriverAttributeKey | null = null;
  let weakestHeadroom = 0;
  for (const key of DRIVER_ATTRIBUTE_KEYS) {
    const headroom = profile.potential[key] - profile.attributes[key];
    if (headroom > weakestHeadroom) {
      weakestHeadroom = headroom;
      weakestKey = key;
    }
  }
  if (!weakestKey) return null;
  let best: TrainingProgram | null = null;
  let bestWeight = 0;
  for (const program of programs) {
    const weight = program.focus[weakestKey] ?? 0;
    if (weight > bestWeight) {
      bestWeight = weight;
      best = program;
    }
  }
  return best;
}

export function simulateDevelopmentSeason(input: {
  profile: DriverDevelopmentProfile;
  programs: readonly TrainingProgram[];
  weeks: number;
  sessionsPerWeek: number;
  xpPerWeek: number;
  recoveryPerWeek: number;
}): { profile: DriverDevelopmentProfile; totalGain: number } {
  let profile = input.profile;
  const startTotal = Object.values(profile.attributes).reduce((sum, value) => sum + value, 0);
  for (let week = 0; week < input.weeks; week += 1) {
    let xp = input.xpPerWeek;
    for (let session = 0; session < input.sessionsPerWeek; session += 1) {
      const program = chooseAiTraining(profile, input.programs);
      if (!program) break;
      const trained = applyTraining({ profile, program, availableXp: xp });
      if (trained.spentXp === 0) break;
      profile = trained.profile;
      xp -= trained.spentXp;
    }
    profile = recover(profile, input.recoveryPerWeek);
  }
  const endTotal = Object.values(profile.attributes).reduce((sum, value) => sum + value, 0);
  return { profile, totalGain: Math.round((endTotal - startTotal) * 10) / 10 };
}

export const DEFAULT_TRAINING_PROGRAMS: readonly TrainingProgram[] = [
  { id: "qualifying", label: "Ritmo de classificação", focus: { qualifyingPace: 1 }, xpCost: 4, fatigue: 8 },
  { id: "race-pace", label: "Ritmo de corrida", focus: { racePace: 1 }, xpCost: 4, fatigue: 8 },
  { id: "tyres", label: "Gestão de pneus", focus: { tireManagement: 1 }, xpCost: 4, fatigue: 6 },
  { id: "racecraft", label: "Racecraft", focus: { racecraft: 1 }, xpCost: 4, fatigue: 7 },
  { id: "wet", label: "Pilotagem na chuva", focus: { wetWeather: 1 }, xpCost: 4, fatigue: 7 },
  { id: "adaptability", label: "Adaptabilidade", focus: { adaptability: 1 }, xpCost: 3, fatigue: 5 },
  { id: "fitness", label: "Preparação física", focus: { racePace: 0.6, starts: 0.6 }, xpCost: 3, fatigue: 10 },
  { id: "simulator", label: "Simulador e feedback técnico", focus: { technicalFeedback: 0.7, composure: 0.4 }, xpCost: 3, fatigue: 4 },
  { id: "starts", label: "Largadas", focus: { starts: 1 }, xpCost: 3, fatigue: 5 },
  { id: "consistency", label: "Consistência", focus: { consistency: 1 }, xpCost: 3, fatigue: 5 },
];
