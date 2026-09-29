import { get, post } from "./api";

export type WeekendSessionName =
  | "PRACTICE"
  | "SPRINT_QUALIFYING"
  | "SPRINT"
  | "QUALIFYING"
  | "RACE";

export type WeekendSessionState = "COMPLETED" | "AVAILABLE" | "LOCKED";

export type WeekendSessionResult = {
  driverProfileId: string;
  driverName: string;
  teamName: string | null;
  position: number | null;
  status: string | null;
  points: number;
};

export type WeekendSessionView = {
  session: WeekendSessionName;
  state: WeekendSessionState;
  results: WeekendSessionResult[];
};

export type RaceWeekend = {
  raceId: string;
  name: string;
  round: number | null;
  date: string | null;
  status: string;
  effectiveSprint: boolean;
  sprintOverride: boolean | null;
  sprintExternal: boolean | null;
  currentSession: WeekendSessionName | null;
  nextSession: WeekendSessionName | null;
  sessions: WeekendSessionView[];
};

export function getRaceWeekend(raceId: string): Promise<RaceWeekend> {
  return get<{ weekend: RaceWeekend }>(`/api/races/${raceId}/weekend`).then(
    (response) => response.weekend,
  );
}

export function runRaceWeekendSession(
  raceId: string,
  session: WeekendSessionName,
  options: { rerun?: boolean } = {},
): Promise<RaceWeekend> {
  return post<{ weekend: RaceWeekend }>(
    `/api/races/${raceId}/weekend/sessions/${session}/run`,
    options,
  ).then((response) => response.weekend);
}
