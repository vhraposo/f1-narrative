import { get, patch } from "./api";

// Valores reais do enum backend AvailabilityStatus (availability.schema.ts).
export const AVAILABILITY_STATUSES = [
  "AVAILABLE",
  "BUSY",
  "TRAINING",
  "TRAVELING",
  "SLEEPING",
  "RACE_WEEKEND",
  "OFFLINE",
] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

export type Availability = {
  id: string;
  characterId: string;
  status: AvailabilityStatus;
  reason: string | null;
  since: string;
  until: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpdateAvailabilityInput = {
  status?: AvailabilityStatus;
  reason?: string | null;
  until?: string | null;
};

type ItemResponse = { availability: Availability };

export function getAvailability(characterId: string): Promise<Availability> {
  return get<ItemResponse>(
    `/api/characters/${characterId}/availability`,
  ).then((r) => r.availability);
}

export function updateAvailability(
  characterId: string,
  input: UpdateAvailabilityInput,
): Promise<Availability> {
  return patch<ItemResponse>(
    `/api/characters/${characterId}/availability`,
    input,
  ).then((r) => r.availability);
}