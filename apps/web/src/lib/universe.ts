import { get, post } from "./api";

export type UniverseSeatStatus =
  | "MATCH"
  | "DIVERGENCE"
  | "SOURCE_ONLY"
  | "UNIVERSE_ONLY";
export type UniverseTeamStatus = "MATCH" | "DIVERGENT";

export type UniverseSourceSeat = {
  externalDriverId: string;
  name: string;
  number: number | null;
};

export type UniverseSeat = {
  seat: 1 | 2;
  status: UniverseSeatStatus;
  source: UniverseSourceSeat | null;
  universe: {
    entryId: string;
    driverProfileId: string;
    characterId: string;
    characterName: string;
    provenance: string;
  } | null;
  canRestore: boolean;
};

export type UniverseTeam = {
  id: string;
  name: string;
  shortName: string | null;
  color: string | null;
  externalTeamId: string;
  status: UniverseTeamStatus;
  seats: UniverseSeat[];
};

export type RosterComparison = {
  season: { id: string; year: number; name: string | null; status: string };
  comparable: boolean;
  teams: UniverseTeam[];
};

export type KeepUniverseResult = {
  team: UniverseTeam;
};

export type RestoreSourceResult = {
  team: UniverseTeam;
  restored: number;
};

export function getRosterComparison(seasonId: string): Promise<RosterComparison> {
  return get<RosterComparison>(
    `/api/universe/roster-comparison/${encodeURIComponent(seasonId)}`,
  );
}

export function keepUniverseConfig(input: {
  seasonId: string;
  teamId: string;
}): Promise<KeepUniverseResult> {
  return post<KeepUniverseResult>(
    `/api/universe/roster-comparison/${encodeURIComponent(input.seasonId)}/keep-universe`,
    { teamId: input.teamId },
  );
}

export function restoreSourceConfig(input: {
  seasonId: string;
  teamId: string;
}): Promise<RestoreSourceResult> {
  return post<RestoreSourceResult>(
    `/api/universe/roster-comparison/${encodeURIComponent(input.seasonId)}/restore-source`,
    { teamId: input.teamId },
  );
}