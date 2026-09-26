import { get } from "./api";

export type NextRaceCircuit = {
  id: string;
  name: string;
  locality: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  lengthMeters: number | null;
  turns: number | null;
  layoutKey: string | null;
  layoutUrl: string | null;
  photoUrl: string | null;
};

export type NextRaceEntry = {
  raceId: string;
  name: string;
  round: number | null;
  date: string | null;
  status: string;
  circuit: NextRaceCircuit | null;
};

export type NextRaceResult = {
  season: { id: string; year: number; name: string | null } | null;
  totalRounds: number;
  current: NextRaceEntry | null;
  previous: NextRaceEntry | null;
  next: NextRaceEntry | null;
  reason: string | null;
};

export function getNextRace(): Promise<NextRaceResult> {
  return get<{ nextRace: NextRaceResult }>("/api/next-race").then(
    (response) => response.nextRace,
  );
}
