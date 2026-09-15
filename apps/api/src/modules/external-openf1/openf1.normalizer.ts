import type { OpenF1DriverRaw } from "./openf1.client.js";

export interface NormalizedOpenF1Driver {
  driverNumber: number;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  headshotUrl: string | null;
  teamName: string | null;
  teamColour: string | null;
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function normalizeOpenF1Drivers(
  items: OpenF1DriverRaw[],
): NormalizedOpenF1Driver[] {
  return items
    .filter((item) => Number.isInteger(item.driver_number))
    .map((item) => ({
      driverNumber: item.driver_number as number,
      fullName: emptyToNull(item.full_name),
      firstName: emptyToNull(item.first_name),
      lastName: emptyToNull(item.last_name),
      headshotUrl: emptyToNull(item.headshot_url),
      teamName: emptyToNull(item.team_name),
      teamColour: emptyToNull(item.team_colour),
    }));
}