import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { applyEventEvolution } from "../events/event-evolution.js";
import { pointsForPosition } from "../championship/championship-progression.engine.js";

export const RACE_NARRATIVE_ORIGIN = "RACE_RESULT";

export type RaceNarrativeKind =
  | "victory"
  | "pole"
  | "dnf"
  | "teammate-battle"
  | "lead-change";

export type RaceNarrativeEventType = "RACE" | "RACE_INCIDENT";
export type RaceNarrativeImportance = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RaceNarrativePayload {
  origin: typeof RACE_NARRATIVE_ORIGIN;
  seasonId: string;
  raceId: string;
  kind: RaceNarrativeKind;
  raceResultId?: string | null;
  driverAId?: string | null;
  driverBId?: string | null;
  fromId?: string | null;
  toId?: string | null;
}

export interface RaceNarrativeCandidate {
  key: string;
  type: RaceNarrativeEventType;
  importance: RaceNarrativeImportance;
  title: string;
  description: string | null;
  worldDate: Date | null;
  characterIds: string[];
  payload: RaceNarrativePayload;
}

export interface RaceNarrativeInput {
  raceId: string;
  seasonId: string;
  raceName: string;
  round: number | null;
  worldDate: Date | null;
  results: Array<{
    raceResultId: string;
    driverProfileId: string;
    characterId: string;
    driverName: string;
    position: number | null;
    grid: number | null;
    status: string | null;
  }>;
  teamByDriver: Map<string, string | null>;
  leaderBefore: string | null;
  leaderAfter: string | null;
}

function isDnf(
  position: number | null,
  status: string | null,
): boolean {
  return position === null && status === "Retired";
}

function victoryCandidate(
  input: RaceNarrativeInput,
  winner: RaceNarrativeInput["results"][number],
  runnerUp: RaceNarrativeInput["results"][number] | null,
): RaceNarrativeCandidate {
  return {
    key: `victory|${winner.raceResultId}`,
    type: "RACE",
    importance: "HIGH",
    title: `${winner.driverName} vence ${input.raceName}`,
    description: `${winner.driverName} cruzou a linha de chegada em primeiro lugar em ${input.raceName}.`,
    worldDate: input.worldDate,
    characterIds: runnerUp
      ? [winner.characterId, runnerUp.characterId]
      : [winner.characterId],
    payload: {
      origin: RACE_NARRATIVE_ORIGIN,
      seasonId: input.seasonId,
      raceId: input.raceId,
      kind: "victory",
      raceResultId: winner.raceResultId,
      driverAId: winner.driverProfileId,
      driverBId: runnerUp?.driverProfileId ?? null,
    },
  };
}

function poleCandidate(
  input: RaceNarrativeInput,
  pole: RaceNarrativeInput["results"][number],
): RaceNarrativeCandidate {
  return {
    key: `pole|${pole.raceResultId}`,
    type: "RACE",
    importance: "MEDIUM",
    title: `${pole.driverName} garante a pole em ${input.raceName}`,
    description: `${pole.driverName} largou da pole position em ${input.raceName}.`,
    worldDate: input.worldDate,
    characterIds: [pole.characterId],
    payload: {
      origin: RACE_NARRATIVE_ORIGIN,
      seasonId: input.seasonId,
      raceId: input.raceId,
      kind: "pole",
      raceResultId: pole.raceResultId,
      driverAId: pole.driverProfileId,
    },
  };
}

function dnfCandidate(
  input: RaceNarrativeInput,
  retired: RaceNarrativeInput["results"][number],
): RaceNarrativeCandidate {
  return {
    key: `dnf|${retired.raceResultId}`,
    type: "RACE_INCIDENT",
    importance: "MEDIUM",
    title: `${retired.driverName} abandona ${input.raceName}`,
    description: `${retired.driverName} não completou a corrida em ${input.raceName}.`,
    worldDate: input.worldDate,
    characterIds: [retired.characterId],
    payload: {
      origin: RACE_NARRATIVE_ORIGIN,
      seasonId: input.seasonId,
      raceId: input.raceId,
      kind: "dnf",
      raceResultId: retired.raceResultId,
      driverAId: retired.driverProfileId,
    },
  };
}

function teammateBattleCandidate(
  input: RaceNarrativeInput,
  driverA: RaceNarrativeInput["results"][number],
  driverB: RaceNarrativeInput["results"][number],
): RaceNarrativeCandidate {
  return {
    key: `teammate-battle|${[driverA.raceResultId, driverB.raceResultId]
      .sort()
      .join("|")}`,
    type: "RACE_INCIDENT",
    importance: "LOW",
    title: `Batalha entre companheiros em ${input.raceName}`,
    description: `${driverA.driverName} e ${driverB.driverName} disputaram posição durante ${input.raceName}.`,
    worldDate: input.worldDate,
    characterIds: [driverA.characterId, driverB.characterId],
    payload: {
      origin: RACE_NARRATIVE_ORIGIN,
      seasonId: input.seasonId,
      raceId: input.raceId,
      kind: "teammate-battle",
      driverAId: driverA.driverProfileId,
      driverBId: driverB.driverProfileId,
    },
  };
}

function leaderChangeCandidate(
  input: RaceNarrativeInput,
  from: RaceNarrativeInput["results"][number] | null,
  to: RaceNarrativeInput["results"][number] | null,
): RaceNarrativeCandidate | null {
  if (
    !input.leaderBefore ||
    !input.leaderAfter ||
    input.leaderBefore === input.leaderAfter
  ) {
    return null;
  }
  return {
    key: `lead-change|${input.leaderBefore}|${input.leaderAfter}`,
    type: "RACE",
    importance: "HIGH",
    title: `Mudança de liderança no campeonato em ${input.raceName}`,
    description: `${to?.driverName ?? "O novo líder"} assumiu a liderança do campeonato após ${input.raceName}.`,
    worldDate: input.worldDate,
    characterIds: [to?.characterId, from?.characterId].filter(
      (id): id is string => Boolean(id),
    ),
    payload: {
      origin: RACE_NARRATIVE_ORIGIN,
      seasonId: input.seasonId,
      raceId: input.raceId,
      kind: "lead-change",
      fromId: input.leaderBefore,
      toId: input.leaderAfter,
    },
  };
}

export function computeRaceNarrativeCandidates(
  input: RaceNarrativeInput,
): RaceNarrativeCandidate[] {
  const candidates = new Map<string, RaceNarrativeCandidate>();

  const ranked = [...input.results]
    .filter((result) => result.position !== null)
    .sort((a, b) => (a.position as number) - (b.position as number));
  const winner = ranked.find((result) => result.position === 1) ?? null;
  const runnerUp = ranked
    .filter((result) => result.position !== null && result.position !== 1)
    .sort((a, b) => (a.position as number) - (b.position as number))[0];
  if (winner) {
    candidates.set(winner.raceResultId, victoryCandidate(input, winner, runnerUp ?? null));
  }

  for (const result of input.results) {
    if (result.grid === 1) {
      candidates.set(`pole|${result.raceResultId}`, poleCandidate(input, result));
    }
    if (isDnf(result.position, result.status)) {
      candidates.set(`dnf|${result.raceResultId}`, dnfCandidate(input, result));
    }
  }

  const teamByDriver = input.teamByDriver;
  const byTeam = new Map<string, RaceNarrativeInput["results"]>();
  for (const result of input.results) {
    if (result.position === null) continue;
    const teamId = teamByDriver.get(result.driverProfileId);
    if (!teamId) continue;
    const list = byTeam.get(teamId) ?? [];
    list.push(result);
    byTeam.set(teamId, list);
  }
  for (const members of byTeam.values()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort(
      (a, b) => (a.position as number) - (b.position as number),
    );
    const first = sorted[0];
    const second = sorted[1];
    if (
      first.position !== null &&
      second.position !== null &&
      Math.abs(first.position - second.position) === 1
    ) {
      candidates.set(
        `teammate-battle|${[first.raceResultId, second.raceResultId]
          .sort()
          .join("|")}`,
        teammateBattleCandidate(input, first, second),
      );
    }
  }

  const from = input.results.find((r) => r.driverProfileId === input.leaderBefore);
  const to = input.results.find((r) => r.driverProfileId === input.leaderAfter);
  const lead = leaderChangeCandidate(input, from ?? null, to ?? null);
  if (lead) {
    candidates.set(lead.key, lead);
  }

  return [...candidates.values()];
}

export interface RaceNarrativeResult {
  raceId: string;
  created: RaceNarrativeCandidate[];
}

export async function processRaceNarrative(
  db: PrismaClient,
  raceId: string,
): Promise<RaceNarrativeResult | null> {
  const race = await db.race.findUnique({
    where: { id: raceId },
    select: { id: true, seasonId: true, name: true, round: true, date: true },
  });
  if (!race) return null;

  const [results, entries] = await Promise.all([
    db.raceResult.findMany({
      where: { raceId },
      select: {
        id: true,
        driverProfileId: true,
        position: true,
        grid: true,
        status: true,
        driverProfile: {
          select: {
            characterId: true,
            character: { select: { name: true } },
          },
        },
      },
    }),
    db.seasonDriverEntry.findMany({
      where: { seasonId: race.seasonId },
      select: { driverProfileId: true, teamId: true },
    }),
  ]);
  const teamByDriver = new Map(
    entries.map((entry) => [entry.driverProfileId, entry.teamId]),
  );

  const withNames = results.map((result) => ({
    raceResultId: result.id,
    driverProfileId: result.driverProfileId,
    characterId: result.driverProfile.characterId,
    driverName: result.driverProfile.character.name,
    position: result.position,
    grid: result.grid,
    status: result.status,
  }));

  const { leaderBefore, leaderAfter } = await computeLeaders(
    db,
    race.seasonId,
    race.round,
  );

  const candidates = computeRaceNarrativeCandidates({
    raceId: race.id,
    seasonId: race.seasonId,
    raceName: race.name,
    round: race.round,
    worldDate: race.date,
    results: withNames,
    teamByDriver,
    leaderBefore,
    leaderAfter,
  });

  const existing = await db.event.findMany({
    where: {
      source: "GENERATED_EVENT",
      payload: { path: ["raceId"], equals: race.id },
    },
    select: { payload: true },
  });
  const existingKeys = new Set<string>();
  for (const event of existing) {
    if (!event.payload || typeof event.payload !== "object") continue;
    const payload = event.payload as Record<string, unknown>;
    if (payload.origin !== RACE_NARRATIVE_ORIGIN) continue;
    const kind = typeof payload.kind === "string" ? payload.kind : "";
    const driverAId = typeof payload.driverAId === "string" ? payload.driverAId : "";
    const driverBId = typeof payload.driverBId === "string" ? payload.driverBId : "";
    const fromId = typeof payload.fromId === "string" ? payload.fromId : "";
    existingKeys.add(`${kind}|${driverAId}|${driverBId}|${fromId}`);
  }

  const created: RaceNarrativeCandidate[] = [];
  for (const candidate of candidates) {
    const payload = candidate.payload;
    const key = `${payload.kind}|${payload.driverAId ?? ""}|${payload.driverBId ?? ""}|${payload.fromId ?? ""}`;
    if (existingKeys.has(key)) continue;

    await db.$transaction(async (tx) => {
      const createdEvent = await tx.event.create({
        data: {
          type: candidate.type,
          importance: candidate.importance,
          title: candidate.title,
          description: candidate.description,
          source: "GENERATED_EVENT",
          worldDate: candidate.worldDate,
          payload: candidate.payload as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      if (candidate.characterIds.length > 0) {
        await tx.eventCharacter.createMany({
          data: candidate.characterIds.map((characterId) => ({
            eventId: createdEvent.id,
            characterId,
          })),
          skipDuplicates: true,
        });
      }
      await applyEventEvolution(tx, createdEvent.id);
      return createdEvent;
    });

    existingKeys.add(key);
    created.push({ ...candidate, key });
  }

  return { raceId: race.id, created };
}

async function computeLeaders(
  db: PrismaClient,
  seasonId: string,
  round: number | null,
): Promise<{ leaderBefore: string | null; leaderAfter: string | null }> {
  if (round === null) {
    return { leaderBefore: null, leaderAfter: null };
  }

  const rows = await db.raceResult.findMany({
    where: { race: { seasonId } },
    select: {
      driverProfileId: true,
      position: true,
      race: { select: { round: true } },
      driverProfile: {
        select: { character: { select: { name: true } } },
      },
    },
  });

  const sumBefore = new Map<string, { points: number; name: string }>();
  const sumAfter = new Map<string, { points: number; name: string }>();
  for (const row of rows) {
    const raceRound = row.race.round;
    if (raceRound === null) continue;
    const points = pointsForPosition(row.position);
    const name = row.driverProfile.character.name;
    if (raceRound < round) {
      const current = sumBefore.get(row.driverProfileId) ?? {
        points: 0,
        name,
      };
      current.points += points;
      sumBefore.set(row.driverProfileId, current);
    }
    if (raceRound <= round) {
      const current = sumAfter.get(row.driverProfileId) ?? { points: 0, name };
      current.points += points;
      sumAfter.set(row.driverProfileId, current);
    }
  }

  const top = (map: Map<string, { points: number; name: string }>) => {
    let best: { id: string; points: number; name: string } | null = null;
    for (const [id, value] of map) {
      if (
        best === null ||
        value.points > best.points ||
        (value.points === best.points && value.name < best.name)
      ) {
        best = { id, points: value.points, name: value.name };
      }
    }
    return best?.id ?? null;
  };

  return { leaderBefore: top(sumBefore), leaderAfter: top(sumAfter) };
}