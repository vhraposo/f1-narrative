import { createHash } from "node:crypto";

import { prisma } from "../../infrastructure/database/prisma.js";
import { retrieveRelevantMemories } from "../memory/memory.retrieval.js";
import {
  BEHAVIOR_CONTEXT_VERSION_PREFIX,
  BehaviorError,
  type BehaviorContextOmission,
  type BehaviorContextView,
  type BehaviorDecisionRequest,
} from "./behavior.types.js";

const MAX_MEMORIES = 10;
const MAX_EXPERIENCES = 10;
const MAX_RELATIONSHIPS = 20;
const MAX_MESSAGES = 10;
const MAX_SCHEDULE = 5;
const MAX_NEWS = 5;
const MAX_RESULTS = 5;

function parseDimensions(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number",
  );
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return Object.fromEntries(entries);
}

export async function buildBehaviorContext(
  request: BehaviorDecisionRequest,
): Promise<BehaviorContextView> {
  const character = await prisma.character.findUnique({
    where: { id: request.characterId },
    select: {
      id: true,
      universeId: true,
      controlledBy: true,
      name: true,
      nationality: true,
      biography: true,
      driverProfile: {
        select: {
          id: true,
          number: true,
          team: { select: { id: true, name: true } },
        },
      },
      persona: {
        select: {
          traits: {
            where: { context: "ON_TRACK" },
            select: { key: true, value: true, confidence: true },
            orderBy: [{ key: "asc" }],
          },
        },
      },
    },
  });
  if (!character) {
    throw new BehaviorError("BEHAVIOR_CHARACTER_NOT_FOUND", "Personagem não encontrado", 404);
  }
  if (character.universeId !== request.universeId) {
    throw new BehaviorError(
      "BEHAVIOR_UNIVERSE_MISMATCH",
      "Personagem não pertence ao Universe informado",
      403,
    );
  }

  const omitted: BehaviorContextOmission[] = [
    { section: "GOALS", reason: "GOALS_PENDING_V4_1" },
  ];

  const [worldState, experiences, relationships, availability, schedules] =
    await Promise.all([
      prisma.worldState.findUnique({
        where: { universeId_key: { universeId: request.universeId, key: "default" } },
        select: {
          currentDate: true,
          currentSeasonId: true,
          currentRaceId: true,
          currentSession: true,
        },
      }),
      prisma.pilotExperience.findMany({
        where: {
          universeId: request.universeId,
          characterId: request.characterId,
          status: "ACTIVE",
        },
        orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
        take: MAX_EXPERIENCES,
        select: {
          id: true,
          title: true,
          experienceType: true,
          salience: true,
          occurredAt: true,
        },
      }),
      prisma.relationship.findMany({
        where: {
          OR: [
            { characterAId: request.characterId },
            { characterBId: request.characterId },
          ],
        },
        orderBy: { id: "asc" },
        take: MAX_RELATIONSHIPS,
        select: {
          id: true,
          characterAId: true,
          characterBId: true,
          dimensions: true,
          characterA: { select: { name: true, controlledBy: true } },
          characterB: { select: { name: true, controlledBy: true } },
        },
      }),
      prisma.characterAvailability.findUnique({
        where: { characterId: request.characterId },
        select: { status: true, reason: true, until: true },
      }),
      prisma.characterSchedule.findMany({
        where: { characterId: request.characterId },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
        take: MAX_SCHEDULE * 2,
        select: { id: true, activity: true, startsAt: true, endsAt: true },
      }),
    ]);

  const scheduleDue = schedules
    .filter(
      (entry) =>
        entry.startsAt.getTime() <= request.worldDate.getTime() &&
        (entry.endsAt === null || entry.endsAt.getTime() >= request.worldDate.getTime()),
    )
    .slice(0, MAX_SCHEDULE);
  const scheduleUpcoming = schedules
    .filter((entry) => entry.startsAt.getTime() > request.worldDate.getTime())
    .slice(0, MAX_SCHEDULE);

  const [news, standing, recentResults] = await Promise.all([
    prisma.newsItem.findMany({
      orderBy: [{ worldDate: "desc" }, { id: "asc" }],
      take: MAX_NEWS,
      select: { id: true, title: true, worldDate: true },
    }),
    worldState?.currentSeasonId && character.driverProfile
      ? prisma.championshipStanding.findUnique({
          where: {
            seasonId_driverProfileId: {
              seasonId: worldState.currentSeasonId,
              driverProfileId: character.driverProfile.id,
            },
          },
          select: {
            seasonId: true,
            position: true,
            points: true,
            wins: true,
            podiums: true,
          },
        })
      : Promise.resolve(null),
    character.driverProfile
      ? prisma.raceResult.findMany({
          where: { driverProfileId: character.driverProfile.id },
          orderBy: [{ race: { date: "desc" } }, { id: "asc" }],
          take: MAX_RESULTS,
          select: {
            position: true,
            points: true,
            fastestLap: true,
            status: true,
            race: { select: { name: true, round: true, date: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  let teammate: BehaviorContextView["motorsport"]["teammate"] = null;
  if (character.driverProfile?.team) {
    const teammateProfile = await prisma.driverProfile.findFirst({
      where: {
        teamId: character.driverProfile.team.id,
        id: { not: character.driverProfile.id },
      },
      orderBy: { id: "asc" },
      select: {
        characterId: true,
        character: { select: { name: true } },
        championshipStandings: {
          where: { seasonId: worldState?.currentSeasonId ?? "__none__" },
          select: { position: true, points: true },
          take: 1,
        },
      },
    });
    if (teammateProfile) {
      const standing = teammateProfile.championshipStandings[0] ?? null;
      teammate = {
        characterId: teammateProfile.characterId,
        name: teammateProfile.character.name,
        position: standing?.position ?? null,
        points: standing?.points ?? 0,
      };
    }
  }

  let event: BehaviorContextView["currentState"]["event"] = null;
  if (request.eventId) {
    const loaded = await prisma.event.findUnique({
      where: { id: request.eventId },
      select: {
        id: true,
        type: true,
        importance: true,
        title: true,
        participants: { select: { characterId: true }, orderBy: { characterId: "asc" } },
      },
    });
    if (!loaded) {
      throw new BehaviorError("BEHAVIOR_EVENT_NOT_FOUND", "Evento não encontrado", 404);
    }
    event = {
      id: loaded.id,
      type: loaded.type,
      importance: loaded.importance,
      title: loaded.title,
      participantIds: loaded.participants.map((participant) => participant.characterId),
    };
  }

  let race: BehaviorContextView["currentState"]["race"] = null;
  if (request.raceId) {
    const loaded = await prisma.race.findUnique({
      where: { id: request.raceId },
      select: { id: true, name: true, round: true, status: true, date: true },
    });
    if (!loaded) {
      throw new BehaviorError("BEHAVIOR_RACE_NOT_FOUND", "Corrida não encontrada", 404);
    }
    race = loaded;
  }

  let conversation: BehaviorContextView["conversation"] = null;
  if (request.conversationId) {
    const loaded = await prisma.conversation.findUnique({
      where: { id: request.conversationId },
      select: {
        id: true,
        type: true,
        participants: {
          select: { characterId: true },
          orderBy: { characterId: "asc" },
        },
        messages: {
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: MAX_MESSAGES,
          select: {
            senderType: true,
            characterId: true,
            content: true,
            createdAt: true,
          },
        },
      },
    });
    if (!loaded) {
      throw new BehaviorError("BEHAVIOR_CONVERSATION_NOT_FOUND", "Conversa não encontrada", 404);
    }
    const participantIds = loaded.participants.map((participant) => participant.characterId);
    conversation = {
      id: loaded.id,
      type: loaded.type,
      participantIds,
      isParticipant: participantIds.includes(request.characterId),
      recentMessages: [...loaded.messages].reverse(),
    };
  } else {
    omitted.push({ section: "CONVERSATION", reason: "NO_CONVERSATION_IN_REQUEST" });
  }

  const memories = await retrieveRelevantMemories({
    universeId: request.universeId,
    characterId: request.characterId,
    participantIds: conversation?.participantIds ?? [],
    relationshipCharacterIds: relationships.map((relationship) =>
      relationship.characterAId === request.characterId
        ? relationship.characterBId
        : relationship.characterAId,
    ),
    worldDate: request.worldDate,
    now: request.worldDate,
    limit: MAX_MEMORIES,
  });

  if (!availability) omitted.push({ section: "AVAILABILITY", reason: "NO_AVAILABILITY_RECORD" });
  if (memories.length === 0) omitted.push({ section: "MEMORY", reason: "NO_ACTIVE_MEMORY" });
  if (experiences.length === 0) {
    omitted.push({ section: "EXPERIENCE", reason: "NO_ACTIVE_EXPERIENCE" });
  }
  if (relationships.length === 0) {
    omitted.push({ section: "RELATIONSHIPS", reason: "NO_RELATIONSHIP_RECORD" });
  }
  if (scheduleDue.length === 0 && scheduleUpcoming.length === 0) {
    omitted.push({ section: "SCHEDULE", reason: "NO_SCHEDULE_ENTRIES" });
  }
  if (news.length === 0) omitted.push({ section: "NEWS", reason: "NO_NEWS_ITEMS" });
  if (!character.driverProfile) {
    omitted.push({ section: "MOTORSPORT", reason: "NO_DRIVER_PROFILE" });
  }
  if ((character.persona?.traits.length ?? 0) === 0) {
    omitted.push({ section: "PERSONALITY", reason: "NO_ON_TRACK_TRAITS" });
  }

  const sections = {
    identity: {
      name: character.name,
      nationality: character.nationality,
      controller: character.controlledBy,
      biography: character.biography,
    },
    personality: {
      traits: character.persona?.traits ?? [],
    },
    currentState: {
      trigger: request.trigger,
      userInitiated: request.userInitiated,
      event,
      race,
      session: request.session ?? null,
    },
    goals: [] as readonly unknown[],
    memory: { recent: memories },
    experience: { recent: experiences },
    relationships: {
      entries: relationships.map((relationship) => {
        const other =
          relationship.characterAId === request.characterId
            ? relationship.characterB
            : relationship.characterA;
        return {
          id: relationship.id,
          otherCharacterId:
            relationship.characterAId === request.characterId
              ? relationship.characterBId
              : relationship.characterAId,
          otherName: other.name,
          otherController: other.controlledBy,
          dimensions: parseDimensions(relationship.dimensions),
        };
      }),
    },
    world: {
      currentDate: worldState?.currentDate ?? null,
      currentSeasonId: worldState?.currentSeasonId ?? null,
      currentRaceId: worldState?.currentRaceId ?? null,
      currentSession: worldState?.currentSession ?? null,
    },
    motorsport: {
      teamName: character.driverProfile?.team?.name ?? null,
      number: character.driverProfile?.number ?? null,
      standing,
      teammate,
      recentResults: recentResults.map((result) => ({
        raceName: result.race.name,
        round: result.race.round,
        date: result.race.date,
        position: result.position,
        points: result.points,
        fastestLap: result.fastestLap,
        status: result.status,
      })),
    },
    conversation,
    availability,
    schedule: { due: scheduleDue, upcoming: scheduleUpcoming },
    news: { recent: news },
  };

  const fingerprint = createHash("sha256")
    .update(JSON.stringify(sections))
    .digest("hex");

  return {
    version: `${BEHAVIOR_CONTEXT_VERSION_PREFIX}:${fingerprint.slice(0, 16)}`,
    fingerprint,
    assembledAt: request.worldDate,
    worldDate: request.worldDate,
    universeId: request.universeId,
    characterId: request.characterId,
    ...sections,
    omitted,
  };
}
