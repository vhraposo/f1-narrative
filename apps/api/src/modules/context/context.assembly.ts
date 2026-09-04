import {
  type CharacterController,
  type ConversationType,
  type EventImportance,
  type MemoryImportance,
  type MessageSenderType,
  type RaceSession,
  type PrismaClient,
  type Prisma,
} from "@prisma/client";
import type { ExternalRagContext } from "../external-research/external-rag-adapter.js";

// ---------------------------------------------------------------------------
// Assembly Context — Fase 12 (determinístico, SEM LLM).
//
// Este módulo é SOMENTE leitura/composição. Ele seleciona e ordena conteúdo
// autorizado de uma Conversation para uma futura camada de geração. Não escreve
// no banco, não chama provedor de IA, não altera WorldState e não faz pesquisa
// externa (Fase 13).
//
// Determinismo: dada a mesma base + o mesmo estado, a seleção e a ordem são
// idênticas. Todo orderBy usa chaves explícitas + desempate final por `id`
// lexicográfico ascendente. Não usamos now()/aleatório na decisão de conteúdo.
// ---------------------------------------------------------------------------

// Limites máximos (janela/política de seleção).
export const MESSAGE_WINDOW = 50;
export const MEMORY_LIMIT = 15;
export const EVENT_LIMIT = 10;
export const RELATIONSHIP_LIMIT = 10;
export const NEWS_LIMIT = 8;
export const RACE_LIMIT = 10;
export const STANDING_LIMIT = 10;
export const RESULT_LIMIT = 20;

const WORLD_KEY = "default";

// ---------------------------------------------------------------------------
// Tipos de saída (contrato abstrato `AssembledContext`).
// ---------------------------------------------------------------------------

export interface ContextParticipant {
  characterId: string;
  name: string;
  nationality: string;
  controlledBy: CharacterController;
  isAIParticipant: boolean;
}

export interface ContextMessageView {
  id: string;
  senderType: MessageSenderType;
  characterId: string | null;
  content: string;
  createdAt: string;
}

export interface ContextMemoryView {
  id: string;
  content: string;
  summary: string | null;
  importance: MemoryImportance;
  source: string;
  emotionalImpact: number | null;
  eventId: string | null;
  createdAt: string;
  participantCharacterIds: string[];
}

export interface ContextEventView {
  id: string;
  type: string;
  importance: EventImportance;
  title: string;
  description: string | null;
  worldDate: string | null;
  participantCharacterIds: string[];
}

export interface ContextRelationshipView {
  id: string;
  characterAId: string;
  characterBId: string;
  characterAName: string;
  characterBName: string;
  dimensions: Prisma.JsonValue;
}

export interface ContextNewsView {
  id: string;
  eventId: string | null;
  title: string;
  body: string | null;
  worldDate: string | null;
}

export interface ContextDriverBrief {
  characterId: string;
  name: string;
  number: number | null;
  teamName: string | null;
}

export interface ContextRaceBrief {
  id: string;
  name: string;
  circuit: string | null;
  date: string | null;
  round: number | null;
  status: string;
}

export interface ContextResultBrief {
  driverProfileId: string;
  characterName: string;
  position: number | null;
  points: number;
  grid: number | null;
  raceName: string;
}

export interface ContextStandingBrief {
  driverProfileId: string;
  characterName: string;
  position: number | null;
  points: number;
  wins: number;
  podiums: number;
}

export interface ContextMotorsportBlock {
  drivers: ContextDriverBrief[];
  teams: Array<{ id: string; name: string }>;
  season: { id: string; year: number; name: string | null } | null;
  races: ContextRaceBrief[];
  results: ContextResultBrief[];
  standings: ContextStandingBrief[];
}

export interface ContextTemporalBlock {
  worldDate: string | null;
  currentSeasonId: string | null;
  currentRaceId: string | null;
  currentSession: RaceSession | null;
  phaseMarker: string | null;
}

export interface ContextOmitted {
  oldestMessagesTruncated: number;
  memoriesOmitted: number;
  reasons: string[];
}

export interface AssembledContext {
  meta: {
    version: "context.v1";
    conversationId: string;
    conversationType: ConversationType;
    participantCharacterIds: string[];
    assembledAt: string;
    ruleApplied: string;
  };
  participants: ContextParticipant[];
  activeSpeaker: { characterId: string | null; senderType: MessageSenderType };
  temporal: ContextTemporalBlock;
  recentMessages: ContextMessageView[];
  memories: ContextMemoryView[];
  events: ContextEventView[];
  relationships: ContextRelationshipView[];
  motorsport: ContextMotorsportBlock | null;
  news: ContextNewsView[];
  omitted: ContextOmitted;
  /**
   * Contrato NEUTRO de contexto externo (Fase 13 STEP 10/11).
   *
   * Quando o caller fornece um `ExternalRagContext` previamente montado (via
   * retrieval determinístico → adapter), ele é anexado aqui VERBATIM/neutro,
   * preservando `ruleApplied`, provenance e ordem já decididas no retrieval.
   *
   * Quando NÃO há RAG disponível, a chave é OMITIDA do objeto de saída (não
   * vira `null`), de modo que o agregado continua byte-a-byte igual ao
   * contrato anterior (endpoint de contexto intacto).
   */
  externalRag?: ExternalRagContext;
}

// ---------------------------------------------------------------------------
// Utilitários determinísticos.
// ---------------------------------------------------------------------------

// Ordem decrescente de importância para ranking.
const IMPORTANCE_RANK: Record<MemoryImportance, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};
const EVENT_RANK: Record<EventImportance, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

// Comparador total e determinístico: desempate final SEMPRE por id.id.
function byId<A extends { id: string }>(a: A, b: A): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Desempate final por characterId (objetos sem campo `id`, ex.: participantes).
function byCharacterId<A extends { characterId: string }>(a: A, b: A): number {
  return a.characterId < b.characterId ? -1 : a.characterId > b.characterId ? 1 : 0;
}

function importanceDesc(a: MemoryImportance, b: MemoryImportance): number {
  return IMPORTANCE_RANK[b] - IMPORTANCE_RANK[a];
}

function eventImportanceDesc(a: EventImportance, b: EventImportance): number {
  return EVENT_RANK[b] - EVENT_RANK[a];
}

// Proximidade temporal a uma data de referência (abs(ms)); null tratado como
// distância máxima para não polar +. Determinístico.
function temporalDistance(timestamp: string | Date | null, ref: Date | null): number {
  if (timestamp == null) return Number.MAX_SAFE_INTEGER;
  return Math.abs(new Date(timestamp).getTime() - (ref?.getTime() ?? 0));
}

// ---------------------------------------------------------------------------
// Seletor principal.
// ---------------------------------------------------------------------------

export interface AssemblyInput {
  conversationId: string;
  userId: string;
  now?: Date;
  /**
   * Contexto externo (RAG) JÁ materializado no contrato neutro
   * `ExternalRagContext` pelo pipeline: retrieval determinístico (STEP 9) →
   * adapter (STEP 10). Opcional. Quando presente, é anexado verbatim ao
   * `AssembledContext.externalRag`; quando ausente/nulo, a chave é omitida.
   *
   * O assembly NÃO executa retrieval, NÃO chama provider/Cohere e NÃO revalida
   * ownership here — o escopo/isolação já foi aplicado na camada de retrieval.
   * Este módulo apenas TRANSPORTA o contrato neutro de forma pura/determinística.
   */
  externalRag?: ExternalRagContext | null;
}

/**
 * Anexa de forma PURA e DETERMINÍSTICA um `ExternalRagContext` opcional ao
 * `AssembledContext` montado.
 *
 * Regras:
 *   - `externalRag` ausente/nulo → a chave é REMOVIDA (objeto novo, sem mutação
 *     da entrada) e a saída fica byte-a-byte igual ao contrato pré-RAG.
 *   - `externalRag` presente → copiado verbatim (shallow clone, sem mutation do
 *     input), preservando `ruleApplied`, provider/model/version/dimensions,
 *     provenance e a ORDEM dos itens já decidida pelo retrieval.
 *   - Nenhum side effect, nenhum filtro/re-rank aqui; isolação já veio do
 *     retrieval (STEP 9).
 */
export function withExternalRag<C extends AssembledContext>(
  assembled: C,
  externalRag?: ExternalRagContext | null,
): C {
  if (externalRag == null) {
    const out = { ...(assembled as object) } as C;
    delete (out as { externalRag?: ExternalRagContext }).externalRag;
    return out;
  }
  return { ...(assembled as object), externalRag } as C;
}

/**
 * Monta o `AssembledContext` de uma Conversation de forma determinística.
 * Assume que a autorização (ownership via Character participante) já foi
 * verificada pela camada de rota. Este serviço é READ-ONLY: não grava nada.
 */
export async function assembleContext(
  db: Pick<PrismaClient, "conversation" | "conversationParticipant" | "message" | "memory" | "memoryCharacter" | "eventCharacter" | "event" | "relationship" | "worldState" | "character" | "driverProfile" | "team" | "season" | "race" | "raceResult" | "championshipStanding" | "newsItem">,
  input: AssemblyInput,
): Promise<AssembledContext> {
  const assembledAt = (input.now ?? new Date()).toISOString();
  const reasons: string[] = [];

  // 1) Conversation + participantes (escopo autorizado).
  const conversation = await db.conversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, title: true, type: true },
  });
  if (!conversation) {
    throw new ContextAccessError("Conversation não encontrada", "NOT_FOUND");
  }

  const participantLinks = await db.conversationParticipant.findMany({
    where: { conversationId: input.conversationId },
    select: { characterId: true },
    orderBy: { characterId: "asc" },
  });
  const scope = participantLinks.map((p) => p.characterId);

  // 2) Characters participantes (identidade mínima + controlador USER/AI).
  const characters = scope.length
    ? await db.character.findMany({
        where: { id: { in: scope } },
        select: { id: true, name: true, nationality: true, controlledBy: true },
      })
    : [];
  const participants = characters
    .map((c) => ({
      characterId: c.id,
      name: c.name,
      nationality: c.nationality,
      controlledBy: c.controlledBy,
      isAIParticipant: c.controlledBy === "AI",
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : byCharacterId(a, b)));

  // 3) WorldState — LEITURA. Referências quebradas são ignoradas (null).
  const world = await db.worldState.findUnique({ where: { key: WORLD_KEY } });
  let currentSeasonId = world?.currentSeasonId ?? null;
  let currentRaceId = world?.currentRaceId ?? null;
  if (currentSeasonId) {
    const season = await db.season.findUnique({
      where: { id: currentSeasonId },
      select: { id: true },
    });
    if (!season) {
      reasons.push("currentSeasonId aponta para Season inexistente; ignorado");
      currentSeasonId = null;
    }
  }
  if (currentRaceId) {
    const race = await db.race.findUnique({
      where: { id: currentRaceId },
      select: { id: true },
    });
    if (!race) {
      reasons.push("currentRaceId aponta para Race inexistente; ignorado");
      currentRaceId = null;
    }
  }
  const worldDate = world?.currentDate != null ? world.currentDate : null;
  const phaseMarker = world?.currentSession
    ? `SESSION:${world.currentSession}`
    : currentRaceId
      ? "ACTIVE_RACE"
      : currentSeasonId
        ? "SEASON"
        : null;

  // 4) Janela de mensagens (createdAt ASC, janela móvel pela cauda).
  const allMessages = await db.message.findMany({
    where: { conversationId: input.conversationId },
    select: { id: true, senderType: true, characterId: true, content: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const oldestMessagesTruncated = Math.max(0, allMessages.length - MESSAGE_WINDOW);
  if (oldestMessagesTruncated > 0) {
    reasons.push(`janela de mensagens truncada (${oldestMessagesTruncated} antigas omitidas)`);
  }
  const recentMessages = (
    oldestMessagesTruncated > 0
      ? allMessages.slice(allMessages.length - MESSAGE_WINDOW)
      : allMessages
  ).map((m) => ({
    id: m.id,
    senderType: m.senderType,
    characterId: m.characterId,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  }));

  // 5) Memórias relevantes ao escopo, ranqueadas (importância → match → tempo → id).
  const memoryLinks = scope.length
    ? await db.memoryCharacter.findMany({
        where: { characterId: { in: scope } },
        select: { memoryId: true, characterId: true },
      })
    : [];
  const memoryIds = [...new Set(memoryLinks.map((l) => l.memoryId))];
  const memories = memoryIds.length
    ? await db.memory.findMany({
        where: { id: { in: memoryIds } },
        select: {
          id: true,
          content: true,
          summary: true,
          importance: true,
          source: true,
          emotionalImpact: true,
          eventId: true,
          createdAt: true,
        },
      })
    : [];

  const memoryViews = memories
    .map((m) => {
      const participantIds = memoryLinks
        .filter((l) => l.memoryId === m.id)
        .map((l) => l.characterId)
        .sort();
      const matchScore = participantIds.reduce(
        (acc, cid) => acc + (scope.includes(cid) ? 1 : 0),
        0,
      );
      return {
        id: m.id,
        content: m.content,
        summary: m.summary,
        importance: m.importance,
        source: m.source,
        emotionalImpact: m.emotionalImpact,
        eventId: m.eventId,
        createdAt: m.createdAt.toISOString(),
        participantCharacterIds: participantIds,
        // chaves de ranking (não expostas)
        matchScore,
      };
    })
    .sort((a, b) => {
      let c = importanceDesc(a.importance, b.importance);
      if (c !== 0) return c;
      c = b.matchScore - a.matchScore;
      if (c !== 0) return c;
      c = temporalDistance(a.createdAt, worldDate) - temporalDistance(b.createdAt, worldDate);
      if (c !== 0) return c;
      return byId(a, b);
    });
  const memoriesOmitted = Math.max(0, memoryViews.length - MEMORY_LIMIT);
  if (memoriesOmitted > 0) {
    reasons.push(`memórias limitadas a ${MEMORY_LIMIT} (${memoriesOmitted} omitidas)`);
  }
  const selectedMemories = memoryViews
    .slice(0, MEMORY_LIMIT)
    .map((m) => ({
      id: m.id,
      content: m.content,
      summary: m.summary,
      importance: m.importance,
      source: m.source,
      emotionalImpact: m.emotionalImpact,
      eventId: m.eventId,
      createdAt: m.createdAt,
      participantCharacterIds: m.participantCharacterIds,
    }));

  // 6) Eventos relevantes ao escopo via EventCharacter.
  const eventLinks = scope.length
    ? await db.eventCharacter.findMany({
        where: { characterId: { in: scope } },
        select: { eventId: true, characterId: true },
      })
    : [];
  const eventIds = [...new Set(eventLinks.map((l) => l.eventId))];
  const events = eventIds.length
    ? await db.event.findMany({
        where: { id: { in: eventIds } },
        select: { id: true, type: true, importance: true, title: true, description: true, worldDate: true },
      })
    : [];
  const selectedEvents = events
    .map((e) => ({
      event: e,
      participantIds: eventLinks
        .filter((l) => l.eventId === e.id)
        .map((l) => l.characterId)
        .sort(),
    }))
    .sort((a, b) => {
      let c = eventImportanceDesc(a.event.importance, b.event.importance);
      if (c !== 0) return c;
      c =
        temporalDistance(a.event.worldDate, worldDate) -
        temporalDistance(b.event.worldDate, worldDate);
      if (c !== 0) return c;
      return byId(a.event, b.event);
    })
    .slice(0, EVENT_LIMIT)
    .map(({ event, participantIds }) => ({
      id: event.id,
      type: event.type,
      importance: event.importance,
      title: event.title,
      description: event.description,
      worldDate: event.worldDate ? event.worldDate.toISOString() : null,
      participantCharacterIds: participantIds,
    }));

  // 7) Relações com ambos os endpoints no escopo.
  const allRelationships = scope.length
    ? await db.relationship.findMany({
        where: {
          OR: [
            { characterAId: { in: scope }, characterBId: { in: scope } },
            { characterAId: { in: scope }, characterBId: { in: scope } },
          ],
        },
        include: {
          characterA: { select: { name: true } },
          characterB: { select: { name: true } },
        },
      })
    : [];
  const relationshipMap = new Map(characters.map((c) => [c.id, c.name]));
  const selectedRelationships = allRelationships
    .filter(
      (r) => scope.includes(r.characterAId) && scope.includes(r.characterBId),
    )
    .map((r) => ({
      id: r.id,
      characterAId: r.characterAId,
      characterBId: r.characterBId,
      characterAName: r.characterA?.name ?? relationshipMap.get(r.characterAId) ?? "",
      characterBName: r.characterB?.name ?? relationshipMap.get(r.characterBId) ?? "",
      dimensions: r.dimensions,
    }))
    .sort((a, b) => {
      const relA = allRelationships.find((r) => r.id === a.id)!;
      const relB = allRelationships.find((r) => r.id === b.id)!;
      const c = relB.updatedAt.getTime() - relA.updatedAt.getTime();
      if (c !== 0) return c;
      return byId(a, b);
    })
    .slice(0, RELATIONSHIP_LIMIT);

  // 8) Motorsport (CONDICIONAL: só se algum participante tiver DriverProfile).
  let motorsport: ContextMotorsportBlock | null = null;
  const driverProfiles = scope.length
    ? await db.driverProfile.findMany({
        where: { characterId: { in: scope } },
        include: { character: { select: { id: true, name: true } }, team: { select: { id: true, name: true } } },
      })
    : [];
  if (driverProfiles.length > 0) {
    const teamMap = new Map<string, { id: string; name: string }>();
    driverProfiles.forEach((dp) => {
      if (dp.team) teamMap.set(dp.team.id, dp.team);
    });
    const season = currentSeasonId
      ? await db.season.findUnique({
          where: { id: currentSeasonId },
          select: { id: true, year: true, name: true },
        })
      : null;
    const races = currentSeasonId
      ? await db.race.findMany({
          where: { seasonId: currentSeasonId },
          select: { id: true, name: true, circuit: true, date: true, round: true, status: true },
          orderBy: [{ round: "asc" }, { id: "asc" }],
          take: RACE_LIMIT,
        })
      : [];
    const raceMap = new Map(races.map((r) => [r.id, r.name]));
    const driverProfileIds = driverProfiles.map((dp) => dp.id);
    const results = driverProfileIds.length
      ? await db.raceResult.findMany({
          where: {
            driverProfileId: { in: driverProfileIds },
            ...(currentSeasonId ? { race: { seasonId: currentSeasonId } } : {}),
          },
          select: { driverProfileId: true, position: true, points: true, grid: true, raceId: true },
          orderBy: [{ race: { round: "asc" } }, { driverProfileId: "asc" }, { raceId: "asc" }],
          take: RESULT_LIMIT,
        })
      : [];
    const standings = currentSeasonId && driverProfileIds.length
      ? await db.championshipStanding.findMany({
          where: { driverProfileId: { in: driverProfileIds }, seasonId: currentSeasonId },
          select: { driverProfileId: true, position: true, points: true, wins: true, podiums: true },
          orderBy: [{ position: "asc" }, { driverProfileId: "asc" }],
          take: STANDING_LIMIT,
        })
      : [];
    const characterNameOf = (driverProfileId: string) =>
      driverProfiles.find((dp) => dp.id === driverProfileId)?.character?.name ?? "";

    motorsport = {
      drivers: driverProfiles
        .map((dp) => ({
          characterId: dp.characterId,
          name: dp.character?.name ?? "",
          number: dp.number ?? null,
          teamName: dp.team?.name ?? null,
        }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : byCharacterId(a, b))),
      teams: [...teamMap.values()]
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : byId(a, b))),
      season: season
        ? { id: season.id, year: season.year, name: season.name }
        : null,
      races: races.map((r) => ({
        id: r.id,
        name: r.name,
        circuit: r.circuit,
        date: r.date ? r.date.toISOString() : null,
        round: r.round,
        status: r.status,
      })),
      results: results.map((r) => ({
        driverProfileId: r.driverProfileId,
        characterName: characterNameOf(r.driverProfileId),
        position: r.position,
        points: r.points,
        grid: r.grid,
        raceName: raceMap.get(r.raceId) ?? "",
      })),
      standings: standings.map((s) => ({
        driverProfileId: s.driverProfileId,
        characterName: characterNameOf(s.driverProfileId),
        position: s.position,
        points: s.points,
        wins: s.wins,
        podiums: s.podiums,
      })),
    };
  }

  // 9) News internas — apenas evento do escopo.
  const news = selectedEvents.length
    ? await db.newsItem.findMany({
        where: { eventId: { in: selectedEvents.map((e) => e.id) } },
        select: { id: true, eventId: true, title: true, body: true, worldDate: true },
      })
    : [];
  const selectedNews = news
    .map((n) => ({
      id: n.id,
      eventId: n.eventId,
      title: n.title,
      body: n.body,
      worldDate: n.worldDate ? n.worldDate.toISOString() : null,
      distance: temporalDistance(n.worldDate, worldDate),
    }))
    .sort((a, b) => a.distance - b.distance || byId(a, b))
    .slice(0, NEWS_LIMIT)
    .map((n) => ({
      id: n.id,
      eventId: n.eventId,
      title: n.title,
      body: n.body,
      worldDate: n.worldDate,
    }));

  // 10) Compõe o contrato.
  const userOwnedScope = participants
    .filter((p) => !p.isAIParticipant)
    .map((p) => p.characterId)
    .sort();

  return withExternalRag(
    {
      meta: {
      version: "context.v1",
      conversationId: input.conversationId,
      conversationType: conversation.type,
      participantCharacterIds: [...scope].sort(),
      assembledAt,
      ruleApplied: "context.v1-policy:msgs=50#mem=15#evt=10#rel=10#news=8",
    },
    participants,
    activeSpeaker: {
      characterId: userOwnedScope.length > 0 ? userOwnedScope[0] : null,
      senderType: "USER_CHARACTER",
    },
    temporal: {
      worldDate: worldDate ? worldDate.toISOString() : null,
      currentSeasonId,
      currentRaceId,
      currentSession: world?.currentSession ?? null,
      phaseMarker,
    },
    recentMessages,
    memories: selectedMemories,
    events: selectedEvents,
    relationships: selectedRelationships,
    motorsport,
    news: selectedNews,
    omitted: {
      oldestMessagesTruncated,
      memoriesOmitted,
      reasons,
    },
    },
    input.externalRag,
  );
}

export class ContextAccessError extends Error {
  statusCode: number;
  code: string;
  constructor(message: string, code: string, statusCode = 404) {
    super(message);
    this.name = "ContextAccessError";
    this.code = code;
    this.statusCode = statusCode;
  }
}