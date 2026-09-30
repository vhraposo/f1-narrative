import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import {
  deriveExperiences,
  filterApplicableExperiences,
  type CuratedExperienceInput,
  type PilotSportFacts,
} from "./pilot-experience.derive.js";
import { projectMemories } from "./pilot-experience.memory-rules.js";

type Db = PrismaClient | Prisma.TransactionClient;

export type ReconcileReport = {
  readonly experiences: {
    readonly created: number;
    readonly updated: number;
    readonly reactivated: number;
    readonly invalidated: number;
    readonly unchanged: number;
  };
  readonly memories: {
    readonly created: number;
    readonly superseded: number;
    readonly invalidated: number;
    readonly unchanged: number;
    readonly manualPreserved: number;
  };
};

const ZERO_REPORT: ReconcileReport = {
  experiences: { created: 0, updated: 0, reactivated: 0, invalidated: 0, unchanged: 0 },
  memories: { created: 0, superseded: 0, invalidated: 0, unchanged: 0, manualPreserved: 0 },
};

export type ReconcileInput = {
  readonly universeId: string;
  readonly characterId: string;
  readonly curated?: readonly CuratedExperienceInput[];
  readonly now?: Date;
};

export async function reconcilePilotExperiences(
  input: ReconcileInput,
  db: Db = prisma,
): Promise<ReconcileReport> {
  const now = input.now ?? new Date();
  const character = await db.character.findUnique({
    where: { id: input.characterId },
    select: {
      id: true,
      universeId: true,
      driverProfile: { select: { id: true } },
    },
  });
  if (!character || character.universeId !== input.universeId || !character.driverProfile) {
    return ZERO_REPORT;
  }
  const driverProfileId = character.driverProfile.id;

  const worldState = await db.worldState.findUnique({
    where: { universeId_key: { universeId: input.universeId, key: "default" } },
    select: { currentDate: true },
  });

  const [raceRows, standingRows, entryRows, relationshipRows, eventRows, invalidatedTitleRows, existingExperiences, existingMemories] =
    await Promise.all([
      db.raceResult.findMany({
        where: { driverProfileId, race: { season: { universeId: input.universeId } } },
        include: { race: { include: { season: { select: { id: true, year: true } } } } },
        orderBy: [{ race: { season: { year: "asc" } } }, { race: { round: "asc" } }],
      }),
      db.championshipStanding.findMany({
        where: { driverProfileId, season: { universeId: input.universeId } },
        include: { season: { select: { id: true, year: true, status: true } } },
      }),
      db.seasonDriverEntry.findMany({
        where: { driverProfileId, season: { universeId: input.universeId } },
        include: {
          season: { select: { id: true, year: true } },
          team: { select: { id: true, name: true } },
        },
        orderBy: [{ season: { year: "asc" } }],
      }),
      db.universeDriverRelationship.findMany({
        where: { universeId: input.universeId, characterId: input.characterId },
        orderBy: [{ createdAt: "asc" }],
      }),
      db.event.findMany({
        where: {
          importance: { in: ["HIGH", "CRITICAL"] },
          participants: { some: { characterId: input.characterId } },
        },
        orderBy: [{ worldDate: "asc" }],
      }),
      db.pilotExperience.findMany({
        where: {
          universeId: input.universeId,
          characterId: input.characterId,
          experienceType: "CHAMPIONSHIP",
          status: "INVALIDATED",
        },
        select: { id: true },
      }),
      db.pilotExperience.findMany({
        where: { universeId: input.universeId, characterId: input.characterId },
      }),
      db.memory.findMany({
        where: { universeId: input.universeId, participants: { some: { characterId: input.characterId } } },
      }),
    ]);

  const facts: PilotSportFacts = {
    races: raceRows.map((row) => ({
      raceId: row.raceId,
      seasonId: row.race.season.id,
      seasonYear: row.race.season.year,
      round: row.race.round,
      name: row.race.name,
      date: row.race.date,
      finished: row.race.status === "FINISHED",
      position: row.position,
      resultStatus: row.status,
      points: row.points,
    })),
    standings: standingRows
      .filter((row) => row.season.status === "FINISHED")
      .map((row) => ({
        seasonId: row.season.id,
        seasonYear: row.season.year,
        position: row.position,
        points: row.points,
        wins: row.wins,
      })),
    entries: entryRows.map((row) => ({
      seasonId: row.season.id,
      seasonYear: row.season.year,
      teamId: row.teamId,
      teamName: row.team?.name ?? null,
    })),
    relationships: relationshipRows.map((row) => ({
      id: row.id,
      kind: row.kind,
      state: row.state,
      displayName: row.displayName,
      validFrom: row.validFrom,
      validTo: row.validTo,
      updatedAt: row.updatedAt,
    })),
    narrativeEvents: eventRows.map((row) => ({
      id: row.id,
      title: row.title,
      importance: row.importance,
      worldDate: row.worldDate,
    })),
    invalidatedChampionshipExperienceIds: invalidatedTitleRows.map((row) => row.id),
    curated: input.curated ?? [],
  };

  const derived = filterApplicableExperiences(
    deriveExperiences(facts),
    worldState?.currentDate ?? null,
  );

  const report: {
    experiences: { created: number; updated: number; reactivated: number; invalidated: number; unchanged: number };
    memories: { created: number; superseded: number; invalidated: number; unchanged: number; manualPreserved: number };
  } = {
    experiences: { ...ZERO_REPORT.experiences },
    memories: { ...ZERO_REPORT.memories },
  };

  const experienceIdBySourceKey = new Map<string, string>();
  for (const experience of derived) {
    const existing = existingExperiences.find(
      (row) => row.source === experience.source && row.sourceKey === experience.sourceKey,
    );
    if (!existing) {
      const created = await db.pilotExperience.create({
        data: {
          universeId: input.universeId,
          characterId: input.characterId,
          experienceType: experience.experienceType,
          source: experience.source,
          sourceKey: experience.sourceKey,
          seasonYear: experience.seasonYear,
          seasonId: experience.seasonId,
          raceId: experience.raceId,
          eventId: experience.eventId,
          occurredAt: experience.occurredAt,
          salience: experience.salience,
          title: experience.title,
          summary: experience.summary,
        },
      });
      experienceIdBySourceKey.set(experience.sourceKey, created.id);
      report.experiences.created += 1;
      continue;
    }
    const changed =
      existing.experienceType !== experience.experienceType ||
      existing.salience !== experience.salience ||
      existing.title !== experience.title ||
      existing.summary !== experience.summary ||
      (existing.occurredAt?.getTime() ?? null) !== (experience.occurredAt?.getTime() ?? null) ||
      existing.seasonId !== experience.seasonId ||
      existing.raceId !== experience.raceId;
    if (existing.status === "ACTIVE") {
      if (changed) {
        await db.pilotExperience.update({
          where: { id: existing.id },
          data: {
            experienceType: experience.experienceType,
            salience: experience.salience,
            title: experience.title,
            summary: experience.summary,
            seasonYear: experience.seasonYear,
            seasonId: experience.seasonId,
            raceId: experience.raceId,
            occurredAt: experience.occurredAt,
            revision: existing.revision + 1,
          },
        });
        report.experiences.updated += 1;
      } else {
        report.experiences.unchanged += 1;
      }
    } else {
      await db.pilotExperience.update({
        where: { id: existing.id },
        data: {
          experienceType: experience.experienceType,
          salience: experience.salience,
          title: experience.title,
          summary: experience.summary,
          seasonYear: experience.seasonYear,
          seasonId: experience.seasonId,
          raceId: experience.raceId,
          occurredAt: experience.occurredAt,
          status: "ACTIVE",
          invalidationReason: null,
          revision: existing.revision + 1,
        },
      });
      report.experiences.reactivated += 1;
    }
    experienceIdBySourceKey.set(experience.sourceKey, existing.id);
  }

  const derivedKeys = new Set(derived.map((experience) => experience.sourceKey));
  for (const existing of existingExperiences) {
    if (existing.status !== "ACTIVE") continue;
    if (derivedKeys.has(existing.sourceKey)) continue;
    await db.pilotExperience.update({
      where: { id: existing.id },
      data: {
        status: "INVALIDATED",
        invalidationReason: "fonte não é mais válida",
        revision: existing.revision + 1,
      },
      select: { id: true },
    });
    report.experiences.invalidated += 1;
  }

  const activeExperiences = await db.pilotExperience.findMany({
    where: { universeId: input.universeId, characterId: input.characterId, status: "ACTIVE" },
  });
  const activeByKey = new Map(activeExperiences.map((row) => [`${row.source}:${row.sourceKey}`, row]));
  const derivedForProjection = derived.filter((experience) =>
    activeByKey.has(`${experience.source}:${experience.sourceKey}`),
  );
  const projected = projectMemories(derivedForProjection);

  const projectedKeys = new Set(projected.map((memory) => memory.derivedKey));
  for (const memory of existingMemories) {
    if (memory.derivation === "MANUAL") {
      report.memories.manualPreserved += 1;
      continue;
    }
    if (memory.status !== "ACTIVE") continue;
    if (memory.derivedKey === null || projectedKeys.has(memory.derivedKey)) continue;
    await db.memory.update({
      where: { id: memory.id },
      data: { status: "INVALIDATED", updatedByRevisionAt: now },
    });
    report.memories.invalidated += 1;
  }

  for (const memory of projected) {
    const row = activeByKey.get(`${memory.experience.source}:${memory.experience.sourceKey}`);
    if (!row) continue;
    const existingActive = existingMemories.find(
      (entry) => entry.derivedKey === memory.derivedKey && entry.status === "ACTIVE",
    );
    if (existingActive) {
      const changed =
        existingActive.content !== memory.content ||
        existingActive.memoryType !== memory.memoryType ||
        existingActive.importance !== memory.importance ||
        existingActive.experienceId !== row.id;
      if (!changed) {
        report.memories.unchanged += 1;
        continue;
      }
      await db.memory.update({
        where: { id: existingActive.id },
        data: { status: "SUPERSEDED", updatedByRevisionAt: now },
      });
      report.memories.superseded += 1;
      await db.memory.create({
        data: {
          universeId: input.universeId,
          memoryType: memory.memoryType,
          derivation: "RULE_DERIVED",
          status: "ACTIVE",
          revision: existingActive.revision + 1,
          experienceId: row.id,
          derivedKey: memory.derivedKey,
          importance: memory.importance,
          source: "GENERATED_EVENT",
          content: memory.content,
          summary: memory.summary,
          context: {
            ruleCode: memory.ruleCode,
            experienceSourceKey: memory.experience.sourceKey,
            experienceType: memory.experience.experienceType,
          } as Prisma.InputJsonValue,
          participants: { create: [{ characterId: input.characterId }] },
        },
      });
      report.memories.created += 1;
      continue;
    }

    const history = existingMemories.filter((entry) => entry.derivedKey === memory.derivedKey);
    const maxRevision = history.reduce((max, entry) => Math.max(max, entry.revision), 0);
    await db.memory.create({
      data: {
        universeId: input.universeId,
        memoryType: memory.memoryType,
        derivation: "RULE_DERIVED",
        status: "ACTIVE",
        revision: maxRevision + 1,
        experienceId: row.id,
        derivedKey: memory.derivedKey,
        importance: memory.importance,
        source: "GENERATED_EVENT",
        content: memory.content,
        summary: memory.summary,
        context: {
          ruleCode: memory.ruleCode,
          experienceSourceKey: memory.experience.sourceKey,
          experienceType: memory.experience.experienceType,
        } as Prisma.InputJsonValue,
        participants: { create: [{ characterId: input.characterId }] },
      },
    });
    report.memories.created += 1;
  }

  return report;
}

export type CorrectionInvalidationFilter = {
  readonly raceId?: string | null;
  readonly seasonId?: string | null;
};

export type CorrectionInvalidationReport = {
  readonly experiencesInvalidated: number;
  readonly memoriesInvalidated: number;
};

export async function invalidatePilotExperienceForCorrection(
  tx: Prisma.TransactionClient,
  universeId: string,
  filter: CorrectionInvalidationFilter,
  reason: string,
): Promise<CorrectionInvalidationReport> {
  const OR: Prisma.PilotExperienceWhereInput[] = [];
  if (filter.raceId) OR.push({ raceId: filter.raceId });
  if (filter.seasonId) OR.push({ seasonId: filter.seasonId });
  if (OR.length === 0) return { experiencesInvalidated: 0, memoriesInvalidated: 0 };

  const affected = await tx.pilotExperience.findMany({
    where: { universeId, status: "ACTIVE", OR },
    select: { id: true, revision: true },
  });
  if (affected.length === 0) return { experiencesInvalidated: 0, memoriesInvalidated: 0 };

  await tx.pilotExperience.updateMany({
    where: { id: { in: affected.map((row) => row.id) } },
    data: { status: "INVALIDATED", invalidationReason: reason },
  });

  const derivedMemories = await tx.memory.findMany({
    where: {
      universeId,
      status: "ACTIVE",
      derivation: { not: "MANUAL" },
      experienceId: { in: affected.map((row) => row.id) },
    },
    select: { id: true },
  });
  if (derivedMemories.length > 0) {
    await tx.memory.updateMany({
      where: { id: { in: derivedMemories.map((row) => row.id) } },
      data: { status: "INVALIDATED" },
    });
  }
  return {
    experiencesInvalidated: affected.length,
    memoriesInvalidated: derivedMemories.length,
  };
}
