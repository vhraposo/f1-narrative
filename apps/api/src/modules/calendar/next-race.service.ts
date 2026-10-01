import { prisma } from "../../infrastructure/database/prisma.js";
import { getF1dbCircuitInfo, resolveF1dbCircuitId } from "../f1db/f1db.circuits.js";

const WORLD_KEY = "default";

export interface NextRaceCircuit extends CircuitBase {
  fullName: string | null;
  type: string | null;
  direction: string | null;
  layoutSource: string | null;
  layoutAttribution: string | null;
  lengthSource: "F1DB" | "UNIVERSE" | null;
}

type CircuitBase = {
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

export interface NextRaceEntry {
  raceId: string;
  name: string;
  round: number | null;
  date: Date | null;
  status: string;
  hasSprint: boolean;
  circuit: NextRaceCircuit | null;
}

export interface NextRaceResult {
  season: { id: string; year: number; name: string | null } | null;
  totalRounds: number;
  current: NextRaceEntry | null;
  previous: NextRaceEntry | null;
  next: NextRaceEntry | null;
  reason: string | null;
}

const raceSelect = {
  id: true,
  name: true,
  round: true,
  date: true,
  status: true,
  sprintOverride: true,
  sprintExternal: true,
  circuitRef: {
    select: {
      id: true,
      name: true,
      locality: true,
      country: true,
      latitude: true,
      longitude: true,
      lengthMeters: true,
      turns: true,
      layoutKey: true,
      layoutUrl: true,
      photoUrl: true,
    },
  },
} as const;

type RaceRow = {
  id: string;
  name: string;
  round: number | null;
  date: Date | null;
  status: string;
  sprintOverride: boolean | null;
  sprintExternal: boolean | null;
  circuitRef: CircuitBase | null;
};

function enrichCircuit(circuit: CircuitBase | null): NextRaceCircuit | null {
  if (!circuit) return null;
  const f1dbId = resolveF1dbCircuitId({ externalId: null, name: circuit.name });
  const info = f1dbId ? getF1dbCircuitInfo(f1dbId) : null;
  if (!info) {
    return {
      ...circuit,
      fullName: null,
      type: null,
      direction: null,
      layoutSource: null,
      layoutAttribution: null,
      lengthSource: circuit.lengthMeters !== null ? "UNIVERSE" : null,
    };
  }
  return {
    ...circuit,
    fullName: info.circuit.fullName,
    type: info.circuit.type,
    direction: info.circuit.direction,
    locality: circuit.locality ?? info.circuit.placeName ?? null,
    latitude: circuit.latitude ?? info.circuit.latitude,
    longitude: circuit.longitude ?? info.circuit.longitude,
    lengthMeters:
      circuit.lengthMeters ??
      (info.circuit.lengthKm !== null ? Math.round(info.circuit.lengthKm * 1000) : null),
    turns: circuit.turns ?? info.circuit.turns,
    layoutKey: info.effectiveLayout?.id ?? circuit.layoutKey,
    layoutUrl: `/api/external/circuits/f1db/${info.circuit.id}/layout.svg`,
    layoutSource: "f1db-circuits-svg",
    layoutAttribution: "f1db-circuits-svg by ROY Jules - CC BY 4.0",
    lengthSource:
      circuit.lengthMeters !== null
        ? "UNIVERSE"
        : info.circuit.lengthKm !== null
          ? "F1DB"
          : null,
  };
}

function toEntry(race: RaceRow): NextRaceEntry {
  return {
    raceId: race.id,
    name: race.name,
    round: race.round,
    date: race.date,
    status: race.status,
    hasSprint: race.sprintOverride ?? race.sprintExternal ?? false,
    circuit: enrichCircuit(race.circuitRef),
  };
}

export async function getNextRaceForUniverse(
  universeId: string,
): Promise<NextRaceResult> {
  const world = await prisma.worldState.findUnique({
    where: { universeId_key: { universeId, key: WORLD_KEY } },
    select: { currentSeasonId: true, currentRaceId: true, currentDate: true },
  });

  const seasonId = world?.currentSeasonId ?? null;
  if (!seasonId) {
    return {
      season: null,
      totalRounds: 0,
      current: null,
      previous: null,
      next: null,
      reason: "NO_CURRENT_SEASON",
    };
  }

  const season = await prisma.season.findFirst({
    where: { id: seasonId, universeId },
    select: { id: true, year: true, name: true },
  });
  if (!season) {
    return {
      season: null,
      totalRounds: 0,
      current: null,
      previous: null,
      next: null,
      reason: "NO_CURRENT_SEASON",
    };
  }

  const races = (await prisma.race.findMany({
    where: { seasonId },
    orderBy: [{ round: "asc" }, { date: "asc" }, { id: "asc" }],
    select: raceSelect,
  })) as RaceRow[];

  const totalRounds = races.length;
  const currentIndex = world?.currentRaceId
    ? races.findIndex((race) => race.id === world.currentRaceId)
    : -1;

  const current = currentIndex >= 0 ? toEntry(races[currentIndex]) : null;

  let previous: NextRaceEntry | null = null;
  for (let index = currentIndex >= 0 ? currentIndex - 1 : races.length - 1; index >= 0; index -= 1) {
    if (races[index].status === "FINISHED") {
      previous = toEntry(races[index]);
      break;
    }
  }

  let next: NextRaceEntry | null = null;
  const start = currentIndex >= 0 ? currentIndex + 1 : 0;
  for (let index = start; index < races.length; index += 1) {
    if (races[index].status !== "FINISHED") {
      next = toEntry(races[index]);
      break;
    }
  }
  if (!next && currentIndex < 0) {
    for (const race of races) {
      if (race.status !== "FINISHED") {
        next = toEntry(race);
        break;
      }
    }
  }

  const reason =
    next === null ? (totalRounds === 0 ? "NO_RACES" : "SEASON_FINISHED") : null;

  return { season, totalRounds, current, previous, next, reason };
}
