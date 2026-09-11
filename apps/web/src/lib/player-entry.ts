import { get, post } from "./api";

export type PlayerEntrySeason = {
  id: string;
  year: number;
  status: string;
  externalSeasonId: string;
  externalSeasonYear: number;
  externalSeasonStatus: string | null;
};

export type PlayerEntrySourceSeat = {
  name: string;
  number: number | null;
  teamName: string | null;
};

export type PlayerEntryUniverseSeat = {
  characterName: string;
  provenance: string;
};

export type PlayerEntrySeat = {
  seat: 1 | 2;
  source: PlayerEntrySourceSeat | null;
  universe: PlayerEntryUniverseSeat | null;
};

export type PlayerEntryReserve = PlayerEntrySourceSeat;

export type PlayerEntryTeam = {
  id: string;
  name: string;
  shortName: string | null;
  color: string | null;
  externalTeamId: string;
  seats: PlayerEntrySeat[];
  reserve: PlayerEntryReserve[];
};

export type PlayerEntrySelection = {
  seasonId: string;
  teams: PlayerEntryTeam[];
};

export type PlayerEntrySetup = {
  seasons: PlayerEntrySeason[];
  selection: PlayerEntrySelection | null;
};

export type PlayerEntryCreateInput = {
  seasonId: string;
  teamId: string;
  seat: 1 | 2;
  name: string;
  nationality: string;
  gender?: string | null;
  birthDate: string;
};

export type PlayerEntryCharacter = {
  id: string;
  name: string;
  nationality: string;
  gender: string | null;
  birthDate: string;
  imageUrl: string | null;
  biography: string | null;
  controlledBy: "USER" | "AI";
  userId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PlayerEntryDriverProfile = {
  id: string;
  characterId: string;
  number: number | null;
  teamId: string | null;
  updatedAt: string;
};

export type PlayerEntryEntry = {
  id: string;
  seasonId: string;
  teamId: string | null;
  driverProfileId: string;
  role: "RACE_SEAT" | "RESERVE" | null;
  seat: number | null;
  number: number | null;
  status: "ACTIVE" | "AVAILABLE" | "INACTIVE" | "LEFT";
  provenance: "CANONICAL" | "IMPORTED" | "HYBRID" | "SIMULATED";
  createdAt: string;
  updatedAt: string;
  driverProfile: {
    id: string;
    characterId: string;
    number: number | null;
    teamId: string | null;
    character: {
      id: string;
      name: string;
      nationality: string;
      imageUrl: string | null;
    };
  };
  team: {
    id: string;
    name: string;
    shortName: string | null;
    color: string | null;
  } | null;
};

export type PlayerEntryCreateResult = {
  character: PlayerEntryCharacter;
  driverProfile: PlayerEntryDriverProfile;
  entry: PlayerEntryEntry;
  displaced: { entry: PlayerEntryEntry } | null;
};

export function getPlayerEntrySetup(
  seasonId?: string,
): Promise<PlayerEntrySetup> {
  const query = seasonId
    ? `?seasonId=${encodeURIComponent(seasonId)}`
    : "";
  return get<PlayerEntrySetup>(`/api/universe/player-entry/setup${query}`);
}

export function createPlayerEntry(
  input: PlayerEntryCreateInput,
): Promise<PlayerEntryCreateResult> {
  return post<PlayerEntryCreateResult>("/api/universe/player-entry", input);
}

export function formatSeatLabel(seat: 1 | 2): string {
  return seat === 1 ? "Primeiro piloto" : "Segundo piloto";
}