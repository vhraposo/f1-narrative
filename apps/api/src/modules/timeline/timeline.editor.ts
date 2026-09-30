import { prisma } from "../../infrastructure/database/prisma.js";
import type { TimelineItem } from "./timeline.read.js";

const WORLD_KEY = "default";

export type TimelineEditorKind =
  | "RACE_RESULT"
  | "SPRINT"
  | "NUMBER"
  | "STANDING"
  | "RACE";

export type TimelineEditBlockedReason =
  | "NO_VISUAL_EDITOR"
  | "EVOLUTION_STALE"
  | "DERIVED_STANDING"
  | "RESULT_NOT_FOUND"
  | "DRIVER_NOT_IN_SEASON"
  | "RACE_NOT_FOUND"
  | "SEASON_NOT_FOUND"
  | "WORLD_STATE_MISSING";

export type TimelineEventEditModel = {
  editorKind: TimelineEditorKind | null;
  canEdit: boolean;
  blockedReason: TimelineEditBlockedReason | null;
  defaultWorldDate: string | null;
  suggestedSupersedesId: string | null;
  values: Record<string, string | number | null> | null;
  currentValues: Record<string, string | number | null> | null;
  narrativeStaleEventIds: string[];
};

const EDITABLE_CORRECTION_KINDS: readonly string[] = [
  "RACE_RESULT_CORRECTED",
  "RACE_SESSION_RESULT_CORRECTED",
  "NUMBER_CORRECTED",
  "STANDING_CORRECTED",
  "RACE_UPDATED",
];

async function narrativeStaleEventIds(raceId: string): Promise<string[]> {
  const events = await prisma.event.findMany({
    where: { payload: { path: ["raceId"], equals: raceId } },
    select: { id: true },
  });
  return events.map((event) => event.id);
}

async function worldDate(universeId: string): Promise<Date | null> {
  const world = await prisma.worldState.findUnique({
    where: { universeId_key: { universeId, key: WORLD_KEY } },
    select: { currentDate: true },
  });
  return world?.currentDate ?? null;
}

function notEditable(
  reason: TimelineEditBlockedReason,
  extra: Partial<TimelineEventEditModel> = {},
): TimelineEventEditModel {
  return {
    editorKind: null,
    canEdit: false,
    blockedReason: reason,
    defaultWorldDate: null,
    suggestedSupersedesId: null,
    values: null,
    currentValues: null,
    narrativeStaleEventIds: [],
    ...extra,
  };
}

function editable(
  editorKind: TimelineEditorKind,
  current: Date | null,
  item: TimelineItem,
  currentValues: Record<string, string | number | null> | null,
  narrativeStale: string[],
): TimelineEventEditModel {
  const supersedesId = EDITABLE_CORRECTION_KINDS.includes(item.kind)
    ? item.id
    : null;
  return {
    editorKind,
    canEdit: current !== null,
    blockedReason: current === null ? "WORLD_STATE_MISSING" : null,
    defaultWorldDate: current?.toISOString() ?? null,
    suggestedSupersedesId: supersedesId,
    values: item.values,
    currentValues,
    narrativeStaleEventIds: narrativeStale,
  };
}

export async function buildTimelineEventEditModel(
  universeId: string,
  item: TimelineItem,
): Promise<TimelineEventEditModel> {
  const current = await worldDate(universeId);
  const row = await prisma.timelineEvent.findFirst({
    where: { id: item.id, universeId },
    select: { payload: true },
  });
  if (!row) return notEditable("NO_VISUAL_EDITOR");
  const payload = (row.payload ?? {}) as Record<string, unknown>;

  if (item.kind === "RACE_RESULT_CORRECTED") {
    const raceId = typeof payload.raceId === "string" ? payload.raceId : null;
    const driverProfileId =
      typeof payload.driverProfileId === "string" ? payload.driverProfileId : null;
    if (!raceId || !driverProfileId) {
      return notEditable("RESULT_NOT_FOUND", { editorKind: "RACE_RESULT" });
    }

    const result = await prisma.raceResult.findFirst({
      where: { raceId, driverProfileId },
      select: {
        position: true,
        grid: true,
        status: true,
        points: true,
        race: { select: { seasonId: true } },
      },
    });
    if (!result) return notEditable("RESULT_NOT_FOUND", { editorKind: "RACE_RESULT" });

    const evolved = await prisma.timelineEvent.findFirst({
      where: {
        universeId,
        kind: "ATTRIBUTE_EVOLVED",
        payload: { path: ["seasonId"], equals: result.race.seasonId },
      },
      select: { id: true },
    });
    if (evolved) return notEditable("EVOLUTION_STALE", { editorKind: "RACE_RESULT" });

    return editable("RACE_RESULT", current, item, {
      position: result.position,
      grid: result.grid,
      status: result.status,
      points: result.points,
    }, await narrativeStaleEventIds(raceId));
  }

  if (item.kind === "RACE_SESSION_RESULT_CORRECTED") {
    const raceId = typeof payload.raceId === "string" ? payload.raceId : null;
    const driverProfileId =
      typeof payload.driverProfileId === "string" ? payload.driverProfileId : null;
    if (!raceId || !driverProfileId) {
      return notEditable("RESULT_NOT_FOUND", { editorKind: "SPRINT" });
    }

    const result = await prisma.raceSessionResult.findFirst({
      where: { raceId, driverProfileId, session: "SPRINT" },
      select: {
        position: true,
        status: true,
        points: true,
        metadata: true,
        race: { select: { seasonId: true } },
      },
    });
    if (!result) return notEditable("RESULT_NOT_FOUND", { editorKind: "SPRINT" });
    const eligibility = (result.metadata as {
      eligibility?: { neutralizedStart?: boolean; distancePct?: number };
    } | null)?.eligibility;

    const evolved = await prisma.timelineEvent.findFirst({
      where: {
        universeId,
        kind: "ATTRIBUTE_EVOLVED",
        payload: { path: ["seasonId"], equals: result.race.seasonId },
      },
      select: { id: true },
    });
    if (evolved) return notEditable("EVOLUTION_STALE", { editorKind: "SPRINT" });

    return editable("SPRINT", current, item, {
      position: result.position,
      status: result.status,
      points: result.points,
      neutralizedStart:
        eligibility?.neutralizedStart === undefined
          ? null
          : eligibility.neutralizedStart
            ? 1
            : 0,
      distancePct: eligibility?.distancePct ?? null,
    }, await narrativeStaleEventIds(raceId));
  }

    if (item.kind === "NUMBER_CORRECTED") {
    if (!item.season || !item.driver) {
      return notEditable("DRIVER_NOT_IN_SEASON", { editorKind: "NUMBER" });
    }
    const entry = await prisma.seasonDriverEntry.findUnique({
      where: {
        seasonId_driverProfileId: {
          seasonId: item.season.id,
          driverProfileId: item.driver.id,
        },
      },
      select: { number: true },
    });
    if (!entry) return notEditable("DRIVER_NOT_IN_SEASON", { editorKind: "NUMBER" });
    return editable("NUMBER", current, item, { number: entry.number }, []);
  }

  if (item.kind === "STANDING_CORRECTED") {
    if (!item.season || !item.driver) {
      return notEditable("SEASON_NOT_FOUND", { editorKind: "STANDING" });
    }
    const results = await prisma.raceResult.count({
      where: { race: { seasonId: item.season.id } },
    });
    if (results > 0) return notEditable("DERIVED_STANDING", { editorKind: "STANDING" });

    const standing = await prisma.championshipStanding.findUnique({
      where: {
        seasonId_driverProfileId: {
          seasonId: item.season.id,
          driverProfileId: item.driver.id,
        },
      },
      select: { points: true, wins: true, podiums: true, position: true },
    });
    return editable(
      "STANDING",
      current,
      item,
      standing
        ? {
            points: standing.points,
            wins: standing.wins,
            podiums: standing.podiums,
            position: standing.position,
          }
        : null,
      [],
    );
  }

  if (item.kind === "RACE_SCHEDULED" || item.kind === "RACE_UPDATED") {
    if (!item.race) return notEditable("RACE_NOT_FOUND");
    const race = await prisma.race.findFirst({
      where: { id: item.race.id, season: { universeId } },
      select: {
        name: true,
        date: true,
        round: true,
        status: true,
        sprintOverride: true,
      },
    });
    if (!race) return notEditable("RACE_NOT_FOUND");
    return editable(
      "RACE",
      current,
      item,
      {
        name: race.name,
        date: race.date ? race.date.toISOString() : null,
        round: race.round,
        status: race.status,
        sprintOverride:
          race.sprintOverride === null ? null : race.sprintOverride ? 1 : 0,
      },
      await narrativeStaleEventIds(item.race.id),
    );
  }

  return notEditable("NO_VISUAL_EDITOR");
}


