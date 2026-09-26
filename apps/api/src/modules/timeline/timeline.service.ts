import type { Prisma, TimelineEvent } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import { recomputeSeasonStandings } from "../championship/championship-progression.service.js";

const WORLD_KEY = "default";
const CHECKPOINT_INTERVAL = 20;

type Tx = Prisma.TransactionClient;

export class TimelineError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 409,
  ) {
    super(message);
    this.name = "TimelineError";
  }
}

export interface WorldAdvancedPayload {
  currentDate: string;
  currentSeasonId: string | null;
  currentRaceId: string | null;
  currentSession: "PRACTICE" | "QUALIFYING" | "RACE" | null;
}

export interface RaceResultCorrectionPayload {
  raceId: string;
  driverProfileId: string;
  position?: number | null;
  points?: number | null;
  grid?: number | null;
  status?: string | null;
}

export interface StandingCorrectionPayload {
  seasonId: string;
  driverProfileId: string;
  points?: number;
  wins?: number;
  podiums?: number;
  position?: number | null;
}

export interface NumberCorrectionPayload {
  seasonId: string;
  driverProfileId: string;
  number: number | null;
}

export interface SnapshotState {
  world: {
    currentDate: string;
    currentSeasonId: string | null;
    currentRaceId: string | null;
    currentSession: string | null;
  } | null;
  seasonId: string | null;
  standings: Array<{
    driverProfileId: string;
    points: number;
    wins: number;
    podiums: number;
    position: number | null;
  }>;
}

export async function lockUniverseTimeline(
  tx: Tx,
  universeId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`timeline:${universeId}`}))`;
}

async function nextSequence(tx: Tx, universeId: string): Promise<number> {
  const last = await tx.timelineEvent.aggregate({
    where: { universeId },
    _max: { sequence: true },
  });
  return (last._max.sequence ?? 0) + 1;
}

export interface AppendTimelineEventInput {
  kind: TimelineEvent["kind"];
  worldDate: Date;
  payload: Prisma.InputJsonValue;
  causedBy?: string | null;
  supersedesId?: string | null;
}

export async function appendTimelineEvent(
  tx: Tx,
  universeId: string,
  input: AppendTimelineEventInput,
): Promise<TimelineEvent> {
  const sequence = await nextSequence(tx, universeId);
  return tx.timelineEvent.create({
    data: {
      universeId,
      sequence,
      worldDate: input.worldDate,
      kind: input.kind,
      payload: input.payload,
      causedBy: input.causedBy ?? null,
      supersedesId: input.supersedesId ?? null,
    },
  });
}

export async function buildSnapshotState(
  tx: Tx,
  universeId: string,
): Promise<SnapshotState> {
  const world = await tx.worldState.findUnique({
    where: { universeId_key: { universeId, key: WORLD_KEY } },
    select: {
      currentDate: true,
      currentSeasonId: true,
      currentRaceId: true,
      currentSession: true,
    },
  });
  const seasonId = world?.currentSeasonId ?? null;
  const standings = seasonId
    ? await tx.championshipStanding.findMany({
        where: { seasonId },
        select: {
          driverProfileId: true,
          points: true,
          wins: true,
          podiums: true,
          position: true,
        },
        orderBy: [{ position: "asc" }, { driverProfileId: "asc" }],
      })
    : [];
  return {
    world: world
      ? {
          currentDate: world.currentDate.toISOString(),
          currentSeasonId: world.currentSeasonId,
          currentRaceId: world.currentRaceId,
          currentSession: world.currentSession,
        }
      : null,
    seasonId,
    standings,
  };
}

export async function createWorldSnapshot(
  tx: Tx,
  universeId: string,
  sequence: number,
  worldDate: Date,
): Promise<void> {
  const state = await buildSnapshotState(tx, universeId);
  await tx.worldSnapshot.upsert({
    where: { universeId_sequence: { universeId, sequence } },
    create: {
      universeId,
      sequence,
      worldDate,
      state: state as unknown as Prisma.InputJsonValue,
    },
    update: {},
  });
}

async function restoreSnapshotState(
  tx: Tx,
  universeId: string,
  state: unknown,
): Promise<void> {
  const snapshot = state as SnapshotState;
  if (snapshot.world) {
    const worldDate = new Date(snapshot.world.currentDate);
    await tx.worldState.upsert({
      where: { universeId_key: { universeId, key: WORLD_KEY } },
      create: {
        universeId,
        key: WORLD_KEY,
        currentDate: worldDate,
        currentSeasonId: snapshot.world.currentSeasonId,
        currentRaceId: snapshot.world.currentRaceId,
        currentSession:
          snapshot.world.currentSession as
            | "PRACTICE"
            | "QUALIFYING"
            | "RACE"
            | null,
      },
      update: {
        currentDate: worldDate,
        currentSeasonId: snapshot.world.currentSeasonId,
        currentRaceId: snapshot.world.currentRaceId,
        currentSession:
          snapshot.world.currentSession as
            | "PRACTICE"
            | "QUALIFYING"
            | "RACE"
            | null,
      },
    });
  }
  if (snapshot.seasonId) {
    await tx.championshipStanding.deleteMany({
      where: { seasonId: snapshot.seasonId },
    });
    if (snapshot.standings.length > 0) {
      await tx.championshipStanding.createMany({
        data: snapshot.standings.map((standing) => ({
          seasonId: snapshot.seasonId as string,
          driverProfileId: standing.driverProfileId,
          points: standing.points,
          wins: standing.wins,
          podiums: standing.podiums,
          position: standing.position,
        })),
      });
    }
  }
}

async function applyTimelineEvent(
  tx: Tx,
  universeId: string,
  event: TimelineEvent,
): Promise<void> {
  switch (event.kind) {
    case "WORLD_ADVANCED": {
      const payload = event.payload as unknown as WorldAdvancedPayload;
      await tx.worldState.upsert({
        where: { universeId_key: { universeId, key: WORLD_KEY } },
        create: {
          universeId,
          key: WORLD_KEY,
          currentDate: new Date(payload.currentDate),
          currentSeasonId: payload.currentSeasonId,
          currentRaceId: payload.currentRaceId,
          currentSession: payload.currentSession,
        },
        update: {
          currentDate: new Date(payload.currentDate),
          currentSeasonId: payload.currentSeasonId,
          currentRaceId: payload.currentRaceId,
          currentSession: payload.currentSession,
        },
      });
      return;
    }
    case "RACE_RESULT_CORRECTED": {
      const payload = event.payload as unknown as RaceResultCorrectionPayload;
      const data: Prisma.RaceResultUpdateManyMutationInput = {};
      if (payload.position !== undefined) data.position = payload.position;
      if (payload.points !== undefined) data.points = payload.points ?? 0;
      if (payload.grid !== undefined) data.grid = payload.grid;
      if (payload.status !== undefined) data.status = payload.status;
      await tx.raceResult.updateMany({
        where: {
          raceId: payload.raceId,
          driverProfileId: payload.driverProfileId,
        },
        data,
      });
      const race = await tx.race.findFirst({
        where: { id: payload.raceId, season: { universeId } },
        select: { seasonId: true },
      });
      if (race) {
        await recomputeSeasonStandings(tx, race.seasonId);
      }
      return;
    }
    case "STANDING_CORRECTED": {
      const payload = event.payload as unknown as StandingCorrectionPayload;
      await tx.championshipStanding.upsert({
        where: {
          seasonId_driverProfileId: {
            seasonId: payload.seasonId,
            driverProfileId: payload.driverProfileId,
          },
        },
        create: {
          seasonId: payload.seasonId,
          driverProfileId: payload.driverProfileId,
          points: payload.points ?? 0,
          wins: payload.wins ?? 0,
          podiums: payload.podiums ?? 0,
          position: payload.position ?? null,
        },
        update: {
          ...(payload.points !== undefined ? { points: payload.points } : {}),
          ...(payload.wins !== undefined ? { wins: payload.wins } : {}),
          ...(payload.podiums !== undefined
            ? { podiums: payload.podiums }
            : {}),
          ...(payload.position !== undefined
            ? { position: payload.position }
            : {}),
        },
      });
      return;
    }
    case "NUMBER_CORRECTED": {
      const payload = event.payload as unknown as NumberCorrectionPayload;
      const entry = await tx.seasonDriverEntry.updateMany({
        where: {
          seasonId: payload.seasonId,
          driverProfileId: payload.driverProfileId,
        },
        data: { number: payload.number },
      });
      if (entry.count === 0) {
        await tx.driverProfile.updateMany({
          where: {
            id: payload.driverProfileId,
            character: { universeId },
          },
          data: { number: payload.number },
        });
      }
      return;
    }
  }
}

export interface RecomputeResult {
  applied: number;
  fromSnapshotSequence: number;
}

export async function recomputeUniverseState(
  tx: Tx,
  universeId: string,
  options: { fromSnapshotId?: string } = {},
): Promise<RecomputeResult> {
  const snapshot = options.fromSnapshotId
    ? await tx.worldSnapshot.findFirstOrThrow({
        where: { id: options.fromSnapshotId, universeId },
      })
    : await tx.worldSnapshot.findFirst({
        where: { universeId },
        orderBy: { sequence: "desc" },
      });

  if (snapshot) {
    await restoreSnapshotState(tx, universeId, snapshot.state);
  }

  const events = await tx.timelineEvent.findMany({
    where: {
      universeId,
      sequence: { gt: snapshot?.sequence ?? 0 },
    },
    orderBy: [{ worldDate: "asc" }, { sequence: "asc" }],
  });

  const supersededIds = new Set(
    events
      .map((event) => event.supersedesId)
      .filter((id): id is string => id !== null),
  );

  let applied = 0;
  for (const event of events) {
    if (supersededIds.has(event.id)) continue;
    await applyTimelineEvent(tx, universeId, event);
    applied += 1;
  }

  return { applied, fromSnapshotSequence: snapshot?.sequence ?? 0 };
}

async function ensureBaselineSnapshot(
  tx: Tx,
  universeId: string,
  worldDate: Date,
): Promise<void> {
  const existing = await tx.worldSnapshot.findFirst({
    where: { universeId, sequence: 0 },
    select: { id: true },
  });
  if (!existing) {
    await createWorldSnapshot(tx, universeId, 0, worldDate);
  }
}

async function maybeCheckpoint(tx: Tx, universeId: string): Promise<void> {
  const lastSnapshot = await tx.worldSnapshot.findFirst({
    where: { universeId },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  const lastEvent = await tx.timelineEvent.findFirst({
    where: { universeId },
    orderBy: { sequence: "desc" },
    select: { sequence: true, worldDate: true },
  });
  if (!lastEvent) return;
  const since = lastEvent.sequence - (lastSnapshot?.sequence ?? 0);
  if (since >= CHECKPOINT_INTERVAL) {
    await createWorldSnapshot(
      tx,
      universeId,
      lastEvent.sequence,
      lastEvent.worldDate,
    );
  }
}

export interface AdvanceInput {
  worldDate: Date;
  currentSeasonId?: string | null;
  currentRaceId?: string | null;
  currentSession?: "PRACTICE" | "QUALIFYING" | "RACE" | null;
}

export async function advanceUniverseTime(
  universeId: string,
  input: AdvanceInput,
): Promise<TimelineEvent> {
  return prisma.$transaction(async (tx) => {
    await lockUniverseTimeline(tx, universeId);

    const world = await tx.worldState.findUnique({
      where: { universeId_key: { universeId, key: WORLD_KEY } },
      select: {
        currentDate: true,
        currentSeasonId: true,
        currentRaceId: true,
        currentSession: true,
      },
    });

    if (world && input.worldDate.getTime() < world.currentDate.getTime()) {
      throw new TimelineError(
        "TIME_REGRESSION",
        "O avanço não pode retroceder a data do mundo; use correções retroativas.",
      );
    }

    const seasonId =
      input.currentSeasonId !== undefined
        ? input.currentSeasonId
        : (world?.currentSeasonId ?? null);
    const raceId =
      input.currentRaceId !== undefined
        ? input.currentRaceId
        : (world?.currentRaceId ?? null);
    const session =
      input.currentSession !== undefined
        ? input.currentSession
        : (world?.currentSession ?? null);

    if (seasonId) {
      const season = await tx.season.findFirst({
        where: { id: seasonId, universeId },
        select: { id: true },
      });
      if (!season) {
        throw new TimelineError(
          "SEASON_NOT_FOUND",
          "Temporada não pertence a este universo.",
          404,
        );
      }
    }
    if (raceId) {
      const race = await tx.race.findFirst({
        where: { id: raceId, season: { universeId } },
        select: { id: true },
      });
      if (!race) {
        throw new TimelineError(
          "RACE_NOT_FOUND",
          "Corrida não pertence a este universo.",
          404,
        );
      }
    }

    await ensureBaselineSnapshot(
      tx,
      universeId,
      world?.currentDate ?? input.worldDate,
    );

    const event = await appendTimelineEvent(tx, universeId, {
      kind: "WORLD_ADVANCED",
      worldDate: input.worldDate,
      payload: {
        currentDate: input.worldDate.toISOString(),
        currentSeasonId: seasonId,
        currentRaceId: raceId,
        currentSession: session,
      } satisfies WorldAdvancedPayload as unknown as Prisma.InputJsonValue,
      causedBy: "USER",
    });

    await recomputeUniverseState(tx, universeId);
    await maybeCheckpoint(tx, universeId);

    return event;
  });
}

export type CorrectionKind =
  | "RACE_RESULT_CORRECTED"
  | "STANDING_CORRECTED"
  | "NUMBER_CORRECTED";

export interface CorrectionInput {
  kind: CorrectionKind;
  worldDate: Date;
  payload: Prisma.InputJsonValue;
  supersedesId?: string | null;
}

export async function applyRetroactiveCorrection(
  universeId: string,
  input: CorrectionInput,
): Promise<TimelineEvent> {
  return prisma.$transaction(async (tx) => {
    await lockUniverseTimeline(tx, universeId);

    const world = await tx.worldState.findUnique({
      where: { universeId_key: { universeId, key: WORLD_KEY } },
      select: { currentDate: true },
    });
    if (!world) {
      throw new TimelineError(
        "WORLD_STATE_MISSING",
        "O universo ainda não possui estado do mundo.",
        409,
      );
    }
    if (input.worldDate.getTime() > world.currentDate.getTime()) {
      throw new TimelineError(
        "NOT_IN_PAST",
        "Correções retroativas exigem data igual ou anterior à data atual do mundo.",
      );
    }

    await assertCorrectionTarget(tx, universeId, input.kind, input.payload);

    if (input.supersedesId) {
      const target = await tx.timelineEvent.findFirst({
        where: { id: input.supersedesId, universeId },
        select: { id: true, kind: true },
      });
      if (!target) {
        throw new TimelineError(
          "SUPERSEDES_NOT_FOUND",
          "Evento a substituir não pertence a este universo.",
          404,
        );
      }
      if (target.kind !== input.kind) {
        throw new TimelineError(
          "SUPERSEDES_KIND_MISMATCH",
          "Só é permitido substituir evento do mesmo tipo.",
        );
      }
    }

    const event = await appendTimelineEvent(tx, universeId, {
      kind: input.kind,
      worldDate: input.worldDate,
      payload: input.payload,
      causedBy: "USER",
      supersedesId: input.supersedesId ?? null,
    });

    await recomputeUniverseState(tx, universeId);
    await maybeCheckpoint(tx, universeId);

    return event;
  });
}

async function assertCorrectionTarget(
  tx: Tx,
  universeId: string,
  kind: CorrectionKind,
  payload: Prisma.InputJsonValue,
): Promise<void> {
  if (kind === "RACE_RESULT_CORRECTED") {
    const data = payload as unknown as RaceResultCorrectionPayload;
    const race = await tx.race.findFirst({
      where: { id: data.raceId, season: { universeId } },
      select: { id: true },
    });
    if (!race) {
      throw new TimelineError(
        "RACE_NOT_FOUND",
        "Corrida não pertence a este universo.",
        404,
      );
    }
    const profile = await tx.driverProfile.findFirst({
      where: { id: data.driverProfileId, character: { universeId } },
      select: { id: true },
    });
    if (!profile) {
      throw new TimelineError(
        "DRIVER_NOT_FOUND",
        "Piloto não pertence a este universo.",
        404,
      );
    }
    return;
  }
  if (kind === "STANDING_CORRECTED") {
    const data = payload as unknown as StandingCorrectionPayload;
    const season = await tx.season.findFirst({
      where: { id: data.seasonId, universeId },
      select: { id: true },
    });
    if (!season) {
      throw new TimelineError(
        "SEASON_NOT_FOUND",
        "Temporada não pertence a este universo.",
        404,
      );
    }
    const profile = await tx.driverProfile.findFirst({
      where: { id: data.driverProfileId, character: { universeId } },
      select: { id: true },
    });
    if (!profile) {
      throw new TimelineError(
        "DRIVER_NOT_FOUND",
        "Piloto não pertence a este universo.",
        404,
      );
    }
    return;
  }
  const data = payload as unknown as NumberCorrectionPayload;
  const season = await tx.season.findFirst({
    where: { id: data.seasonId, universeId },
    select: { id: true },
  });
  if (!season) {
    throw new TimelineError(
      "SEASON_NOT_FOUND",
      "Temporada não pertence a este universo.",
      404,
    );
  }
}

export function listTimelineEvents(
  universeId: string,
  limit = 100,
): Promise<TimelineEvent[]> {
  return prisma.timelineEvent.findMany({
    where: { universeId },
    orderBy: [{ worldDate: "asc" }, { sequence: "asc" }],
    take: limit,
  });
}

export function listWorldSnapshots(
  universeId: string,
  limit = 50,
): Promise<Array<{ id: string; sequence: number; worldDate: Date }>> {
  return prisma.worldSnapshot.findMany({
    where: { universeId },
    orderBy: { sequence: "asc" },
    take: limit,
    select: { id: true, sequence: true, worldDate: true },
  });
}
