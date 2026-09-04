import { get, put, remove } from "./api";

export type Driver = {
  id: string;
  characterId: string;
  number: number | null;
  teamId: string | null;
  team: {
    id: string;
    name: string;
    shortName: string | null;
    color: string | null;
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
  teamId?: string | null;
};

type ListResponse = { drivers: Driver[] };
type ItemResponse = { driver: Driver };

export function listDrivers(): Promise<Driver[]> {
  return get<ListResponse>("/api/drivers").then((r) => r.drivers);
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
