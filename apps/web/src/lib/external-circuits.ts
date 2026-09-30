import { get } from "@/lib/api";

export type CircuitLayoutView = {
  key: string | null;
  url: string | null;
  source: string | null;
  available: boolean;
};

export type CircuitPhotoView = {
  url: string;
  source: string;
  sourceUrl: string | null;
  author: string | null;
  license: string;
  licenseUrl: string | null;
  attribution: string | null;
};

export type CircuitMediaView = {
  layout: CircuitLayoutView;
  photo: CircuitPhotoView | null;
  attributionRequired: boolean;
};

export type ExternalCircuitListItem = {
  id: string;
  name: string;
  locality: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  lengthMeters: number | null;
  turns: number | null;
  direction: string | null;
  firstRaceYear: number | null;
  lastRaceYear: number | null;
  raceCount: number;
  media: CircuitMediaView;
};

export type CircuitWinnerEntry = {
  externalDriverId: string;
  name: string;
  wins: number;
};

export type CircuitRecentWinnerEntry = {
  externalRaceId: string;
  raceName: string | null;
  seasonYear: number;
  round: number;
  date: string | null;
  externalDriverId: string;
  driverName: string;
};

export type CircuitRaceLapEntry = {
  externalDriverId: string;
  driverName: string;
  time: string;
  seasonYear: number;
  round: number;
  raceName: string | null;
};

export type ExternalCircuitDetail = ExternalCircuitListItem & {
  source: string;
  sourceUrl: string | null;
  topWinners: CircuitWinnerEntry[];
  recentWinners: CircuitRecentWinnerEntry[];
  fastestRaceLap: CircuitRaceLapEntry | null;
  officialLapRecord: { available: false; reason: "LAP_RECORD_SOURCE_UNAVAILABLE" };
};

export function listExternalCircuits(search?: string): Promise<{
  circuits: ExternalCircuitListItem[];
  total: number;
}> {
  const query =
    search && search.trim().length > 0
      ? `?search=${encodeURIComponent(search.trim())}`
      : "";
  return get(`/api/external/circuits${query}`);
}

export function getExternalCircuitDetail(
  id: string,
): Promise<ExternalCircuitDetail> {
  return get<{ circuit: ExternalCircuitDetail }>(`/api/external/circuits/${id}`).then(
    (response) => response.circuit,
  );
}
