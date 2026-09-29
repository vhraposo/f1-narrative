import type { Prisma, PrismaClient, RaceSession } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { recomputeSeasonStandings } from "../championship/championship-progression.service.js";
import { ensureUniverse } from "../universe/universe.service.js";
import {
  appendTimelineEvent,
  lockUniverseTimeline,
} from "../timeline/timeline.service.js";
import { computeQualifyingRun } from "../simulation/qualifying.service.js";
import { computeRaceRun } from "../simulation/race-simulation.service.js";

const WORLD_KEY = "default";
const SPRINT_SEQUENCE: RaceSession[] = [
  "PRACTICE",
  "SPRINT_QUALIFYING",
  "SPRINT",
  "QUALIFYING",
  "RACE",
];
const STANDARD_SEQUENCE: RaceSession[] = ["PRACTICE", "QUALIFYING", "RACE"];

const SPRINT_SIMULATOR_ELIGIBILITY = {
  neutralizedStart: false,
  distancePct: 100,
};

export class RaceWeekendError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 409,
  ) {
    super(message);
    this.name = "RaceWeekendError";
  }
}

export type WeekendSessionState = "COMPLETED" | "AVAILABLE" | "LOCKED";

export type WeekendSessionResultView = {
  driverProfileId: string;
  driverName: string;
  teamName: string | null;
  position: number | null;
  status: string | null;
  points: number;
};

export type WeekendSessionView = {
  session: RaceSession;
  state: WeekendSessionState;
  results: WeekendSessionResultView[];
};

export type WeekendView = {
  raceId: string;
  name: string;
  round: number | null;
  date: Date | null;
  status: string;
  effectiveSprint: boolean;
  sprintOverride: boolean | null;
  sprintExternal: boolean | null;
  currentSession: RaceSession | null;
  nextSession: RaceSession | null;
  sessions: WeekendSessionView[];
};

type RaceWithSeason = {
  id: string;
  name: string;
  round: number | null;
  date: Date | null;
  status: string;
  seasonId: string;
  sprintOverride: boolean | null;
  sprintExternal: boolean | null;
  season: { universeId: string };
};

async function loadRace(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
  raceId: string,
): Promise<RaceWithSeason> {
  const universe = await ensureUniverse(userId);
  const race = await db.race.findUnique({
    where: { id: raceId },
    select: {
      id: true,
      name: true,
      round: true,
      date: true,
      status: true,
      seasonId: true,
      sprintOverride: true,
      sprintExternal: true,
      season: { select: { universeId: true } },
    },
  });
  if (!race) {
    throw new RaceWeekendError("RACE_NOT_FOUND", "Corrida não encontrada", 404);
  }
  if (race.season.universeId !== universe.id) {
    throw new RaceWeekendError(
      "RACE_NOT_IN_UNIVERSE",
      "Corrida não pertence ao seu Universe",
      403,
    );
  }
  return race;
}

export function effectiveSprintValue(race: {
  sprintOverride: boolean | null;
  sprintExternal: boolean | null;
}): boolean {
  return race.sprintOverride ?? race.sprintExternal ?? false;
}

export function weekendSequenceFor(effective: boolean): RaceSession[] {
  return effective ? SPRINT_SEQUENCE : STANDARD_SEQUENCE;
}

export function weekendStatusPosition(
  status: string,
  sequence: RaceSession[],
): number {
  if (status === "UPCOMING") return -1;
  if (status === "FINISHED") return sequence.length;
  const index = sequence.indexOf(status as RaceSession);
  return index >= 0 ? index : -1;
}

function sessionResultsSelect() {
  return {
    driverProfileId: true,
    position: true,
    status: true,
    points: true,
    driverProfile: {
      select: { character: { select: { name: true } } },
    },
    team: { select: { name: true } },
  } as const;
}

function raceResultRowsSelect() {
  return {
    driverProfileId: true,
    position: true,
    status: true,
    points: true,
    driverProfile: {
      select: { character: { select: { name: true } } },
    },
  } as const;
}

export async function getRaceWeekend(
  userId: string,
  raceId: string,
): Promise<WeekendView> {
  const race = await loadRace(prisma, userId, raceId);
  const effective = effectiveSprintValue(race);
  const sequence = weekendSequenceFor(effective);
  const statusPos = weekendStatusPosition(race.status, sequence);
  const completedSessions = sequence.slice(
    0,
    Math.max(0, Math.min(sequence.length, statusPos + 1)),
  );

  const [sessionRows, raceRows] = await Promise.all([
    completedSessions.length > 0
      ? prisma.raceSessionResult.findMany({
          where: { raceId: race.id, session: { in: completedSessions } },
          select: {
            session: true,
            ...sessionResultsSelect(),
          },
          orderBy: [{ session: "asc" }, { position: "asc" }],
        })
      : Promise.resolve([]),
    completedSessions.includes("RACE")
      ? prisma.raceResult.findMany({
          where: { raceId: race.id },
          select: raceResultRowsSelect(),
          orderBy: { position: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const bySession = new Map<string, WeekendSessionResultView[]>();
  for (const row of sessionRows) {
    const list = bySession.get(row.session) ?? [];
    list.push({
      driverProfileId: row.driverProfileId,
      driverName: row.driverProfile.character.name,
      teamName: row.team?.name ?? null,
      position: row.position,
      status: row.status,
      points: row.points,
    });
    bySession.set(row.session, list);
  }

  const sessions: WeekendSessionView[] = sequence.map((session, index) => {
    const state: WeekendSessionState =
      index <= statusPos
        ? "COMPLETED"
        : index === statusPos + 1
          ? "AVAILABLE"
          : "LOCKED";
    const results =
      session === "RACE"
        ? raceRows.map((row) => ({
            driverProfileId: row.driverProfileId,
            driverName: row.driverProfile.character.name,
            teamName: null,
            position: row.position,
            status: row.status,
            points: row.points,
          }))
        : (bySession.get(session) ?? []);
    return { session, state, results };
  });

  const currentSession =
    race.status !== "UPCOMING" && race.status !== "FINISHED"
      ? (race.status as RaceSession)
      : null;
  const nextSession =
    statusPos + 1 < sequence.length ? sequence[statusPos + 1] : null;

  return {
    raceId: race.id,
    name: race.name,
    round: race.round,
    date: race.date,
    status: race.status,
    effectiveSprint: effective,
    sprintOverride: race.sprintOverride,
    sprintExternal: race.sprintExternal,
    currentSession,
    nextSession,
    sessions,
  };
}

async function sessionTeamByDriver(
  tx: Prisma.TransactionClient,
  seasonId: string,
): Promise<Map<string, string | null>> {
  const entries = await tx.seasonDriverEntry.findMany({
    where: { seasonId, status: "ACTIVE" },
    select: { driverProfileId: true, teamId: true },
  });
  return new Map(entries.map((entry) => [entry.driverProfileId, entry.teamId]));
}

async function setWorldSession(
  tx: Prisma.TransactionClient,
  universeId: string,
  seasonId: string,
  raceId: string,
  session: RaceSession,
): Promise<void> {
  await tx.worldState.upsert({
    where: { universeId_key: { universeId, key: WORLD_KEY } },
    create: {
      universeId,
      key: WORLD_KEY,
      currentSeasonId: seasonId,
      currentRaceId: raceId,
      currentSession: session,
    },
    update: {
      currentSeasonId: seasonId,
      currentRaceId: raceId,
      currentSession: session,
    },
  });
}

async function appendSessionEvent(
  tx: Prisma.TransactionClient,
  universeId: string,
  race: RaceWithSeason,
  session: RaceSession,
  resultCount: number,
  extra?: Record<string, unknown>,
): Promise<void> {
  const world = await tx.worldState.findUnique({
    where: { universeId_key: { universeId, key: WORLD_KEY } },
    select: { currentDate: true },
  });
  await appendTimelineEvent(tx, universeId, {
    kind: "SESSION_COMPLETED",
    worldDate: race.date ?? world?.currentDate ?? new Date(),
    causedBy: "USER",
    payload: {
      raceId: race.id,
      session,
      resultCount,
      ...extra,
    } as Prisma.InputJsonValue,
  });
}

async function hasSessionEvent(
  tx: Prisma.TransactionClient,
  universeId: string,
  raceId: string,
  session: RaceSession,
): Promise<boolean> {
  const event = await tx.timelineEvent.findFirst({
    where: {
      universeId,
      kind: "SESSION_COMPLETED",
      AND: [
        { payload: { path: ["raceId"], equals: raceId } },
        { payload: { path: ["session"], equals: session } },
      ],
    },
    select: { id: true },
  });
  return event !== null;
}

async function runPracticeLike(
  tx: Prisma.TransactionClient,
  race: RaceWithSeason,
  session: Extract<RaceSession, "PRACTICE" | "SPRINT_QUALIFYING">,
): Promise<number> {
  const seedSuffix =
    session === "PRACTICE" ? ":practice" : ":sprint-qualifying";
  const run = await computeQualifyingRun(tx, race, { seedSuffix });
  const teamByDriver = await sessionTeamByDriver(tx, race.seasonId);

  if (session === "PRACTICE") {
    await tx.raceSessionResult.deleteMany({
      where: { raceId: race.id, session },
    });
  }
  for (const row of run) {
    await tx.raceSessionResult.upsert({
      where: {
        raceId_driverProfileId_session: {
          raceId: race.id,
          driverProfileId: row.driverProfileId,
          session,
        },
      },
      create: {
        raceId: race.id,
        driverProfileId: row.driverProfileId,
        teamId: teamByDriver.get(row.driverProfileId) ?? null,
        session,
        position: row.grid,
        status: "Finished",
        points: 0,
      },
      update: {
        position: row.grid,
        status: "Finished",
      },
    });
  }
  return run.length;
}

async function runSprint(
  tx: Prisma.TransactionClient,
  race: RaceWithSeason,
): Promise<number> {
  const qualifyingRows = await tx.raceSessionResult.findMany({
    where: { raceId: race.id, session: "SPRINT_QUALIFYING" },
    select: { driverProfileId: true, position: true },
    orderBy: { position: "asc" },
  });
  const grid = qualifyingRows.flatMap((row) =>
    row.position !== null
      ? [{ driverProfileId: row.driverProfileId, grid: row.position }]
      : [],
  );
  if (grid.length === 0) {
    throw new RaceWeekendError(
      "PREREQUISITE_MISSING",
      "Sprint Qualifying ainda não foi executada",
      409,
    );
  }

  const run = await computeRaceRun(tx, race, { grid, seedSuffix: ":sprint" });
  const teamByDriver = await sessionTeamByDriver(tx, race.seasonId);

  for (const row of run.results) {
    await tx.raceSessionResult.upsert({
      where: {
        raceId_driverProfileId_session: {
          raceId: race.id,
          driverProfileId: row.driverProfileId,
          session: "SPRINT",
        },
      },
      create: {
        raceId: race.id,
        driverProfileId: row.driverProfileId,
        teamId: teamByDriver.get(row.driverProfileId) ?? null,
        session: "SPRINT",
        position: row.position,
        status: row.status,
        points: 0,
        metadata: {
          eligibility: SPRINT_SIMULATOR_ELIGIBILITY,
        } as Prisma.InputJsonValue,
      },
      update: {
        position: row.position,
        status: row.status,
        metadata: {
          eligibility: SPRINT_SIMULATOR_ELIGIBILITY,
        } as Prisma.InputJsonValue,
      },
    });
  }

  await recomputeSeasonStandings(tx, race.seasonId);
  return run.results.length;
}

async function runQualifying(
  tx: Prisma.TransactionClient,
  race: RaceWithSeason,
): Promise<number> {
  const run = await computeQualifyingRun(tx, race);
  const teamByDriver = await sessionTeamByDriver(tx, race.seasonId);

  for (const row of run) {
    await tx.raceResult.upsert({
      where: {
        raceId_driverProfileId: {
          raceId: race.id,
          driverProfileId: row.driverProfileId,
        },
      },
      create: {
        raceId: race.id,
        driverProfileId: row.driverProfileId,
        grid: row.grid,
      },
      update: { grid: row.grid },
      select: { id: true },
    });
    await tx.raceSessionResult.upsert({
      where: {
        raceId_driverProfileId_session: {
          raceId: race.id,
          driverProfileId: row.driverProfileId,
          session: "QUALIFYING",
        },
      },
      create: {
        raceId: race.id,
        driverProfileId: row.driverProfileId,
        teamId: teamByDriver.get(row.driverProfileId) ?? null,
        session: "QUALIFYING",
        position: row.grid,
        status: "Finished",
        points: 0,
      },
      update: {
        position: row.grid,
        status: "Finished",
      },
    });
  }
  return run.length;
}

async function runRace(
  tx: Prisma.TransactionClient,
  race: RaceWithSeason,
): Promise<number> {
  const run = await computeRaceRun(tx, race);
  for (const row of run.results) {
    await tx.raceResult.upsert({
      where: {
        raceId_driverProfileId: {
          raceId: race.id,
          driverProfileId: row.driverProfileId,
        },
      },
      create: {
        raceId: race.id,
        driverProfileId: row.driverProfileId,
        grid: row.startGrid,
        position: row.position,
        status: row.status,
        points: 0,
      },
      update: { position: row.position, status: row.status },
      select: { id: true },
    });
  }
  return run.results.length;
}

export async function runWeekendSession(
  userId: string,
  raceId: string,
  session: RaceSession,
  options: { rerun?: boolean } = {},
): Promise<WeekendView> {
  const race = await loadRace(prisma, userId, raceId);
  const effective = effectiveSprintValue(race);
  const sequence = weekendSequenceFor(effective);
  const sessionIndex = sequence.indexOf(session);
  if (sessionIndex < 0) {
    throw new RaceWeekendError(
      effective ? "SESSION_INVALID" : "SPRINT_NOT_CONFIGURED",
      effective
        ? "Sessão inválida para o weekend"
        : "Este weekend não possui Sprint",
      409,
    );
  }

  const isPracticeRerun =
    options.rerun === true && session === "PRACTICE" && race.status === "PRACTICE";
  if (race.status === "FINISHED") {
    throw new RaceWeekendError(
      "SESSION_NOT_AVAILABLE",
      "O fim de semana já foi finalizado",
      409,
    );
  }
  if (!isPracticeRerun) {
    const expectedStatus = sessionIndex === 0 ? "UPCOMING" : sequence[sessionIndex - 1];
    if (race.status !== expectedStatus) {
      throw new RaceWeekendError(
        "SESSION_NOT_AVAILABLE",
        "Sessão fora da ordem do fim de semana",
        409,
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await lockUniverseTimeline(tx, race.season.universeId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`race-weekend:${race.id}`}))`;

    const current = await tx.race.findUniqueOrThrow({
      where: { id: race.id },
      select: { status: true },
    });
    if (!isPracticeRerun) {
      const expectedStatus =
        sessionIndex === 0 ? "UPCOMING" : sequence[sessionIndex - 1];
      if (current.status !== expectedStatus) {
        throw new RaceWeekendError(
          "SESSION_NOT_AVAILABLE",
          "Sessão fora da ordem do fim de semana",
          409,
        );
      }
    } else if (current.status !== "PRACTICE") {
      throw new RaceWeekendError(
        "SESSION_NOT_AVAILABLE",
        "Practice não está mais disponível para reexecução",
        409,
      );
    }

    let resultCount: number;
    if (session === "PRACTICE" || session === "SPRINT_QUALIFYING") {
      resultCount = await runPracticeLike(tx, { ...race, ...current }, session);
    } else if (session === "SPRINT") {
      resultCount = await runSprint(tx, { ...race, ...current });
    } else if (session === "QUALIFYING") {
      resultCount = await runQualifying(tx, { ...race, ...current });
    } else {
      resultCount = await runRace(tx, { ...race, ...current });
    }

    if (session !== "RACE") {
      await tx.race.update({
        where: { id: race.id },
        data: { status: session },
      });
    } else if (current.status === "QUALIFYING") {
      await tx.race.update({
        where: { id: race.id },
        data: { status: "RACE" },
      });
    }

    await setWorldSession(
      tx,
      race.season.universeId,
      race.seasonId,
      race.id,
      session,
    );

    const alreadyAudited = await hasSessionEvent(
      tx,
      race.season.universeId,
      race.id,
      session,
    );
    if (!alreadyAudited) {
      await appendSessionEvent(
        tx,
        race.season.universeId,
        race,
        session,
        resultCount,
        session === "SPRINT"
          ? { eligibility: SPRINT_SIMULATOR_ELIGIBILITY }
          : undefined,
      );
    }
  });

  return getRaceWeekend(userId, raceId);
}
