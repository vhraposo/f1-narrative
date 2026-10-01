import { z } from "zod";

export const DRIVER_NUMBER_MIN = 1;
export const DRIVER_NUMBER_MAX = 99;
export const DRIVER_NUMBER_RESERVED = 17;

export type DriverNumberIssue = "NUMBER_INVALID" | "NUMBER_RESERVED";

export function inspectDriverNumber(value: number): DriverNumberIssue | null {
  if (
    !Number.isInteger(value) ||
    value < DRIVER_NUMBER_MIN ||
    value > DRIVER_NUMBER_MAX
  ) {
    return "NUMBER_INVALID";
  }
  if (value === DRIVER_NUMBER_RESERVED) return "NUMBER_RESERVED";
  return null;
}

export const driverNumberSchema = z
  .number()
  .int("O número precisa ser um inteiro")
  .min(
    DRIVER_NUMBER_MIN,
    `O número precisa ser entre ${DRIVER_NUMBER_MIN} e ${DRIVER_NUMBER_MAX}`,
  )
  .max(
    DRIVER_NUMBER_MAX,
    `O número precisa ser entre ${DRIVER_NUMBER_MIN} e ${DRIVER_NUMBER_MAX}`,
  )
  .refine(
    (value) => value !== DRIVER_NUMBER_RESERVED,
    `O número ${DRIVER_NUMBER_RESERVED} é reservado`,
  );
