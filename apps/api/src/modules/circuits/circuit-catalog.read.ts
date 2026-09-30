import type { Prisma } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";

export type CircuitLayoutView = {
  readonly key: string | null;
  readonly url: string | null;
  readonly source: string | null;
  readonly available: boolean;
};

export type CircuitPhotoView = {
  readonly url: string;
  readonly source: string;
  readonly sourceUrl: string | null;
  readonly author: string | null;
  readonly license: string;
  readonly licenseUrl: string | null;
  readonly attribution: string | null;
};

export type CircuitMediaView = {
  readonly layout: CircuitLayoutView;
  readonly photo: CircuitPhotoView | null;
  readonly attributionRequired: boolean;
};

export type CircuitWinnerEntry = {
  readonly externalDriverId: string;
  readonly name: string;
  readonly wins: number;
};

export type CircuitRecentWinnerEntry = {
  readonly externalRaceId: string;
  readonly raceName: string | null;
  readonly seasonYear: number;
  readonly round: number;
  readonly date: Date | null;
  readonly externalDriverId: string;
  readonly driverName: string;
};

export type CircuitRaceLapEntry = {
  readonly externalDriverId: string;
  readonly driverName: string;
  readonly time: string;
  readonly seasonYear: number;
  readonly round: number;
  readonly raceName: string | null;
};

export type CircuitListItem = {
  readonly id: string;
  readonly name: string;
  readonly locality: string | null;
  readonly country: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly lengthMeters: number | null;
  readonly turns: number | null;
  readonly direction: string | null;
  readonly firstRaceYear: number | null;
  readonly lastRaceYear: number | null;
  readonly raceCount: number;
  readonly media: CircuitMediaView;
};

export type CircuitDetail = CircuitListItem & {
  readonly source: string;
  readonly sourceUrl: string | null;
  readonly topWinners: readonly CircuitWinnerEntry[];
  readonly recentWinners: readonly CircuitRecentWinnerEntry[];
  readonly fastestRaceLap: CircuitRaceLapEntry | null;
  readonly officialLapRecord: {
    readonly available: false;
    readonly reason: "LAP_RECORD_SOURCE_UNAVAILABLE";
  };
};

export type CircuitListResult = {
  readonly circuits: readonly CircuitListItem[];
  readonly total: number;
};

const SOURCE_RECORD_KEY_LIMIT = 40;

function sourceRecordString(
  record: Prisma.JsonValue | null,
  key: string,
): string | null {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

// Abstração de mídia de circuito: somente fontes licenciadas/configuradas.
// Sem dataset F1DB (layouts) ou foto licenciada resolvida no sourceRecord,
// devolve indisponível — nunca inventa URL nem usa imagem sem licença.
export function resolveCircuitMedia(input: {
  readonly layoutKey: string | null;
  readonly sourceRecord: Prisma.JsonValue | null;
}): CircuitMediaView {
  const photoUrl = sourceRecordString(input.sourceRecord, "photoUrl");
  const photoLicense = sourceRecordString(input.sourceRecord, "photoLicense");
  const photo = photoUrl && photoLicense
    ? {
        url: photoUrl,
        source: sourceRecordString(input.sourceRecord, "photoSource") ?? "UNKNOWN",
        sourceUrl: sourceRecordString(input.sourceRecord, "photoSourceUrl"),
        author: sourceRecordString(input.sourceRecord, "photoAuthor"),
        license: photoLicense,
        licenseUrl: sourceRecordString(input.sourceRecord, "photoLicenseUrl"),
        attribution: sourceRecordString(input.sourceRecord, "photoAttribution"),
      }
    : null;
  const layoutKey = input.layoutKey?.slice(0, SOURCE_RECORD_KEY_LIMIT) ?? null;
  const layoutUrl = sourceRecordString(input.sourceRecord, "layoutUrl");
  const layout = {
    key: layoutKey,
    url: layoutUrl,
    source: layoutUrl ? (sourceRecordString(input.sourceRecord, "layoutSource") ?? "F1DB") : null,
    available: layoutUrl !== null,
  };
  return {
    layout,
    photo,
    attributionRequired: photo !== null,
  };
}

type CircuitRow = {
  id: string;
  name: string;
  locality: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  lengthMeters: number | null;
  turns: number | null;
  direction: string | null;
  layoutKey: string | null;
  sourceRecord: Prisma.JsonValue | null;
};

function toListItem(
  circuit: CircuitRow,
  stats: { firstRaceYear: number | null; lastRaceYear: number | null; raceCount: number },
): CircuitListItem {
  return {
    id: circuit.id,
    name: circuit.name,
    locality: circuit.locality,
    country: circuit.country,
    latitude: circuit.latitude,
    longitude: circuit.longitude,
    lengthMeters: circuit.lengthMeters,
    turns: circuit.turns,
    direction: circuit.direction,
    firstRaceYear: stats.firstRaceYear,
    lastRaceYear: stats.lastRaceYear,
    raceCount: stats.raceCount,
    media: resolveCircuitMedia({
      layoutKey: circuit.layoutKey,
      sourceRecord: circuit.sourceRecord,
    }),
  };
}

async function raceStatsByCircuit(
  circuitIds: readonly string[],
): Promise<Map<string, { firstRaceYear: number | null; lastRaceYear: number | null; raceCount: number }>> {
  const map = new Map<string, { firstRaceYear: number | null; lastRaceYear: number | null; raceCount: number }>();
  if (circuitIds.length === 0) return map;
  const grouped = await prisma.externalRace.groupBy({
    by: ["externalCircuitId"],
    where: { externalCircuitId: { in: [...circuitIds] } },
    _min: { seasonYear: true },
    _max: { seasonYear: true },
    _count: { _all: true },
  });
  for (const row of grouped) {
    if (!row.externalCircuitId) continue;
    map.set(row.externalCircuitId, {
      firstRaceYear: row._min.seasonYear ?? null,
      lastRaceYear: row._max.seasonYear ?? null,
      raceCount: row._count._all,
    });
  }
  return map;
}

export async function listExternalCircuits(options: {
  readonly search?: string | null;
  readonly limit?: number;
  readonly offset?: number;
} = {}): Promise<CircuitListResult> {
  const search = options.search?.trim() ?? "";
  const limit = Math.min(Math.max(options.limit ?? 60, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const where: Prisma.ExternalCircuitWhereInput =
    search.length > 0
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { country: { contains: search, mode: "insensitive" } },
            { locality: { contains: search, mode: "insensitive" } },
          ],
        }
      : {};
  const [total, rows] = await Promise.all([
    prisma.externalCircuit.count({ where }),
    prisma.externalCircuit.findMany({
      where,
      orderBy: [{ name: "asc" }],
      take: limit,
      skip: offset,
      select: {
        id: true,
        name: true,
        locality: true,
        country: true,
        latitude: true,
        longitude: true,
        lengthMeters: true,
        turns: true,
        direction: true,
        layoutKey: true,
        sourceRecord: true,
      },
    }),
  ]);
  const stats = await raceStatsByCircuit(rows.map((row) => row.id));
  return {
    circuits: rows.map((row) =>
      toListItem(row, stats.get(row.id) ?? { firstRaceYear: null, lastRaceYear: null, raceCount: 0 }),
    ),
    total,
  };
}

async function topWinnersForCircuit(
  externalCircuitId: string,
  limit = 10,
): Promise<readonly CircuitWinnerEntry[]> {
  const grouped = await prisma.externalResult.groupBy({
    by: ["externalDriverId"],
    where: { position: 1, externalRace: { externalCircuitId } },
    _count: { _all: true },
  });
  if (grouped.length === 0) return [];
  const drivers = await prisma.externalDriver.findMany({
    where: { id: { in: grouped.map((row) => row.externalDriverId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(drivers.map((driver) => [driver.id, driver.name]));
  return grouped
    .map((row) => ({
      externalDriverId: row.externalDriverId,
      name: nameById.get(row.externalDriverId) ?? "—",
      wins: row._count._all,
    }))
    .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name))
    .slice(0, limit);
}

async function recentWinnersForCircuit(
  externalCircuitId: string,
  limit = 5,
): Promise<readonly CircuitRecentWinnerEntry[]> {
  const rows = await prisma.externalResult.findMany({
    where: { position: 1, externalRace: { externalCircuitId } },
    orderBy: [
      { externalRace: { seasonYear: "desc" } },
      { externalRace: { round: "desc" } },
    ],
    take: limit,
    select: {
      externalDriverId: true,
      externalDriver: { select: { name: true } },
      externalRace: {
        select: { id: true, name: true, grandPrix: true, seasonYear: true, round: true, date: true },
      },
    },
  });
  return rows.map((row) => ({
    externalRaceId: row.externalRace.id,
    raceName: row.externalRace.name ?? row.externalRace.grandPrix,
    seasonYear: row.externalRace.seasonYear,
    round: row.externalRace.round,
    date: row.externalRace.date,
    externalDriverId: row.externalDriverId,
    driverName: row.externalDriver.name,
  }));
}

async function fastestRaceLapForCircuit(
  externalCircuitId: string,
): Promise<CircuitRaceLapEntry | null> {
  const row = await prisma.externalResult.findFirst({
    where: {
      fastestLap: true,
      fastestLapTime: { not: null },
      externalRace: { externalCircuitId },
    },
    orderBy: [
      { externalRace: { seasonYear: "desc" } },
      { externalRace: { round: "desc" } },
    ],
    select: {
      externalDriverId: true,
      fastestLapTime: true,
      externalDriver: { select: { name: true } },
      externalRace: {
        select: { name: true, grandPrix: true, seasonYear: true, round: true },
      },
    },
  });
  if (!row || !row.fastestLapTime) return null;
  return {
    externalDriverId: row.externalDriverId,
    driverName: row.externalDriver.name,
    time: row.fastestLapTime,
    seasonYear: row.externalRace.seasonYear,
    round: row.externalRace.round,
    raceName: row.externalRace.name ?? row.externalRace.grandPrix,
  };
}

export async function getExternalCircuitDetail(
  circuitId: string,
): Promise<CircuitDetail | null> {
  const circuit = await prisma.externalCircuit.findUnique({
    where: { id: circuitId },
    select: {
      id: true,
      name: true,
      source: true,
      url: true,
      locality: true,
      country: true,
      latitude: true,
      longitude: true,
      lengthMeters: true,
      turns: true,
      direction: true,
      layoutKey: true,
      sourceRecord: true,
    },
  });
  if (!circuit) return null;

  const [stats, topWinners, recentWinners, fastestRaceLap] = await Promise.all([
    raceStatsByCircuit([circuit.id]),
    topWinnersForCircuit(circuit.id),
    recentWinnersForCircuit(circuit.id),
    fastestRaceLapForCircuit(circuit.id),
  ]);

  return {
    ...toListItem(circuit, stats.get(circuit.id) ?? {
      firstRaceYear: null,
      lastRaceYear: null,
      raceCount: 0,
    }),
    source: circuit.source,
    sourceUrl: circuit.url,
    topWinners,
    recentWinners,
    fastestRaceLap,
    officialLapRecord: {
      available: false,
      reason: "LAP_RECORD_SOURCE_UNAVAILABLE",
    },
  };
}
