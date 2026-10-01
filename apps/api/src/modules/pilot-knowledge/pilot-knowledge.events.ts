import type {
  ExternalDriverEvent,
  ExternalDriverEventCategory,
  ExternalEventDerivation,
} from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import {
  computeF1dbDriverMilestones,
  getF1dbRaceLabel,
  resolveF1dbDriver,
  type F1dbMilestonePoint,
} from "../f1db/f1db.drivers.js";
import { getF1dbDataset } from "../f1db/f1db.dataset.js";
import { readDriverSourceIdentity } from "./pilot-knowledge.profile.js";
import { EVENTS_MAX } from "./pilot-knowledge.policy.js";
import { recordKnowledgeSource, type KnowledgeSourceInput } from "./pilot-knowledge.sources.js";

export const EVENT_CATEGORY_LABELS: Record<ExternalDriverEventCategory, string> = {
  F1_DEBUT: "Estreia na F1",
  FIRST_POINT: "Primeiros pontos",
  FIRST_PODIUM: "Primeiro pódio",
  FIRST_POLE: "Primeira pole",
  FIRST_WIN: "Primeira vitória",
  FIRST_FASTEST_LAP: "Primeira volta mais rápida",
  FIRST_CHAMPIONSHIP: "Primeiro campeonato",
  CHAMPIONSHIP: "Campeonato mundial",
  TEAM_CHANGE: "Mudança de equipe",
  MAJOR_CAREER_MILESTONE: "Marco de carreira",
  SIGNIFICANT_RACE: "Corrida marcante",
  CAREER_ENTRY: "Entrada na carreira",
};

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function resultKey(category: ExternalDriverEventCategory, round: number, seasonYear: number): string {
  return `${category}:${seasonYear}:r${round}`;
}

export async function deriveMilestonesFromExternalData(
  externalDriverId: string,
  now: Date = new Date(),
): Promise<readonly ExternalDriverEvent[]> {
  const driver = await prisma.externalDriver.findUnique({
    where: { id: externalDriverId },
    select: { id: true, name: true, sourceRecord: true },
  });
  if (!driver) return [];

  const [results, standings, seasons] = await Promise.all([
    prisma.externalResult.findMany({
      where: { externalDriverId },
      include: { externalRace: { select: { seasonYear: true, round: true, name: true, grandPrix: true, date: true } } },
      orderBy: [{ externalRace: { seasonYear: "asc" } }, { externalRace: { round: "asc" } }],
    }),
    prisma.externalStanding.findMany({
      where: { externalDriverId },
      orderBy: [{ seasonYear: "asc" }],
    }),
    prisma.externalDriverSeason.findMany({
      where: { externalDriverId },
      orderBy: [{ seasonYear: "asc" }],
    }),
  ]);

  type Derived = {
    category: ExternalDriverEventCategory;
    title: string;
    eventDate: Date | null;
    seasonYear: number | null;
    externalRaceId: string | null;
    summary: string | null;
    importance: number;
    dedupeKey: string;
    sourceId?: string | null;
  };
  const derived: Derived[] = [];
  const dataset = getF1dbDataset();

  const first = results[0];
  if (first) {
    derived.push({
      category: "F1_DEBUT",
      title: `Estreia na F1 em ${first.externalRace.seasonYear}`,
      eventDate: first.externalRace.date,
      seasonYear: first.externalRace.seasonYear,
      externalRaceId: first.externalRaceId,
      summary: `Primeira corrida registrada na carreira (${first.externalRace.name ?? first.externalRace.grandPrix ?? "corrida"}).`,
      importance: 5,
      dedupeKey: resultKey("F1_DEBUT", first.externalRace.round, first.externalRace.seasonYear),
    });
  }

  const firstWithPoints = results.find((result) => (result.points ?? 0) > 0);
  if (firstWithPoints) {
    derived.push({
      category: "FIRST_POINT",
      title: `Primeiros pontos em ${firstWithPoints.externalRace.seasonYear}`,
      eventDate: firstWithPoints.externalRace.date,
      seasonYear: firstWithPoints.externalRace.seasonYear,
      externalRaceId: firstWithPoints.externalRaceId,
      summary: `Primeiro resultado com pontos (${firstWithPoints.externalRace.name ?? "corrida"}).`,
      importance: 3,
      dedupeKey: resultKey(
        "FIRST_POINT",
        firstWithPoints.externalRace.round,
        firstWithPoints.externalRace.seasonYear,
      ),
    });
  }

  const firstPodium = results.find((result) => (result.position ?? 99) <= 3);
  if (firstPodium) {
    derived.push({
      category: "FIRST_PODIUM",
      title: `Primeiro pódio em ${firstPodium.externalRace.seasonYear}`,
      eventDate: firstPodium.externalRace.date,
      seasonYear: firstPodium.externalRace.seasonYear,
      externalRaceId: firstPodium.externalRaceId,
      summary: `Primeiro pódio (P${firstPodium.position}).`,
      importance: 4,
      dedupeKey: resultKey(
        "FIRST_PODIUM",
        firstPodium.externalRace.round,
        firstPodium.externalRace.seasonYear,
      ),
    });
  }

  const firstPole = results.find((result) => result.grid === 1);
  if (firstPole) {
    derived.push({
      category: "FIRST_POLE",
      title: `Primeira pole em ${firstPole.externalRace.seasonYear}`,
      eventDate: firstPole.externalRace.date,
      seasonYear: firstPole.externalRace.seasonYear,
      externalRaceId: firstPole.externalRaceId,
      summary: "Primeira largada em primeiro no grid registrada.",
      importance: 3,
      dedupeKey: resultKey("FIRST_POLE", firstPole.externalRace.round, firstPole.externalRace.seasonYear),
    });
  }

  const firstWin = results.find((result) => result.position === 1);
  if (firstWin) {
    derived.push({
      category: "FIRST_WIN",
      title: `Primeira vitória em ${firstWin.externalRace.seasonYear}`,
      eventDate: firstWin.externalRace.date,
      seasonYear: firstWin.externalRace.seasonYear,
      externalRaceId: firstWin.externalRaceId,
      summary: `Primeira vitória (${firstWin.externalRace.name ?? "corrida"}).`,
      importance: 5,
      dedupeKey: resultKey("FIRST_WIN", firstWin.externalRace.round, firstWin.externalRace.seasonYear),
    });
  }

  const firstFastestLap = results.find((result) => result.fastestLap === true);
  if (firstFastestLap) {
    derived.push({
      category: "FIRST_FASTEST_LAP",
      title: `Primeira volta mais rápida em ${firstFastestLap.externalRace.seasonYear}`,
      eventDate: firstFastestLap.externalRace.date,
      seasonYear: firstFastestLap.externalRace.seasonYear,
      externalRaceId: firstFastestLap.externalRaceId,
      summary: firstFastestLap.fastestLapTime
        ? `Primeira volta mais rápida (${firstFastestLap.fastestLapTime}).`
        : `Primeira volta mais rápida registrada (${firstFastestLap.externalRace.name ?? "corrida"}).`,
      importance: 4,
      dedupeKey: resultKey(
        "FIRST_FASTEST_LAP",
        firstFastestLap.externalRace.round,
        firstFastestLap.externalRace.seasonYear,
      ),
    });
  }

  const titles = standings.filter(
    (standing) =>
      standing.position === 1 &&
      (dataset === null || dataset.championsByYear.has(standing.seasonYear)),
  );
  for (const title of titles) {
    derived.push({
      category: "CHAMPIONSHIP",
      title: `Campeão mundial em ${title.seasonYear}`,
      eventDate: null,
      seasonYear: title.seasonYear,
      externalRaceId: null,
      summary: null,
      importance: 5,
      dedupeKey: `CHAMPIONSHIP:${title.seasonYear}`,
    });
  }
  const firstTitle = titles[0];
  if (firstTitle) {
    derived.push({
      category: "FIRST_CHAMPIONSHIP",
      title: `Primeiro título mundial em ${firstTitle.seasonYear}`,
      eventDate: null,
      seasonYear: firstTitle.seasonYear,
      externalRaceId: null,
      summary: null,
      importance: 5,
      dedupeKey: `FIRST_CHAMPIONSHIP:${firstTitle.seasonYear}`,
    });
  }

  for (let index = 1; index < seasons.length; index += 1) {
    const previous = seasons[index - 1];
    const current = seasons[index];
    if (!previous || !current) continue;
    const previousTeam = previous.teamNameSnapshot ?? previous.teamExternalId ?? null;
    const currentTeam = current.teamNameSnapshot ?? current.teamExternalId ?? null;
    if (previousTeam !== null && currentTeam !== null && previousTeam !== currentTeam) {
      derived.push({
        category: "TEAM_CHANGE",
        title: `Mudança para ${currentTeam} em ${current.seasonYear}`,
        eventDate: null,
        seasonYear: current.seasonYear,
        externalRaceId: null,
        summary: `Saiu de ${previousTeam} para ${currentTeam}.`,
        importance: 3,
        dedupeKey: `TEAM_CHANGE:${current.seasonYear}:${slug(currentTeam)}`,
      });
    }
  }

  if (dataset) {
    const sourceIdentity = readDriverSourceIdentity(driver.sourceRecord);
    const f1dbDriver = resolveF1dbDriver({
      name: driver.name,
      driverCode: sourceIdentity.driverCode,
    });
    const milestones = f1dbDriver
      ? computeF1dbDriverMilestones(f1dbDriver.id)
      : null;
    if (f1dbDriver && milestones) {
      let f1dbSourceId: string | null = null;
      const ensureSource = async () => {
        if (f1dbSourceId) return f1dbSourceId;
        const source = await recordKnowledgeSource(
          {
            provider: "F1DB",
            sourceKind: "STRUCTURED_RELEASE",
            url: `https://github.com/f1db/f1db/releases/tag/${dataset.sourceVersion}`,
            title: `F1DB release ${dataset.sourceVersion}`,
            license: "CC_BY_4_0",
            attributionRequirement: "Obrigatória",
            attributionText: "F1DB — CC BY 4.0",
            sourceVersion: dataset.sourceVersion,
          },
          now,
        );
        f1dbSourceId = source.id;
        return f1dbSourceId;
      };

      const applyMilestone = async (
        category: ExternalDriverEventCategory,
        point: F1dbMilestonePoint | null,
        title: string,
        summary: string,
        importance: number,
      ) => {
        if (!point) return;
        const existing = derived.find((item) => item.category === category);
        if (existing && (existing.seasonYear ?? Number.MAX_SAFE_INTEGER) <= point.year) {
          return;
        }
        const race = dataset.racesById.get(point.raceId);
        const sourceId = await ensureSource();
        const candidate: Derived = {
          category,
          title,
          eventDate: race?.date ? new Date(`${race.date}T00:00:00.000Z`) : null,
          seasonYear: point.year,
          externalRaceId: null,
          summary,
          importance,
          dedupeKey: `f1db:${category}:${point.year}:r${point.round}`,
          sourceId,
        };
        if (existing) {
          const index = derived.indexOf(existing);
          derived[index] = candidate;
        } else {
          derived.push(candidate);
        }
      };

      const raceLabel = (point: F1dbMilestonePoint) =>
        getF1dbRaceLabel(point.raceId) ?? "corrida";

      await applyMilestone(
        "F1_DEBUT",
        milestones.debut,
        milestones.debut ? `Estreia na F1 em ${milestones.debut.year}` : "",
        milestones.debut
          ? `Primeira corrida registrada na carreira (${raceLabel(milestones.debut)}).`
          : "",
        5,
      );
      await applyMilestone(
        "FIRST_POINT",
        milestones.firstPoints,
        milestones.firstPoints
          ? `Primeiros pontos em ${milestones.firstPoints.year}`
          : "",
        milestones.firstPoints
          ? `Primeiro resultado com pontos (${raceLabel(milestones.firstPoints)}).`
          : "",
        3,
      );
      await applyMilestone(
        "FIRST_PODIUM",
        milestones.firstPodium,
        milestones.firstPodium
          ? `Primeiro pódio em ${milestones.firstPodium.year}`
          : "",
        milestones.firstPodium
          ? `Primeiro pódio (${raceLabel(milestones.firstPodium)}).`
          : "",
        4,
      );
      await applyMilestone(
        "FIRST_POLE",
        milestones.firstPole,
        milestones.firstPole ? `Primeira pole em ${milestones.firstPole.year}` : "",
        milestones.firstPole
          ? `Primeira largada em primeiro no grid (${raceLabel(milestones.firstPole)}).`
          : "",
        3,
      );
      await applyMilestone(
        "FIRST_WIN",
        milestones.firstWin,
        milestones.firstWin ? `Primeira vitória em ${milestones.firstWin.year}` : "",
        milestones.firstWin
          ? `Primeira vitória (${raceLabel(milestones.firstWin)}).`
          : "",
        5,
      );
      await applyMilestone(
        "FIRST_FASTEST_LAP",
        milestones.firstFastestLap,
        milestones.firstFastestLap
          ? `Primeira volta mais rápida em ${milestones.firstFastestLap.year}`
          : "",
        milestones.firstFastestLap
          ? `Primeira volta mais rápida (${raceLabel(milestones.firstFastestLap)}).`
          : "",
        4,
      );

      for (const year of milestones.championshipYears) {
        const key = `CHAMPIONSHIP:${year}`;
        if (derived.some((item) => item.dedupeKey === key)) continue;
        const sourceId = await ensureSource();
        derived.push({
          category: "CHAMPIONSHIP",
          title: `Campeão mundial em ${year}`,
          eventDate: null,
          seasonYear: year,
          externalRaceId: null,
          summary: null,
          importance: 5,
          dedupeKey: key,
          sourceId,
        });
      }
      const firstTitleYear = milestones.championshipYears[0];
      if (firstTitleYear !== undefined) {
        const existing = derived.find((item) => item.category === "FIRST_CHAMPIONSHIP");
        if (!existing || (existing.seasonYear ?? Number.MAX_SAFE_INTEGER) > firstTitleYear) {
          const sourceId = await ensureSource();
          const candidate: Derived = {
            category: "FIRST_CHAMPIONSHIP",
            title: `Primeiro título mundial em ${firstTitleYear}`,
            eventDate: null,
            seasonYear: firstTitleYear,
            externalRaceId: null,
            summary: null,
            importance: 5,
            dedupeKey: `FIRST_CHAMPIONSHIP:${firstTitleYear}`,
            sourceId,
          };
          if (existing) {
            const index = derived.indexOf(existing);
            derived[index] = candidate;
          } else {
            derived.push(candidate);
          }
        }
      }
    }
  }

  const dedupeKeys = derived.map((item) => item.dedupeKey);
  for (const item of derived) {
    await prisma.externalDriverEvent.upsert({
      where: { externalDriverId_dedupeKey: { externalDriverId, dedupeKey: item.dedupeKey } },
      create: {
        externalDriverId,
        category: item.category,
        title: item.title,
        eventDate: item.eventDate,
        seasonYear: item.seasonYear,
        externalRaceId: item.externalRaceId,
        summary: item.summary,
        importance: item.importance,
        derivation: "DERIVED_RESULTS",
        dedupeKey: item.dedupeKey,
        sourceId: item.sourceId ?? null,
      },
      update: {
        title: item.title,
        eventDate: item.eventDate,
        seasonYear: item.seasonYear,
        externalRaceId: item.externalRaceId,
        summary: item.summary,
        importance: item.importance,
        sourceId: item.sourceId ?? null,
        updatedAt: now,
      },
    });
  }
  await prisma.externalDriverEvent.deleteMany({
    where: {
      externalDriverId,
      derivation: "DERIVED_RESULTS",
      ...(dedupeKeys.length > 0 ? { dedupeKey: { notIn: dedupeKeys } } : {}),
    },
  });
  return prisma.externalDriverEvent.findMany({
    where: { externalDriverId, derivation: "DERIVED_RESULTS" },
    orderBy: [{ importance: "desc" }, { seasonYear: "asc" }],
  });
}

export type CuratedEventInput = {
  readonly category: ExternalDriverEventCategory;
  readonly title: string;
  readonly eventDate?: Date | null;
  readonly seasonYear?: number | null;
  readonly externalRaceId?: string | null;
  readonly summary?: string | null;
  readonly importance?: number;
  readonly source: KnowledgeSourceInput;
};

export async function ingestCuratedDriverEvents(
  externalDriverId: string,
  inputs: readonly CuratedEventInput[],
  now: Date = new Date(),
): Promise<readonly ExternalDriverEvent[]> {
  const driver = await prisma.externalDriver.findUnique({
    where: { id: externalDriverId },
    select: { id: true },
  });
  if (!driver) return [];
  const saved: ExternalDriverEvent[] = [];
  for (const input of inputs) {
    const source = await recordKnowledgeSource(input.source, now);
    const dedupeKey =
      input.category === "SIGNIFICANT_RACE" || input.category === "MAJOR_CAREER_MILESTONE"
        ? `curated:${input.category}:${slug(input.title)}:${input.seasonYear ?? "na"}`
        : `curated:${input.category}:${input.seasonYear ?? "na"}:${slug(input.title)}`;
    saved.push(
      await prisma.externalDriverEvent.upsert({
        where: { externalDriverId_dedupeKey: { externalDriverId, dedupeKey } },
        create: {
          externalDriverId,
          category: input.category,
          title: input.title,
          eventDate: input.eventDate ?? null,
          seasonYear: input.seasonYear ?? null,
          externalRaceId: input.externalRaceId ?? null,
          summary: input.summary ?? null,
          importance: input.importance ?? 3,
          derivation: "CURATED_SOURCE",
          sourceId: source.id,
          dedupeKey,
        },
        update: {
          title: input.title,
          eventDate: input.eventDate ?? null,
          seasonYear: input.seasonYear ?? null,
          externalRaceId: input.externalRaceId ?? null,
          summary: input.summary ?? null,
          importance: input.importance ?? 3,
          sourceId: source.id,
          updatedAt: now,
        },
      }),
    );
  }
  return saved;
}

export type RelevanceEventInput = {
  readonly id: string;
  readonly category: ExternalDriverEventCategory;
  readonly title: string;
  readonly seasonYear: number | null;
  readonly eventDate: Date | null;
  readonly importance: number;
  readonly externalRaceId: string | null;
  readonly raceName: string | null;
};

export function selectRelevantEvents<T extends RelevanceEventInput>(
  events: readonly T[],
  topic: string | null | undefined,
  limit: number = EVENTS_MAX,
): readonly T[] {
  const normalizedTopic = topic?.trim().toLowerCase() ?? "";
  const yearMatch = /\b(19|20)\d{2}\b/.exec(normalizedTopic);
  const mentionedYear = yearMatch ? Number(yearMatch[0]) : null;

  const scored = events.map((event) => {
    let score = event.importance;
    if (mentionedYear !== null && event.seasonYear === mentionedYear) score += 10;
    if (normalizedTopic.length > 0 && event.raceName) {
      const raceName = event.raceName.toLowerCase();
      if (normalizedTopic.includes(raceName) || raceName.includes(normalizedTopic)) score += 8;
    }
    if (normalizedTopic.length > 0 && normalizedTopic.includes(event.title.toLowerCase())) score += 6;
    return { event, score };
  });

  return scored
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aDate = a.event.eventDate?.getTime() ?? 0;
      const bDate = b.event.eventDate?.getTime() ?? 0;
      if (bDate !== aDate) return bDate - aDate;
      return a.event.id.localeCompare(b.event.id);
    })
    .slice(0, limit)
    .map((entry) => entry.event);
}

export type DriverEventView = {
  readonly id: string;
  readonly category: ExternalDriverEventCategory;
  readonly categoryLabel: string;
  readonly title: string;
  readonly summary: string | null;
  readonly seasonYear: number | null;
  readonly eventDate: Date | null;
  readonly importance: number;
  readonly derivation: ExternalEventDerivation;
  readonly externalRaceId: string | null;
  readonly raceName: string | null;
  readonly link: { readonly seasonId: string | null; readonly raceId: string | null };
};

export type PilotHistoryView =
  | { readonly available: false; readonly reason: "CHARACTER_NOT_FOUND" | "NO_EXTERNAL_BINDING" }
  | {
      readonly available: true;
      readonly events: readonly DriverEventView[];
      readonly relevant: readonly DriverEventView[];
    };

export async function getPilotHistoryView(
  characterId: string,
  options: { readonly topic?: string | null; readonly limit?: number } = {},
): Promise<PilotHistoryView> {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { universeId: true, externalDriverBindings: { take: 1, select: { externalDriverId: true } } },
  });
  if (!character) return { available: false, reason: "CHARACTER_NOT_FOUND" };
  const binding = character.externalDriverBindings[0];
  if (!binding) return { available: false, reason: "NO_EXTERNAL_BINDING" };

  const rows = await prisma.externalDriverEvent.findMany({
    where: { externalDriverId: binding.externalDriverId },
    include: { externalRace: { select: { name: true, grandPrix: true } } },
  });
  if (rows.length === 0) return { available: true, events: [], relevant: [] };

  const seasonYears = [...new Set(rows.map((row) => row.seasonYear).filter((year): year is number => year !== null))];
  const seasons = character.universeId
    ? await prisma.season.findMany({
        where: { universeId: character.universeId, year: { in: seasonYears } },
        select: { id: true, year: true },
      })
    : [];
  const seasonByYear = new Map(seasons.map((season) => [season.year, season.id]));
  const externalRaceIds = [...new Set(rows.map((row) => row.externalRaceId).filter((id): id is string => id !== null))];
  const raceBindings = externalRaceIds.length && character.universeId
    ? await prisma.externalBindingRace.findMany({
        where: { universeId: character.universeId, externalRaceId: { in: externalRaceIds } },
        select: { externalRaceId: true, raceId: true },
      })
    : [];
  const raceBindingByExternalId = new Map(raceBindings.map((row) => [row.externalRaceId, row.raceId]));

  const events: DriverEventView[] = rows
    .map((row) => ({
      id: row.id,
      category: row.category,
      categoryLabel: EVENT_CATEGORY_LABELS[row.category],
      title: row.title,
      summary: row.summary,
      seasonYear: row.seasonYear,
      eventDate: row.eventDate,
      importance: row.importance,
      derivation: row.derivation,
      externalRaceId: row.externalRaceId,
      raceName: row.externalRace?.name ?? row.externalRace?.grandPrix ?? null,
      link: {
        seasonId: row.seasonYear !== null ? (seasonByYear.get(row.seasonYear) ?? null) : null,
        raceId: row.externalRaceId ? (raceBindingByExternalId.get(row.externalRaceId) ?? null) : null,
      },
    }))
    .sort((a, b) => {
      const aDate = a.eventDate?.getTime() ?? 0;
      const bDate = b.eventDate?.getTime() ?? 0;
      if (bDate !== aDate) return bDate - aDate;
      if (b.importance !== a.importance) return b.importance - a.importance;
      return a.id.localeCompare(b.id);
    });

  const relevant = [...selectRelevantEvents(events, options.topic ?? null, options.limit ?? EVENTS_MAX)].sort(
    (a, b) => {
      const aDate = a.eventDate?.getTime() ?? 0;
      const bDate = b.eventDate?.getTime() ?? 0;
      if (bDate !== aDate) return bDate - aDate;
      return a.id.localeCompare(b.id);
    },
  );
  return { available: true, events, relevant };
}
