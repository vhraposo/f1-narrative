import { createHash } from "node:crypto";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  applyCorrectionWithinTransaction,
  type CorrectionCommand,
} from "./correction.service.js";
import type { Tx } from "./timeline.service.js";

const WORLD_KEY = "default";

export class CorrectionPreviewAbort<T = CorrectionPreview> extends Error {
  constructor(public readonly report: T) {
    super("correction-preview-abort");
    this.name = "CorrectionPreviewAbort";
  }
}

export type PreviewChange = {
  area: "RESULT" | "STANDING" | "CHAMPION" | "NUMBER" | "CALENDAR";
  label: string;
  field: string;
  before: string | number | null;
  after: string | number | null;
};

export type CorrectionPreview = {
  previewToken: string;
  kind: CorrectionCommand["kind"];
  changes: PreviewChange[];
  championBefore: string | null;
  championAfter: string | null;
  narrativeStaleEventIds: string[];
  numberImpact: {
    seasonId: string;
    year: number;
    currentHolderId: string | null;
    expectedChampionId: string | null;
    requiresAction: boolean;
  } | null;
};

type SeasonStanding = {
  driverProfileId: string;
  position: number | null;
  points: number;
  wins: number;
  podiums: number;
};

function toStandingMap(rows: SeasonStanding[]) {
  return new Map(rows.map((row) => [row.driverProfileId, row]));
}

function championOf(rows: SeasonStanding[]): string | null {
  const ordered = [...rows].sort((a, b) => {
    const positionA = a.position ?? Number.MAX_SAFE_INTEGER;
    const positionB = b.position ?? Number.MAX_SAFE_INTEGER;
    if (positionA !== positionB) return positionA - positionB;
    return a.driverProfileId.localeCompare(b.driverProfileId);
  });
  const first = ordered[0];
  return first && first.position === 1 ? first.driverProfileId : null;
}

async function loadStandings(tx: Tx, seasonId: string): Promise<SeasonStanding[]> {
  return tx.championshipStanding.findMany({
    where: { seasonId },
    select: {
      driverProfileId: true,
      position: true,
      points: true,
      wins: true,
      podiums: true,
    },
    orderBy: [{ position: "asc" }, { driverProfileId: "asc" }],
  });
}

export async function resolveCorrectionSeasonId(tx: Tx, universeId: string, command: CorrectionCommand): Promise<string | null> {
  if (command.kind === "NUMBER_CORRECTED" || command.kind === "STANDING_CORRECTED") {
    return command.seasonId;
  }
  const race = await tx.race.findFirst({
    where: { id: command.raceId, season: { universeId } },
    select: { seasonId: true },
  });
  return race?.seasonId ?? null;
}

function canonicalCommand(command: CorrectionCommand): string {
  return JSON.stringify(command, (_key, value) =>
    value instanceof Date ? value.toISOString() : value,
  );
}

function canonicalCommands(
  commands: CorrectionCommand | readonly CorrectionCommand[],
): string {
  if (Array.isArray(commands)) {
    return JSON.stringify(commands.map((command) => canonicalCommand(command)));
  }
  return canonicalCommand(commands as CorrectionCommand);
}

export async function buildCorrectionPreviewToken(
  tx: Tx,
  universeId: string,
  commands: CorrectionCommand | readonly CorrectionCommand[],
  seasonId: string | null,
): Promise<string> {
  const world = await tx.worldState.findUnique({
    where: { universeId_key: { universeId, key: WORLD_KEY } },
    select: { currentDate: true, currentSeasonId: true, currentRaceId: true, currentSession: true },
  });
  const last = await tx.timelineEvent.aggregate({
    where: { universeId },
    _max: { sequence: true },
  });
  const standings = seasonId ? await loadStandings(tx, seasonId) : [];
  const payload = JSON.stringify({
    universeId,
    lastSequence: last._max.sequence ?? 0,
    world: world
      ? {
          currentDate: world.currentDate.toISOString(),
          currentSeasonId: world.currentSeasonId,
          currentRaceId: world.currentRaceId,
          currentSession: world.currentSession,
        }
      : null,
    standings,
    commands: canonicalCommands(commands),
  });
  return `sha256:${createHash("sha256").update(payload, "utf8").digest("hex")}`;
}

async function buildPreview(
  tx: Tx,
  universeId: string,
  command: CorrectionCommand,
): Promise<CorrectionPreview> {
  const seasonId = await resolveCorrectionSeasonId(tx, universeId, command);
  const token = await buildCorrectionPreviewToken(tx, universeId, command, seasonId);

  const resultBefore =
    command.kind === "RACE_RESULT_CORRECTED"
      ? await tx.raceResult.findFirst({
          where: { raceId: command.raceId, driverProfileId: command.driverProfileId },
          select: { position: true, grid: true, status: true, points: true },
        })
      : null;
  const sprintBefore =
    command.kind === "RACE_SESSION_RESULT_CORRECTED"
      ? await tx.raceSessionResult.findFirst({
          where: {
            raceId: command.raceId,
            driverProfileId: command.driverProfileId,
            session: "SPRINT",
          },
          select: { position: true, status: true, points: true, metadata: true },
        })
      : null;
  const calendarBefore =
    command.kind === "RACE_UPDATED"
      ? await tx.race.findUnique({
          where: { id: command.raceId },
          select: { name: true, date: true, round: true, status: true },
        })
      : null;
  const numberBefore =
    command.kind === "NUMBER_CORRECTED"
      ? await tx.seasonDriverEntry.findUnique({
          where: {
            seasonId_driverProfileId: {
              seasonId: command.seasonId,
              driverProfileId: command.driverProfileId,
            },
          },
          select: { number: true },
        })
      : null;

  const standingsBefore = seasonId ? await loadStandings(tx, seasonId) : [];
  const championBefore = seasonId ? championOf(standingsBefore) : null;

  await applyCorrectionWithinTransaction(tx, universeId, command);

  const standingsAfter = seasonId ? await loadStandings(tx, seasonId) : [];
  const championAfter = seasonId ? championOf(standingsAfter) : null;

  const changes: PreviewChange[] = [];

  if (command.kind === "RACE_RESULT_CORRECTED" && resultBefore) {
    const after = await tx.raceResult.findFirstOrThrow({
      where: { raceId: command.raceId, driverProfileId: command.driverProfileId },
      select: { position: true, grid: true, status: true, points: true },
    });
    for (const field of ["position", "grid", "status", "points"] as const) {
      if (resultBefore[field] !== after[field]) {
        changes.push({
          area: "RESULT",
          label: "Resultado",
          field,
          before: resultBefore[field],
          after: after[field],
        });
      }
    }
  }
  if (command.kind === "RACE_SESSION_RESULT_CORRECTED" && sprintBefore) {
    const after = await tx.raceSessionResult.findFirstOrThrow({
      where: {
        raceId: command.raceId,
        driverProfileId: command.driverProfileId,
        session: "SPRINT",
      },
      select: { position: true, status: true, points: true },
    });
    for (const field of ["position", "status", "points"] as const) {
      if (sprintBefore[field] !== after[field]) {
        changes.push({
          area: "RESULT",
          label: "Sprint",
          field,
          before: sprintBefore[field],
          after: after[field],
        });
      }
    }
  }
  if (command.kind === "RACE_UPDATED" && calendarBefore) {
    const after = await tx.race.findUniqueOrThrow({
      where: { id: command.raceId },
      select: { name: true, date: true, round: true, status: true },
    });
    const pairs: Array<[string, unknown, unknown]> = [
      ["name", calendarBefore.name, after.name],
      ["date", calendarBefore.date?.toISOString() ?? null, after.date?.toISOString() ?? null],
      ["round", calendarBefore.round, after.round],
      ["status", calendarBefore.status, after.status],
    ];
    for (const [field, before, after] of pairs) {
      if (before !== after) {
        changes.push({
          area: "CALENDAR",
          label: "Corrida",
          field,
          before: before as string | number | null,
          after: after as string | number | null,
        });
      }
    }
  }
  if (command.kind === "NUMBER_CORRECTED" && numberBefore) {
    const after = await tx.seasonDriverEntry.findUniqueOrThrow({
      where: {
        seasonId_driverProfileId: {
          seasonId: command.seasonId,
          driverProfileId: command.driverProfileId,
        },
      },
      select: { number: true },
    });
    if (numberBefore.number !== after.number) {
      changes.push({
        area: "NUMBER",
        label: "Número",
        field: "number",
        before: numberBefore.number,
        after: after.number,
      });
    }
  }

  const beforeMap = toStandingMap(standingsBefore);
  const afterMap = toStandingMap(standingsAfter);
  for (const [driverProfileId, after] of afterMap) {
    const before = beforeMap.get(driverProfileId);
    for (const field of ["position", "points", "wins", "podiums"] as const) {
      const beforeValue = before ? before[field] : null;
      if (beforeValue !== after[field]) {
        changes.push({
          area: "STANDING",
          label: driverProfileId,
          field,
          before: beforeValue,
          after: after[field],
        });
      }
    }
  }
  for (const [driverProfileId, before] of beforeMap) {
    if (!afterMap.has(driverProfileId)) {
      changes.push({
        area: "STANDING",
        label: driverProfileId,
        field: "position",
        before: before.position,
        after: null,
      });
    }
  }
  if (championBefore !== championAfter) {
    changes.push({
      area: "CHAMPION",
      label: "Campeão",
      field: "driverProfileId",
      before: championBefore,
      after: championAfter,
    });
  }

  const affectedRaceIds =
    command.kind === "RACE_RESULT_CORRECTED" ||
    command.kind === "RACE_SESSION_RESULT_CORRECTED" ||
    command.kind === "RACE_UPDATED"
      ? [command.raceId]
      : [];

  const narrativeStaleEventIds: string[] = [];
  for (const raceId of affectedRaceIds) {
    const events = await tx.event.findMany({
      where: { payload: { path: ["raceId"], equals: raceId } },
      select: { id: true },
    });
    narrativeStaleEventIds.push(...events.map((event) => event.id));
  }

  let numberImpact: CorrectionPreview["numberImpact"] = null;
  if (seasonId && championBefore !== championAfter) {
    const season = await tx.season.findUnique({
      where: { id: seasonId },
      select: { year: true },
    });
    if (season) {
      const nextSeason = await tx.season.findFirst({
        where: { universeId, year: season.year + 1 },
        select: { id: true },
      });
      if (nextSeason) {
        const holder = await tx.seasonDriverEntry.findFirst({
          where: { seasonId: nextSeason.id, number: 1 },
          select: { driverProfileId: true },
        });
        const expectedChampionId = championAfter;
        numberImpact = {
          seasonId: nextSeason.id,
          year: season.year + 1,
          currentHolderId: holder?.driverProfileId ?? null,
          expectedChampionId,
          requiresAction:
            expectedChampionId !== null &&
            holder !== null &&
            holder.driverProfileId !== expectedChampionId,
        };
      }
    }
  }

  return {
    previewToken: token,
    kind: command.kind,
    changes,
    championBefore,
    championAfter,
    narrativeStaleEventIds,
    numberImpact,
  };
}

export async function previewCorrection(
  universeId: string,
  command: CorrectionCommand,
): Promise<CorrectionPreview> {
  try {
    return await prisma.$transaction(async (tx) => {
      const report = await buildPreview(tx, universeId, command);
      throw new CorrectionPreviewAbort(report);
    });
  } catch (error) {
    if (error instanceof CorrectionPreviewAbort) return error.report;
    throw error;
  }
}
