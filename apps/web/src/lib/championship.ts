import { get, post, patch, remove } from "./api";

export type DriverRef = {
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

export type Season = {
  id: string;
  year: number;
  name: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type Race = {
  id: string;
  seasonId: string;
  name: string;
  circuit: string | null;
  country: string | null;
  date: string | null;
  round: number | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type RaceResult = {
  id: string;
  raceId: string;
  driverProfileId: string;
  position: number | null;
  points: number;
  grid: number | null;
  fastestLap: boolean;
  status: string | null;
  createdAt: string;
  updatedAt: string;
  driverProfile: DriverRef;
};

export type ChampionshipStanding = {
  id: string;
  seasonId: string;
  driverProfileId: string;
  points: number;
  position: number | null;
  wins: number;
  podiums: number;
  createdAt: string;
  updatedAt: string;
  driverProfile: DriverRef;
};

export type CreateSeasonInput = {
  year: number;
  name?: string | null;
  status?: string;
};
export type UpdateSeasonInput = {
  name?: string | null;
  status?: string;
};

export type CreateRaceInput = {
  name: string;
  circuit?: string | null;
  country?: string | null;
  date?: string | null;
  round?: number | null;
  status?: string;
};
export type UpdateRaceInput = Partial<CreateRaceInput>;

export type CreateRaceResultInput = {
  driverProfileId: string;
  position?: number | null;
  points?: number;
  grid?: number | null;
  fastestLap?: boolean;
  status?: string | null;
};
export type UpdateRaceResultInput = Partial<CreateRaceResultInput>;

export type CreateStandingInput = {
  driverProfileId: string;
  points?: number;
  position?: number | null;
  wins?: number;
  podiums?: number;
};
export type UpdateStandingInput = Partial<CreateStandingInput>;

type SeasonsResponse = { seasons: Season[] };
type SeasonResponse = { season: Season };
type RacesResponse = { races: Race[] };
type RaceResponse = { race: Race };
type ResultsResponse = { results: RaceResult[] };
type ResultResponse = { result: RaceResult };
type StandingsResponse = { standings: ChampionshipStanding[] };
type StandingResponse = { standing: ChampionshipStanding };

export function listSeasons(): Promise<Season[]> {
  return get<SeasonsResponse>("/api/seasons").then((r) => r.seasons);
}

export function createSeason(input: CreateSeasonInput): Promise<Season> {
  return post<SeasonResponse>("/api/seasons", input).then((r) => r.season);
}

export function updateSeason(
  id: string,
  input: UpdateSeasonInput,
): Promise<Season> {
  return patch<SeasonResponse>(`/api/seasons/${id}`, input).then(
    (r) => r.season,
  );
}

export function deleteSeason(id: string): Promise<void> {
  return remove<void>(`/api/seasons/${id}`);
}

export function listRaces(seasonId: string): Promise<Race[]> {
  return get<RacesResponse>(`/api/seasons/${seasonId}/races`).then(
    (r) => r.races,
  );
}

export function createRace(
  seasonId: string,
  input: CreateRaceInput,
): Promise<Race> {
  return post<RaceResponse>(`/api/seasons/${seasonId}/races`, input).then(
    (r) => r.race,
  );
}

export function updateRace(
  id: string,
  input: UpdateRaceInput,
): Promise<Race> {
  return patch<RaceResponse>(`/api/races/${id}`, input).then((r) => r.race);
}

export function deleteRace(id: string): Promise<void> {
  return remove<void>(`/api/races/${id}`);
}

export function listResults(raceId: string): Promise<RaceResult[]> {
  return get<ResultsResponse>(`/api/races/${raceId}/results`).then(
    (r) => r.results,
  );
}

export function createResult(
  raceId: string,
  input: CreateRaceResultInput,
): Promise<RaceResult> {
  return post<ResultResponse>(`/api/races/${raceId}/results`, input).then(
    (r) => r.result,
  );
}

export function updateResult(
  id: string,
  input: UpdateRaceResultInput,
): Promise<RaceResult> {
  return patch<ResultResponse>(`/api/race-results/${id}`, input).then(
    (r) => r.result,
  );
}

export function deleteResult(id: string): Promise<void> {
  return remove<void>(`/api/race-results/${id}`);
}

export function listStandings(seasonId: string): Promise<ChampionshipStanding[]> {
  return get<StandingsResponse>(`/api/seasons/${seasonId}/standings`).then(
    (r) => r.standings,
  );
}

export function createStanding(
  seasonId: string,
  input: CreateStandingInput,
): Promise<ChampionshipStanding> {
  return post<StandingResponse>(`/api/seasons/${seasonId}/standings`, input).then(
    (r) => r.standing,
  );
}

export function updateStanding(
  id: string,
  input: UpdateStandingInput,
): Promise<ChampionshipStanding> {
  return patch<StandingResponse>(`/api/championship-standings/${id}`, input).then(
    (r) => r.standing,
  );
}

export function deleteStanding(id: string): Promise<void> {
  return remove<void>(`/api/championship-standings/${id}`);
}
