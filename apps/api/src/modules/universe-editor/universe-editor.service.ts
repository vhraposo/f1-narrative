import { prisma } from "../../infrastructure/database/prisma.js";
import { rosterService } from "../roster/roster.service.js";
import { JOLPICA_SOURCE } from "../external-sync/jolpica.service.js";

export class UniverseEditorError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 409,
  ) {
    super(message);
    this.name = "UniverseEditorError";
  }
}

type SeatStatus = "MATCH" | "DIVERGENCE" | "SOURCE_ONLY" | "UNIVERSE_ONLY";
type TeamComparisonStatus = "MATCH" | "DIVERGENT";

type SourceSeat = {
  externalDriverSeasonId: string;
  externalDriverId: string;
  name: string;
  number: number | null;
};

type UniverseSeat = {
  id: string;
  driverProfileId: string;
  seat: number | null;
  provenance: string;
  driverProfile: {
    character: { id: string; name: string };
  };
};

type DriverBinding = {
  seasonId: string;
  driverProfileId: string;
};

type Divergence = {
  kind: string;
  origin: string | null;
  eventId: string;
  occurredAt: string;
  summary: string;
  readOnly: true;
};

type SeatComparison = {
  seat: 1 | 2;
  status: SeatStatus;
  source: { externalDriverId: string; name: string; number: number | null } | null;
  universe: {
    entryId: string;
    driverProfileId: string;
    characterId: string;
    characterName: string;
    provenance: string;
  } | null;
  canRestore: boolean;
  divergence: Divergence | null;
};

type TeamComparison = {
  id: string;
  name: string;
  shortName: string | null;
  color: string | null;
  externalTeamId: string;
  status: TeamComparisonStatus;
  seats: SeatComparison[];
};

type ComparisonResponse = {
  season: { id: string; year: number; name: string | null; status: string };
  comparable: boolean;
  teams: TeamComparison[];
};

type TeamInfo = {
  id: string;
  name: string;
  shortName: string | null;
  color: string | null;
  extTeamId: string;
  extTeamExternalId: string;
};

async function resolveComparableSeason(seasonId: string) {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    include: {
      externalSeasonBindings: {
        where: { confidence: "CONFIRMED" },
        take: 1,
        include: { externalSeason: { select: { id: true, year: true } } },
      },
    },
  });
  if (!season) {
    throw new UniverseEditorError("SEASON_NOT_FOUND", "Temporada não encontrada", 404);
  }
  const binding = season.externalSeasonBindings[0] ?? null;
  return {
    season: { id: season.id, year: season.year, name: season.name, status: season.status },
    sourceYear: binding?.externalSeason.year ?? null,
    comparable: binding !== null,
  };
}

async function resolveTeam(userId: string, teamId: string): Promise<TeamInfo> {
  const team = await prisma.team.findFirst({
    where: { id: teamId, userId },
    include: {
      externalTeamBindings: {
        where: { confidence: "CONFIRMED" },
        take: 1,
        include: { externalTeam: { select: { id: true, externalId: true } } },
      },
    },
  });
  if (!team) {
    throw new UniverseEditorError("TEAM_NOT_FOUND", "Equipe não encontrada", 404);
  }
  const binding = team.externalTeamBindings[0] ?? null;
  if (!binding) {
    throw new UniverseEditorError("TEAM_NOT_MIRRORED", "Equipe não possui fonte externa vinculada", 409);
  }
  return {
    id: team.id,
    name: team.name,
    shortName: team.shortName,
    color: team.color,
    extTeamId: binding.externalTeam.id,
    extTeamExternalId: binding.externalTeam.externalId,
  };
}

async function resolveSourceSeats(extTeamExternalId: string, sourceYear: number): Promise<SourceSeat[]> {
  const rows = await prisma.externalDriverSeason.findMany({
    where: {
      source: JOLPICA_SOURCE,
      seasonYear: sourceYear,
      teamExternalId: extTeamExternalId,
    },
    include: {
      externalDriver: {
        select: { id: true, name: true, number: true },
      },
    },
  });
  const nonReserve = rows.filter((r) => r.role !== "RESERVE");
  nonReserve.sort((a, b) => {
    const acn = a.number ?? a.externalDriver.number ?? 9999;
    const bcn = b.number ?? b.externalDriver.number ?? 9999;
    if (acn !== bcn) return acn - bcn;
    return a.externalDriver.name.localeCompare(b.externalDriver.name);
  });
  return nonReserve.slice(0, 2).map((r) => ({
    externalDriverSeasonId: r.id,
    externalDriverId: r.externalDriver.id,
    name: r.externalDriver.name,
    number: r.number ?? null,
  }));
}

async function resolveDriverBindingMap(sourceYear: number): Promise<Map<string, DriverBinding>> {
  const bindings = await prisma.externalBindingDriverSeason.findMany({
    where: {
      confidence: "CONFIRMED",
      externalDriverSeason: { source: JOLPICA_SOURCE, seasonYear: sourceYear },
    },
    include: {
      externalDriverSeason: { select: { id: true } },
      seasonDriverEntry: { select: { seasonId: true, driverProfileId: true } },
    },
  });
  const map = new Map<string, DriverBinding>();
  for (const b of bindings) {
    map.set(b.externalDriverSeasonId, {
      seasonId: b.seasonDriverEntry.seasonId,
      driverProfileId: b.seasonDriverEntry.driverProfileId,
    });
  }
  return map;
}

async function resolveUniverseSeats(seasonId: string, teamId: string): Promise<Map<number, UniverseSeat>> {
  const entries = await prisma.seasonDriverEntry.findMany({
    where: { seasonId, teamId, role: "RACE_SEAT", status: "ACTIVE" },
    select: {
      id: true,
      driverProfileId: true,
      seat: true,
      provenance: true,
      driverProfile: {
        select: {
          character: { select: { id: true, name: true } },
        },
      },
    },
  });
  const map = new Map<number, UniverseSeat>();
  for (const e of entries) {
    if (e.seat === 1 || e.seat === 2) map.set(e.seat, e);
  }
  return map;
}

function buildSeatComparison(
  seat: 1 | 2,
  source: SourceSeat | null,
  universe: UniverseSeat | null,
  binding: DriverBinding | null | undefined,
  seasonId: string,
): SeatComparison {
  let status: SeatStatus;
  if (source && universe) {
    const bound = binding?.seasonId === seasonId && binding.driverProfileId === universe.driverProfileId;
    status = bound ? "MATCH" : "DIVERGENCE";
  } else if (source) {
    status = "SOURCE_ONLY";
  } else if (universe) {
    status = "UNIVERSE_ONLY";
  } else {
    status = "MATCH";
  }

  return {
    seat,
    status,
    source: source ? { externalDriverId: source.externalDriverId, name: source.name, number: source.number } : null,
    universe: universe
      ? {
          entryId: universe.id,
          driverProfileId: universe.driverProfileId,
          characterId: universe.driverProfile.character.id,
          characterName: universe.driverProfile.character.name,
          provenance: universe.provenance,
        }
      : null,
    canRestore: source !== null && binding !== null && binding !== undefined,
    divergence: null,
  };
}

const DIVERGENCE_KINDS = new Set(["CREATED", "SEATED", "HIRED", "PROMOTED"]);

const DIVERGENCE_SUMMARIES: Record<string, string> = {
  CREATED: "Piloto foi inserido no grid do universo",
  SEATED: "Piloto foi designado ao assento no universo",
  HIRED: "Piloto foi contratado pelo time do universo",
  PROMOTED: "Reserva foi promovida ao assento de corrida",
  RELEASED: "Piloto foi liberado para outra equipe",
  DISPLACED: "Piloto perdeu o assento para outro piloto",
  STATUS_CHANGED: "Estado do piloto atualizado no universo",
};

function divergenceOriginFor(kind: string, provenance: string): string | null {
  if (kind === "HIRED") return "ROSTER_HIRE";
  if (kind === "PROMOTED") return "ROSTER_PROMOTION";
  if (kind === "RELEASED") return "ROSTER_RELEASE";
  if (kind === "CREATED" && provenance === "IMPORTED") return "INITIALIZATION";
  return null;
}

function divergenceOf(
  events: Array<{ id: string; kind: string; createdAt: Date }>,
  provenance: string,
): Divergence | null {
  const event = events.find((e) => DIVERGENCE_KINDS.has(e.kind));
  if (!event) return null;
  return {
    kind: event.kind,
    origin: divergenceOriginFor(event.kind, provenance),
    eventId: event.id,
    occurredAt: event.createdAt.toISOString(),
    summary: DIVERGENCE_SUMMARIES[event.kind] ?? "Registro histórico no universo",
    readOnly: true,
  };
}

async function buildTeamComparison(
  seasonId: string,
  sourceYear: number,
  teamId: string,
  teamInfo: TeamInfo,
  driverBindingMap: Map<string, DriverBinding>,
): Promise<TeamComparison> {
  const [sourceSeats, universeSeats] = await Promise.all([
    resolveSourceSeats(teamInfo.extTeamExternalId, sourceYear),
    resolveUniverseSeats(seasonId, teamId),
  ]);

  const entryIds = [...universeSeats.values()].map((u) => u.id);
  const eventsByEntry = new Map<
    string,
    Array<{ id: string; kind: string; createdAt: Date }>
  >();
  if (entryIds.length > 0) {
    const rows = await prisma.driverEntryEvent.findMany({
      where: { entryId: { in: entryIds } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, entryId: true, kind: true, createdAt: true },
    });
    for (const row of rows) {
      const list = eventsByEntry.get(row.entryId) ?? [];
      list.push(row);
      eventsByEntry.set(row.entryId, list);
    }
  }

  const sourceForSeat = (seat: 1 | 2): SourceSeat | null => {
    const idx = seat - 1;
    return sourceSeats[idx] ?? null;
  };

  const seats: SeatComparison[] = [1, 2].map((seatNum) => {
    const seat = seatNum as 1 | 2;
    const sourceSeat = sourceForSeat(seat);
    const universeEntry = universeSeats.get(seat) ?? null;
    const binding = sourceSeat ? (driverBindingMap.get(sourceSeat.externalDriverSeasonId) ?? null) : undefined;
    const comparison = buildSeatComparison(seat, sourceSeat, universeEntry, binding, seasonId);
    if (
      (comparison.status === "DIVERGENCE" || comparison.status === "UNIVERSE_ONLY") &&
      comparison.universe
    ) {
      comparison.divergence = divergenceOf(
        eventsByEntry.get(comparison.universe.entryId) ?? [],
        comparison.universe.provenance,
      );
    }
    return comparison;
  });

  const status: TeamComparisonStatus = seats.some((s) => s.status !== "MATCH") ? "DIVERGENT" : "MATCH";

  return {
    id: teamInfo.id,
    name: teamInfo.name,
    shortName: teamInfo.shortName,
    color: teamInfo.color,
    externalTeamId: teamInfo.extTeamExternalId,
    status,
    seats,
  };
}

export const universeEditorService = {
  async comparison(userId: string, seasonId: string): Promise<ComparisonResponse> {
    const { season, sourceYear, comparable } = await resolveComparableSeason(seasonId);
    if (!comparable || sourceYear === null) {
      return { season, comparable: false, teams: [] };
    }

    const teams = await prisma.team.findMany({
      where: {
        userId,
        externalTeamBindings: { some: { confidence: "CONFIRMED" } },
      },
      include: {
        externalTeamBindings: {
          where: { confidence: "CONFIRMED" },
          take: 1,
          include: { externalTeam: { select: { id: true, externalId: true } } },
        },
      },
    });

    if (teams.length === 0) {
      return { season, comparable: true, teams: [] };
    }

    const driverBindingMap = await resolveDriverBindingMap(sourceYear);

    const teamComparisons: TeamComparison[] = [];
    for (const t of teams) {
      const binding = t.externalTeamBindings[0];
      if (!binding) continue;
      teamComparisons.push(
        await buildTeamComparison(seasonId, sourceYear, t.id, {
          id: t.id,
          name: t.name,
          shortName: t.shortName,
          color: t.color,
          extTeamId: binding.externalTeam.id,
          extTeamExternalId: binding.externalTeam.externalId,
        }, driverBindingMap),
      );
    }

    return { season, comparable: true, teams: teamComparisons };
  },

  async keepUniverse(userId: string, teamId: string, seasonId: string) {
    const { comparable, sourceYear } = await resolveComparableSeason(seasonId);
    if (!comparable || sourceYear === null) {
      throw new UniverseEditorError("SEASON_NOT_BOUND", "Temporada não possui fonte externa vinculada", 409);
    }
    const teamInfo = await resolveTeam(userId, teamId);
    const driverBindingMap = await resolveDriverBindingMap(sourceYear);
    const team = await buildTeamComparison(seasonId, sourceYear, teamId, teamInfo, driverBindingMap);
    return { team };
  },

  async restoreSource(userId: string, teamId: string, seasonId: string) {
    const { comparable, sourceYear } = await resolveComparableSeason(seasonId);
    if (!comparable || sourceYear === null) {
      throw new UniverseEditorError("SEASON_NOT_BOUND", "Temporada não possui fonte externa vinculada", 409);
    }
    const teamInfo = await resolveTeam(userId, teamId);

    const sourceSeats = await resolveSourceSeats(teamInfo.extTeamExternalId, sourceYear);
    if (sourceSeats.length === 0) {
      const result = await this.keepUniverse(userId, teamId, seasonId);
      return { team: result.team, restored: 0 };
    }

    const driverBindingMap = await resolveDriverBindingMap(sourceYear);
    const universeSeats = await resolveUniverseSeats(seasonId, teamId);

    const toRestore: Array<{ seat: 1 | 2; driverProfileId: string; number: number | null }> = [];

    for (let i = 0; i < sourceSeats.length; i++) {
      const seat = (i + 1) as 1 | 2;
      const src = sourceSeats[i];
      const binding = driverBindingMap.get(src.externalDriverSeasonId);
      if (!binding || binding.seasonId !== seasonId) continue;

      const entry = universeSeats.get(seat);
      if (entry && entry.driverProfileId === binding.driverProfileId) continue;

      toRestore.push({ seat, driverProfileId: binding.driverProfileId, number: src.number });
    }

    if (toRestore.length === 0) {
      const result = await this.keepUniverse(userId, teamId, seasonId);
      return { team: result.team, restored: 0 };
    }

    await prisma.$transaction(async (tx) => {
      for (const r of toRestore) {
        await rosterService.assignDriverToSeatInTx(tx, userId, {
          seasonId,
          teamId,
          driverProfileId: r.driverProfileId,
          seat: r.seat,
          number: r.number,
        });
      }
    });

    const driverBindingMapAfter = await resolveDriverBindingMap(sourceYear);
    const team = await buildTeamComparison(seasonId, sourceYear, teamId, teamInfo, driverBindingMapAfter);
    return { team, restored: toRestore.length };
  },
};