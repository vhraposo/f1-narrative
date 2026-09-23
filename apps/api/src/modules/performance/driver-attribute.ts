import type { DriverAttribute } from "@prisma/client";

export const ATTRIBUTE_MIN = 0;
export const ATTRIBUTE_MAX = 100;

export const DEFAULT_DRIVER_ATTRIBUTES = {
  speed: 50,
  consistency: 50,
  racecraft: 50,
  aggression: 50,
} as const;

export type DriverAttributeValues = {
  speed: number;
  consistency: number;
  racecraft: number;
  aggression: number;
};

export function clampAttributeValue(value: number): number {
  if (value < ATTRIBUTE_MIN) return ATTRIBUTE_MIN;
  if (value > ATTRIBUTE_MAX) return ATTRIBUTE_MAX;
  return value;
}

export function effectiveDriverAttributes(
  row: DriverAttribute | null,
): DriverAttributeValues {
  if (!row) return { speed: 50, consistency: 50, racecraft: 50, aggression: 50 };
  return {
    speed: row.speed,
    consistency: row.consistency,
    racecraft: row.racecraft,
    aggression: row.aggression,
  };
}