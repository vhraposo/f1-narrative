import { get, patch } from "./api";

export type RaceSession = "PRACTICE" | "QUALIFYING" | "RACE";

export type WorldState = {
  id: string;
  key: string;
  currentDate: string;
  currentSeasonId: string | null;
  currentRaceId: string | null;
  currentSession: RaceSession | null;
  createdAt: string;
  updatedAt: string;
};

export type UpdateWorldInput = {
  currentDate?: string | null;
  currentSeasonId?: string | null;
  currentRaceId?: string | null;
  currentSession?: RaceSession | null;
};

type WorldResponse = { world: WorldState };

export const RACE_SESSION_LABELS: Record<RaceSession, string> = {
  PRACTICE: "Treino",
  QUALIFYING: "Classificação",
  RACE: "Corrida",
};

export function getWorld(): Promise<WorldState> {
  return get<WorldResponse>("/api/world").then((r) => r.world);
}

export function updateWorld(input: UpdateWorldInput): Promise<WorldState> {
  return patch<WorldResponse>("/api/world", input).then((r) => r.world);
}