import { z } from "zod";

export const TRACK_PROFILE_SCHEMA_VERSION = "v5.track-profiles.v1";

export const TrackWeatherMonthSchema = z.object({
  month: z.number().int().min(1).max(12),
  rainDayProbability: z.number().min(0).max(1),
  avgTempC: z.number().nullable(),
  avgWindKmh: z.number().nullable(),
  sampleDays: z.number().int().min(0),
});

export const TrackDerivedSchema = z.object({
  dnfRate: z.number().min(0).max(1).nullable(),
  avgPositionsGained: z.number().nullable(),
  pitStopsPerRace: z.number().min(0).nullable(),
  overtakingDifficulty: z.number().min(1).max(10).nullable(),
  sampleStarts: z.number().int().min(0),
  confidence: z.number().min(0).max(1),
});

export const TrackSourceSchema = z.object({
  name: z.string().min(1),
  url: z.string().nullable(),
  license: z.string().min(1),
  note: z.string().min(1),
});

export const TrackProfileSchema = z.object({
  circuitId: z.string().min(1),
  name: z.string().min(1),
  officialName: z.string().min(1),
  country: z.string().min(1),
  city: z.string().nullable(),
  type: z.string().min(1),
  direction: z.string().min(1),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  lengthKm: z.number().positive().nullable(),
  laps: z.number().int().positive().nullable(),
  turns: z.number().int().positive().nullable(),
  layoutId: z.string().nullable(),
  eventMonth: z.number().int().min(1).max(12).nullable(),
  firstRaceYear: z.number().int().nullable(),
  racesHeld: z.number().int().min(0).nullable(),
  derived: TrackDerivedSchema,
  weather: z
    .object({
      eventMonthRainProbability: z.number().min(0).max(1).nullable(),
      months: z.array(TrackWeatherMonthSchema).length(12),
    })
    .nullable(),
  unavailable: z.array(z.string()),
  sources: z.array(TrackSourceSchema),
  confidence: z.number().min(0).max(1),
});

export const TrackProfileDatasetSchema = z.object({
  schemaVersion: z.literal(TRACK_PROFILE_SCHEMA_VERSION),
  generatedAt: z.string().datetime(),
  sourceVersion: z.string().min(1),
  targetYear: z.number().int(),
  circuits: z.array(TrackProfileSchema).min(1),
  sources: z.array(TrackSourceSchema),
});

export type TrackWeatherMonth = z.infer<typeof TrackWeatherMonthSchema>;
export type TrackProfile = z.infer<typeof TrackProfileSchema>;
export type TrackProfileDataset = z.infer<typeof TrackProfileDatasetSchema>;
export type TrackSource = z.infer<typeof TrackSourceSchema>;

export const TRACK_UNAVAILABLE_FIELDS = [
  "powerDemand",
  "downforceDemand",
  "brakingDemand",
  "tractionDemand",
  "tyreStress",
  "abrasion",
  "trackEvolution",
  "grip",
  "pitLossSeconds",
  "safetyCarRate",
  "sprintWeekend",
] as const;

export function validateTrackProfileDataset(input: unknown): TrackProfileDataset {
  return TrackProfileDatasetSchema.parse(input);
}

export function assertTrackProfileInvariants(dataset: TrackProfileDataset): void {
  const ids = new Set<string>();
  for (const circuit of dataset.circuits) {
    if (ids.has(circuit.circuitId)) {
      throw new Error(`circuito duplicado: ${circuit.circuitId}`);
    }
    ids.add(circuit.circuitId);
    if (circuit.derived.overtakingDifficulty !== null) {
      if (circuit.derived.overtakingDifficulty < 1 || circuit.derived.overtakingDifficulty > 10) {
        throw new Error(`dificuldade de ultrapassagem fora de faixa: ${circuit.circuitId}`);
      }
    }
    if (circuit.eventMonth !== null && circuit.weather === null) {
      throw new Error(`clima ausente para circuito com evento: ${circuit.circuitId}`);
    }
    for (const source of circuit.sources) {
      if (source.license.trim().length === 0) {
        throw new Error(`licença ausente em ${circuit.circuitId}`);
      }
    }
  }
}
