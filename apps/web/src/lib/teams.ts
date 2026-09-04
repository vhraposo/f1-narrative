import { get, post, patch, remove } from "./api";

export type Team = {
  id: string;
  name: string;
  shortName: string | null;
  color: string | null;
  userId: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateTeamInput = {
  name: string;
  shortName?: string | null;
  color?: string | null;
};

export type UpdateTeamInput = Partial<CreateTeamInput>;

type ListResponse = { teams: Team[] };
type ItemResponse = { team: Team };

export function listTeams(): Promise<Team[]> {
  return get<ListResponse>("/api/teams").then((r) => r.teams);
}

export function getTeam(id: string): Promise<Team> {
  return get<ItemResponse>(`/api/teams/${id}`).then((r) => r.team);
}

export function createTeam(input: CreateTeamInput): Promise<Team> {
  return post<ItemResponse>("/api/teams", input).then((r) => r.team);
}

export function updateTeam(
  id: string,
  input: UpdateTeamInput,
): Promise<Team> {
  return patch<ItemResponse>(`/api/teams/${id}`, input).then((r) => r.team);
}

export function deleteTeam(id: string): Promise<void> {
  return remove<void>(`/api/teams/${id}`);
}
