import type { Prisma, TimelineEvent } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  DRIVER_NUMBER_RESERVED,
  inspectDriverNumber,
} from "../drivers/driver-number.rules.js";
import { findPreviousSeasonChampion } from "../drivers/driver-number.service.js";
import {
  appendTimelineEvent,
  createWorldSnapshot,
  lockUniverseTimeline,
  recomputeUniverseState,
  TimelineError,
  type Tx,
} from "./timeline.service.js";

export type CorrectionWorldDate = Date;

export interface RaceResultCorrectionCommand {
  kind: "RACE_RESULT_CORRECTED";
  worldDate: CorrectionWorldDate;
  raceId: string;
  driverProfileId: string;
  position?: number | null;
  grid?: number | null;
  status?: string | null;
  supersedesId?: string | null;
}

export interface SprintCorrectionCommand {
  kind: "RACE_SESSION_RESULT_CORRECTED";
  worldDate: CorrectionWorldDate;
  raceId: string;
  driverProfileId: string;
  position?: number | null;
  status?: string | null;
  eligibility?: { neutralizedStart: boolean; distancePct: number } | null;
  supersedesId?: string | null;
}

export interface NumberCorrectionCommand {
  kind: "NUMBER_CORRECTED";
  worldDate: CorrectionWorldDate;
  seasonId: string;
  driverProfileId: string;
  number: number | null;
  supersedesId?: string | null;
}

export interface StandingCorrectionCommand {
  kind: "STANDING_CORRECTED";
  worldDate: CorrectionWorldDate;
  seasonId: string;
  driverProfileId: string;
  points?: number;
  wins?: number;
  podiums?: number;
  position?: number | null;
  supersedesId?: string | null;
}

export interface CalendarCorrectionCommand {
  kind: "RACE_UPDATED";
  worldDate: CorrectionWorldDate;
  raceId: string;
  name?: string;
  date?: Date | null;
  round?: number;
  status?: string;
  sprintOverride?: boolean | null;
  supersedesId?: string | null;
}

export interface HistoricalChampionOverrideSetCommand {
  kind: "HISTORICAL_CHAMPION_OVERRIDE_SET";
  worldDate: CorrectionWorldDate;
  year: number;
  driverProfileId: string;
  supersedesId?: string | null;
}

export interface HistoricalChampionOverrideClearedCommand {
  kind: "HISTORICAL_CHAMPION_OVERRIDE_CLEARED";
  worldDate: CorrectionWorldDate;
  year: number;
  supersedesId?: string | null;
}

export type CorrectionCommand =
  | RaceResultCorrectionCommand
  | SprintCorrectionCommand
  | NumberCorrectionCommand
  | StandingCorrectionCommand
  | CalendarCorrectionCommand
  | HistoricalChampionOverrideSetCommand
  | HistoricalChampionOverrideClearedCommand;

const WORLD_KEY = "default";
const HISTORICAL_OVERRIDE_MIN_YEAR = 1900;
const HISTORICAL_OVERRIDE_MAX_YEAR = 2100;

function assertOverrideYear(year: number): void {
  if (
    !Number.isInteger(year) ||
    year < HISTORICAL_OVERRIDE_MIN_YEAR ||
    year > HISTORICAL_OVERRIDE_MAX_YEAR
  ) {
    throw correctionError(
      "INVALID_YEAR",
      `O ano deve estar entre ${HISTORICAL_OVERRIDE_MIN_YEAR} e ${HISTORICAL_OVERRIDE_MAX_YEAR}.`,
    );
  }
}

function correctionError(code: string, message: string, statusCode = 400): TimelineError {
  return new TimelineError(code, message, statusCode);
}

async function loadWorld(tx: Tx, universeId: string) {
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
  return world;
}

async function requireRace(tx: Tx, universeId: string, raceId: string) {
  const race = await tx.race.findFirst({
    where: { id: raceId, season: { universeId } },
    select: {
      id: true,
      seasonId: true,
      round: true,
      date: true,
      status: true,
      name: true,
    },
  });
  if (!race) {
    throw new TimelineError(
      "RACE_NOT_FOUND",
      "Corrida não pertence a este universo.",
      404,
    );
  }
  return race;
}

async function requireSeason(tx: Tx, universeId: string, seasonId: string) {
  const season = await tx.season.findFirst({
    where: { id: seasonId, universeId },
    select: { id: true, year: true },
  });
  if (!season) {
    throw new TimelineError(
      "SEASON_NOT_FOUND",
      "Temporada não pertence a este universo.",
      404,
    );
  }
  return season;
}

async function requireDriver(tx: Tx, universeId: string, driverProfileId: string) {
  const profile = await tx.driverProfile.findFirst({
    where: { id: driverProfileId, character: { universeId } },
    select: { id: true },
  });
  if (!profile) {
    throw new TimelineError(
      "DRIVER_NOT_FOUND",
      "Piloto não pertence a este universo.",
      404,
    );
  }
  return profile;
}

function assertPosition(value: number | null | undefined, field: string, minimum: number) {
  if (value === undefined || value === null) return;
  if (!Number.isInteger(value) || value < minimum) {
    throw correctionError(
      "INVALID_POSITION",
      `${field} deve ser um inteiro maior ou igual a ${minimum}.`,
    );
  }
}

async function assertSeasonEvolutionNotAffected(
  tx: Tx,
  universeId: string,
  seasonId: string,
) {
  const evolved = await tx.timelineEvent.findFirst({
    where: {
      universeId,
      kind: "ATTRIBUTE_EVOLVED",
      payload: { path: ["seasonId"], equals: seasonId },
    },
    select: { id: true },
  });
  if (evolved) {
    throw new TimelineError(
      "EVOLUTION_STALE",
      "A temporada já possui evolução aplicada; corrija a evolução antes de alterar resultados históricos.",
      409,
    );
  }
}

async function assertFinishedOrderPreserved(
  tx: Tx,
  universeId: string,
  raceId: string,
  next: { date?: Date | null; round?: number },
) {
  const races = await tx.race.findMany({
    where: { season: { universeId }, status: "FINISHED" },
    select: { id: true, date: true, round: true },
  });
  const target = races.find((race) => race.id === raceId);
  if (!target) return;

  function order(list: Array<{ id: string; date: Date | null; round: number | null }>) {
    return [...list]
      .sort((a, b) => {
        const dateA = a.date?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const dateB = b.date?.getTime() ?? Number.MAX_SAFE_INTEGER;
        if (dateA !== dateB) return dateA - dateB;
        const roundA = a.round ?? Number.MAX_SAFE_INTEGER;
        const roundB = b.round ?? Number.MAX_SAFE_INTEGER;
        if (roundA !== roundB) return roundA - roundB;
        return a.id.localeCompare(b.id);
      })
      .map((race) => race.id);
  }

  const before = order(races);
  const after = order(
    races.map((race) =>
      race.id === raceId
        ? {
            id: race.id,
            date: next.date !== undefined ? next.date : race.date,
            round: next.round !== undefined ? next.round : race.round,
          }
        : race,
    ),
  );
  if (before.join(",") !== after.join(",")) {
    throw new TimelineError(
      "SCHEDULE_ORDER_UNSAFE",
      "A alteração reordenaria corridas finalizadas; isso não é suportado na v1.",
      409,
    );
  }
}

export async function validateCorrectionCommand(
  tx: Tx,
  universeId: string,
  command: CorrectionCommand,
): Promise<void> {
  if (command.kind === "RACE_RESULT_CORRECTED") {
    const race = await requireRace(tx, universeId, command.raceId);
    await requireDriver(tx, universeId, command.driverProfileId);
    const result = await tx.raceResult.findFirst({
      where: { raceId: command.raceId, driverProfileId: command.driverProfileId },
      select: { id: true },
    });
    if (!result) {
      throw new TimelineError(
        "RESULT_NOT_FOUND",
        "O piloto não possui resultado nesta corrida.",
        404,
      );
    }
    assertPosition(command.position, "position", 1);
    assertPosition(command.grid, "grid", 0);
    await assertSeasonEvolutionNotAffected(tx, universeId, race.seasonId);
    if (
      command.position === undefined &&
      command.grid === undefined &&
      command.status === undefined
    ) {
      throw correctionError("EMPTY_CORRECTION", "Informe ao menos um campo para corrigir.");
    }
    return;
  }

  if (command.kind === "RACE_SESSION_RESULT_CORRECTED") {
    const race = await requireRace(tx, universeId, command.raceId);
    await requireDriver(tx, universeId, command.driverProfileId);
    const result = await tx.raceSessionResult.findFirst({
      where: {
        raceId: command.raceId,
        driverProfileId: command.driverProfileId,
        session: "SPRINT",
      },
      select: { id: true },
    });
    if (!result) {
      throw new TimelineError(
        "RESULT_NOT_FOUND",
        "O piloto não possui resultado de Sprint nesta corrida.",
        404,
      );
    }
    assertPosition(command.position, "position", 1);
    if (command.eligibility) {
      const distance = command.eligibility.distancePct;
      if (
        typeof distance !== "number" ||
        Number.isNaN(distance) ||
        distance < 0 ||
        distance > 100
      ) {
        throw correctionError(
          "INVALID_ELIGIBILITY",
          "distancePct deve estar entre 0 e 100.",
        );
      }
    }
    await assertSeasonEvolutionNotAffected(tx, universeId, race.seasonId);
    if (
      command.position === undefined &&
      command.status === undefined &&
      command.eligibility === undefined
    ) {
      throw correctionError("EMPTY_CORRECTION", "Informe ao menos um campo para corrigir.");
    }
    return;
  }

  if (command.kind === "NUMBER_CORRECTED") {
    const season = await requireSeason(tx, universeId, command.seasonId);
    await requireDriver(tx, universeId, command.driverProfileId);
    const entry = await tx.seasonDriverEntry.findUnique({
      where: {
        seasonId_driverProfileId: {
          seasonId: command.seasonId,
          driverProfileId: command.driverProfileId,
        },
      },
      select: { id: true },
    });
    if (!entry) {
      throw new TimelineError(
        "DRIVER_NOT_FOUND",
        "Piloto não participa desta temporada do universo.",
        404,
      );
    }
    if (command.number !== null) {
      const issue = inspectDriverNumber(command.number);
      if (issue === "NUMBER_RESERVED") {
        throw correctionError(
          "NUMBER_RESERVED",
          `O número ${DRIVER_NUMBER_RESERVED} é reservado e não pode ser usado.`,
        );
      }
      if (issue === "NUMBER_INVALID") {
        throw correctionError(
          "NUMBER_INVALID",
          "Número inválido para a temporada.",
        );
      }
      if (command.number === 1) {
        const champion = await findPreviousSeasonChampion(
          tx,
          universeId,
          season.year,
        );
        if (!champion || champion !== command.driverProfileId) {
          throw correctionError(
            "CHAMPION_ONLY",
            "O número 1 é exclusivo do campeão da temporada anterior.",
          );
        }
      }
      const occupant = await tx.seasonDriverEntry.findFirst({
        where: {
          seasonId: command.seasonId,
          number: command.number,
          driverProfileId: { not: command.driverProfileId },
        },
        select: { driverProfileId: true },
      });
      if (occupant) {
        throw new TimelineError(
          "NUMBER_ALREADY_USED",
          "Número já utilizado por outro piloto nesta temporada.",
          409,
        );
      }
    }
    return;
  }

  if (command.kind === "STANDING_CORRECTED") {
    await requireSeason(tx, universeId, command.seasonId);
    await requireDriver(tx, universeId, command.driverProfileId);
    const results = await tx.raceResult.count({
      where: { race: { seasonId: command.seasonId } },
    });
    if (results > 0) {
      throw correctionError(
        "DERIVED_STANDING",
        "Standing é derivado de resultados; corrija a causa (resultado) para temporadas com corridas.",
      );
    }
    if (
      command.points === undefined &&
      command.wins === undefined &&
      command.podiums === undefined &&
      command.position === undefined
    ) {
      throw correctionError("EMPTY_CORRECTION", "Informe ao menos um campo para corrigir.");
    }
    return;
  }

  if (
    command.kind === "HISTORICAL_CHAMPION_OVERRIDE_SET" ||
    command.kind === "HISTORICAL_CHAMPION_OVERRIDE_CLEARED"
  ) {
    assertOverrideYear(command.year);
    if (command.kind === "HISTORICAL_CHAMPION_OVERRIDE_SET") {
      await requireDriver(tx, universeId, command.driverProfileId);
    }
    return;
  }

  await requireRace(tx, universeId, command.raceId);
  if (command.round !== undefined && (!Number.isInteger(command.round) || command.round < 1)) {
    throw correctionError("INVALID_ROUND", "round deve ser um inteiro positivo.");
  }
  if (command.date !== undefined && command.date !== null) {
    if (Number.isNaN(command.date.getTime())) {
      throw correctionError("INVALID_DATE", "Data inválida.");
    }
  }
  if (command.name !== undefined && command.name.trim().length === 0) {
    throw correctionError("INVALID_NAME", "Nome não pode ser vazio.");
  }
  await assertFinishedOrderPreserved(tx, universeId, command.raceId, {
    ...(command.date !== undefined ? { date: command.date } : {}),
    ...(command.round !== undefined ? { round: command.round } : {}),
  });
  if (
    command.name === undefined &&
    command.date === undefined &&
    command.round === undefined &&
    command.status === undefined &&
    command.sprintOverride === undefined
  ) {
    throw correctionError("EMPTY_CORRECTION", "Informe ao menos um campo para corrigir.");
  }
}

export function correctionPayload(command: CorrectionCommand): Prisma.InputJsonValue {
  if (command.kind === "RACE_RESULT_CORRECTED") {
    return {
      raceId: command.raceId,
      driverProfileId: command.driverProfileId,
      ...(command.position !== undefined ? { position: command.position } : {}),
      ...(command.grid !== undefined ? { grid: command.grid } : {}),
      ...(command.status !== undefined ? { status: command.status } : {}),
    } as Prisma.InputJsonValue;
  }
  if (command.kind === "RACE_SESSION_RESULT_CORRECTED") {
    return {
      raceId: command.raceId,
      driverProfileId: command.driverProfileId,
      session: "SPRINT",
      ...(command.position !== undefined ? { position: command.position } : {}),
      ...(command.status !== undefined ? { status: command.status } : {}),
      ...(command.eligibility !== undefined
        ? { eligibility: command.eligibility }
        : {}),
    } as Prisma.InputJsonValue;
  }
  if (command.kind === "NUMBER_CORRECTED") {
    return {
      seasonId: command.seasonId,
      driverProfileId: command.driverProfileId,
      number: command.number,
    } as Prisma.InputJsonValue;
  }
  if (command.kind === "STANDING_CORRECTED") {
    return {
      seasonId: command.seasonId,
      driverProfileId: command.driverProfileId,
      ...(command.points !== undefined ? { points: command.points } : {}),
      ...(command.wins !== undefined ? { wins: command.wins } : {}),
      ...(command.podiums !== undefined ? { podiums: command.podiums } : {}),
      ...(command.position !== undefined ? { position: command.position } : {}),
    } as Prisma.InputJsonValue;
  }
  if (command.kind === "HISTORICAL_CHAMPION_OVERRIDE_SET") {
    return {
      year: command.year,
      driverProfileId: command.driverProfileId,
    } as Prisma.InputJsonValue;
  }
  if (command.kind === "HISTORICAL_CHAMPION_OVERRIDE_CLEARED") {
    return { year: command.year } as Prisma.InputJsonValue;
  }
  return {
    raceId: command.raceId,
    ...(command.name !== undefined ? { name: command.name } : {}),
    ...(command.date !== undefined
      ? { date: command.date ? command.date.toISOString() : null }
      : {}),
    ...(command.round !== undefined ? { round: command.round } : {}),
    ...(command.status !== undefined ? { status: command.status } : {}),
    ...(command.sprintOverride !== undefined
      ? { sprintOverride: command.sprintOverride }
      : {}),
  } as Prisma.InputJsonValue;
}

export async function assertCorrectionSupersession(
  tx: Tx,
  universeId: string,
  kind: CorrectionCommand["kind"],
  supersedesId: string | null | undefined,
): Promise<void> {
  if (!supersedesId) return;
  const target = await tx.timelineEvent.findFirst({
    where: { id: supersedesId, universeId },
    select: { id: true, kind: true },
  });
  if (!target) {
    throw new TimelineError(
      "SUPERSEDES_NOT_FOUND",
      "Evento a substituir não pertence a este universo.",
      404,
    );
  }
  if (target.kind !== kind) {
    throw new TimelineError(
      "SUPERSEDES_KIND_MISMATCH",
      "Só é permitido substituir evento do mesmo tipo.",
    );
  }
}

async function createPreCorrectionCheckpoint(
  tx: Tx,
  universeId: string,
  worldDate: Date,
): Promise<void> {
  const last = await tx.timelineEvent.aggregate({
    where: { universeId },
    _max: { sequence: true },
  });
  await createWorldSnapshot(tx, universeId, last._max.sequence ?? 0, worldDate);
}

export async function applyCorrectionWithinTransaction(
  tx: Tx,
  universeId: string,
  command: CorrectionCommand,
): Promise<TimelineEvent> {
  const world = await loadWorld(tx, universeId);
  if (command.worldDate.getTime() > world.currentDate.getTime()) {
    throw new TimelineError(
      "NOT_IN_PAST",
      "Correções retroativas exigem data igual ou anterior à data atual do mundo.",
    );
  }
  await validateCorrectionCommand(tx, universeId, command);
  await assertCorrectionSupersession(
    tx,
    universeId,
    command.kind,
    command.supersedesId,
  );
  await createPreCorrectionCheckpoint(tx, universeId, command.worldDate);

  const event = await appendTimelineEvent(tx, universeId, {
    kind: command.kind,
    worldDate: command.worldDate,
    payload: correctionPayload(command),
    causedBy: "USER",
    supersedesId: command.supersedesId ?? null,
  });

  await recomputeUniverseState(tx, universeId);
  return event;
}

export async function submitCorrection(
  universeId: string,
  command: CorrectionCommand,
): Promise<TimelineEvent> {
  return prisma.$transaction(async (tx) => {
    await lockUniverseTimeline(tx, universeId);
    return applyCorrectionWithinTransaction(tx, universeId, command);
  });
}
