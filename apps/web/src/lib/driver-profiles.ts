import { get, patch, put, remove } from "./api";

export type Driver = {
  id: string;
  characterId: string;
  number: number | null;
  teamId: string | null;
  headshotUrl: string | null;
  customHeadshotUrl?: string | null;
  displayHeadshotUrl?: string | null;
  team: {
    id: string;
    name: string;
    shortName: string | null;
    color: string | null;
    visualIdentity?: {
      primary: string;
      secondary?: string | null;
      accent?: string | null;
      foreground?: string | null;
    } | null;
  } | null;
  createdAt: string;
  updatedAt: string;
  character: {
    id: string;
    name: string;
    nationality: string;
    imageUrl: string | null;
  };
};

export type UpsertDriverInput = {
  number?: number | null;
  customHeadshotUrl?: string | null;
};

export type DriverAttributes = {
  speed: number;
  consistency: number;
  racecraft: number;
  aggression: number;
};

export type DriverDetail = Driver & {
  role: string | null;
  seat: number | null;
  status: string | null;
  attributes: DriverAttributes | null;
  character: Driver["character"] & {
    birthDate: string;
    biography: string | null;
  };
};

export function formatDriverNumber(number: number | null): string {
  return `#${number ?? "—"}`;
}

export function compareDrivers(a: Driver, b: Driver): number {
  if (a.number !== b.number) {
    if (a.number === null) return 1;
    if (b.number === null) return -1;
    return a.number - b.number;
  }
  const byName = a.character.name.localeCompare(b.character.name);
  if (byName !== 0) return byName;
  return a.characterId.localeCompare(b.characterId);
}

type ListResponse = { drivers: Driver[] };
type ItemResponse = { driver: Driver };

export function listDrivers(): Promise<Driver[]> {
  return get<ListResponse>("/api/drivers").then((r) => r.drivers);
}

export function getDriver(id: string): Promise<DriverDetail> {
  return get<{ driver: DriverDetail }>(`/api/drivers/${id}`).then(
    (r) => r.driver,
  );
}

export function updateDriver(
  id: string,
  input: UpsertDriverInput,
): Promise<Driver> {
  return patch<ItemResponse>(`/api/drivers/${id}`, input).then(
    (r) => r.driver,
  );
}

export function upsertDriver(
  characterId: string,
  input: UpsertDriverInput,
): Promise<Driver> {
  return put<ItemResponse>(`/api/drivers/${characterId}`, input).then(
    (r) => r.driver,
  );
}

export function deleteDriver(characterId: string): Promise<void> {
  return remove<void>(`/api/drivers/${characterId}`);
}
