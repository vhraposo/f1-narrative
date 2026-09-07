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

export const AVAILABILITY_STATUS_LABELS: Record<AvailabilityStatus, string> = {
  AVAILABLE: "Disponível",
  BUSY: "Ocupado",
  TRAINING: "Treinando",
  TRAVELING: "Em viagem",
  SLEEPING: "Dormindo",
  RACE_WEEKEND: "Fim de semana de corrida",
  OFFLINE: "Offline",
};

export function formatAvailabilityDateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = date.toLocaleDateString("pt-BR", { day: "2-digit" });
  const month = date
    .toLocaleDateString("pt-BR", { month: "short" })
    .replace(".", "")
    .toUpperCase();
  const time = date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${day} ${month} · ${time}`;
}

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