import { get, put } from "./api";

export type DriverNumberAvailability = {
  number: number;
  available: boolean;
  reason: string | null;
  driverProfileId: string | null;
  driverName: string | null;
};

export type DriverNumberBoard = {
  seasonId: string;
  championDriverProfileId: string | null;
  numbers: DriverNumberAvailability[];
};

export function getDriverNumbers(
  seasonId: string,
  driverProfileId?: string,
): Promise<DriverNumberBoard> {
  const query = driverProfileId
    ? `?driverProfileId=${encodeURIComponent(driverProfileId)}`
    : "";
  return get<{ board: DriverNumberBoard }>(
    `/api/seasons/${seasonId}/driver-numbers${query}`,
  ).then((response) => response.board);
}

export function setDriverNumber(
  seasonId: string,
  driverProfileId: string,
  number: number | null,
): Promise<{ number: number | null }> {
  return put<{ number: { number: number | null } }>(
    `/api/seasons/${seasonId}/drivers/${driverProfileId}/number`,
    { number },
  ).then((response) => response.number);
}
