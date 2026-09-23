import type { TeamPerformance } from "@prisma/client";

export const PERFORMANCE_MIN = 0;
export const PERFORMANCE_MAX = 100;

export const DEFAULT_PERFORMANCE = {
  carSpeed: 50,
  reliability: 50,
  operations: 50,
} as const;

export type PerformanceValues = {
  carSpeed: number;
  reliability: number;
  operations: number;
};

export function clampPerformanceValue(value: number): number {
  if (value < PERFORMANCE_MIN) return PERFORMANCE_MIN;
  if (value > PERFORMANCE_MAX) return PERFORMANCE_MAX;
  return value;
}

export function effectivePerformance(
  row: TeamPerformance | null,
): PerformanceValues {
  if (!row) return { carSpeed: 50, reliability: 50, operations: 50 };
  return {
    carSpeed: row.carSpeed,
    reliability: row.reliability,
    operations: row.operations,
  };
}