import { prisma } from "../../infrastructure/database/prisma.js";
import {
  buildOpportunitySignals,
  type OpportunityEvidence,
} from "../conversation/conversation.opportunity-bridge.js";
import {
  buildConversationOpportunity,
  type ConversationOpportunity,
  type ConversationOpportunityReason,
  type ConversationOpportunitySignal,
} from "../conversation/conversation.opportunity.js";

/**
 * F6.2 — seleção de oportunidades de conversa dentro do tick autônomo.
 *
 * Este módulo apenas DERIVA sinais de fontes existentes (Event,
 * RelationshipChange, Memory, CharacterGoal e inatividade da conversa) e
 * SELECIONA oportunidades de forma determinística. Não executa conversa,
 * não chama LLM e não escreve no banco — a auditoria acontece via
 * `AiDecision.metadata` no fluxo existente do tick.
 */

export type OpportunityCandidate = {
  readonly opportunity: ConversationOpportunity;
  readonly evidenceId: string;
  readonly fairnessRank: number;
};

export type OpportunityRejectionCode =
  | "UNIVERSE_MISMATCH"
  | "DUPLICATE_FINGERPRINT"
  | "DUPLICATE_EVIDENCE"
  | "CHARACTER_COOLDOWN"
  | "CONVERSATION_COOLDOWN"
  | "CHARACTER_ALREADY_SELECTED"
  | "CONVERSATION_ALREADY_SELECTED"
  | "BUDGET_EXHAUSTED";

export type SelectedConversationOpportunity = {
  readonly opportunity: ConversationOpportunity;
  readonly evidenceId: string;
  readonly rank: number;
};

export type RejectedConversationOpportunity = {
  readonly conversationId: string;
  readonly characterId: string;
  readonly fingerprint: string;
  readonly evidenceId: string;
  readonly reasonCode: OpportunityRejectionCode;
};

export type ConversationOpportunitySelection = {
  readonly selected: readonly SelectedConversationOpportunity[];
  readonly rejected: readonly RejectedConversationOpportunity[];
  readonly candidateCount: number;
  readonly budgetExhausted: boolean;
};

export type ConversationOpportunityCooldown = {
  readonly characterIds: ReadonlySet<string>;
  readonly conversationIds: ReadonlySet<string>;
  readonly fingerprints: ReadonlySet<string>;
  readonly evidenceIds: ReadonlySet<string>;
};

export const EMPTY_OPPORTUNITY_COOLDOWN: ConversationOpportunityCooldown = {
  characterIds: new Set<string>(),
  conversationIds: new Set<string>(),
  fingerprints: new Set<string>(),
  evidenceIds: new Set<string>(),
};

export type ConversationOpportunityAudit = {
  readonly fingerprint: string;
  readonly evidenceId: string;
  readonly conversationId: string;
  readonly characterId: string;
  readonly targetCharacterId: string | null;
  readonly reason: ConversationOpportunityReason;
  readonly priority: number;
  readonly windowStart: string;
  readonly rank: number;
};

export type ConversationOpportunitySelectionAudit = {
  readonly candidateCount: number;
  readonly selectedCount: number;
  readonly budget: number;
  readonly budgetExhausted: boolean;
};

export function toConversationOpportunityAudit(
  selected: SelectedConversationOpportunity,
): ConversationOpportunityAudit {
  return {
    fingerprint: selected.opportunity.fingerprint,
    evidenceId: selected.evidenceId,
    conversationId: selected.opportunity.conversationId,
    characterId: selected.opportunity.characterId,
    targetCharacterId: selected.opportunity.targetCharacterId,
    reason: selected.opportunity.reason,
    priority: selected.opportunity.priority,
    windowStart: selected.opportunity.windowStart,
    rank: selected.rank,
  };
}

export function toConversationOpportunitySelectionAudit(
  selection: ConversationOpportunitySelection,
  budget: number,
): ConversationOpportunitySelectionAudit {
  return {
    candidateCount: selection.candidateCount,
    selectedCount: selection.selected.length,
    budget,
    budgetExhausted: selection.budgetExhausted,
  };
}

const REASON_ORDER: Record<ConversationOpportunityReason, number> = {
  WORLD_EVENT: 0,
  RELATIONSHIP_CHANGE: 1,
  MEMORY_TRIGGER: 2,
  GOAL_PRESSURE: 3,
  INACTIVITY: 4,
};

const OPPORTUNITY_SOURCE_LIMIT = 100;
const COOLDOWN_LOOKBACK = 200;

export function selectConversationOpportunities(input: {
  readonly universeId: string;
  readonly maxConversations: number;
  readonly candidates: readonly OpportunityCandidate[];
  readonly cooldown?: ConversationOpportunityCooldown;
}): ConversationOpportunitySelection {
  const cooldown = input.cooldown ?? EMPTY_OPPORTUNITY_COOLDOWN;
  const selected: SelectedConversationOpportunity[] = [];
  const rejected: RejectedConversationOpportunity[] = [];
  const seenFingerprints = new Set<string>();
  const seenEvidenceIds = new Set<string>();
  const selectedCharacterIds = new Set<string>();
  const selectedConversationIds = new Set<string>();
  let budgetExhausted = false;

  const ordered = [...input.candidates].sort((a, b) => {
    const left = a.opportunity;
    const right = b.opportunity;
    if (right.priority !== left.priority) return right.priority - left.priority;
    if (a.fairnessRank !== b.fairnessRank) return a.fairnessRank - b.fairnessRank;
    const reasonDelta = REASON_ORDER[left.reason] - REASON_ORDER[right.reason];
    if (reasonDelta !== 0) return reasonDelta;
    const conversationDelta = left.conversationId.localeCompare(right.conversationId);
    if (conversationDelta !== 0) return conversationDelta;
    return left.fingerprint.localeCompare(right.fingerprint);
  });

  for (const candidate of ordered) {
    const opportunity = candidate.opportunity;
    const reject = (reasonCode: OpportunityRejectionCode) => {
      rejected.push({
        conversationId: opportunity.conversationId,
        characterId: opportunity.characterId,
        fingerprint: opportunity.fingerprint,
        evidenceId: candidate.evidenceId,
        reasonCode,
      });
    };

    if (opportunity.universeId !== input.universeId) {
      reject("UNIVERSE_MISMATCH");
      continue;
    }
    if (
      cooldown.fingerprints.has(opportunity.fingerprint) ||
      seenFingerprints.has(opportunity.fingerprint)
    ) {
      reject("DUPLICATE_FINGERPRINT");
      continue;
    }
    if (
      cooldown.evidenceIds.has(candidate.evidenceId) ||
      seenEvidenceIds.has(candidate.evidenceId)
    ) {
      reject("DUPLICATE_EVIDENCE");
      continue;
    }
    if (cooldown.characterIds.has(opportunity.characterId)) {
      reject("CHARACTER_COOLDOWN");
      continue;
    }
    if (cooldown.conversationIds.has(opportunity.conversationId)) {
      reject("CONVERSATION_COOLDOWN");
      continue;
    }
    if (selectedCharacterIds.has(opportunity.characterId)) {
      reject("CHARACTER_ALREADY_SELECTED");
      continue;
    }
    if (selectedConversationIds.has(opportunity.conversationId)) {
      reject("CONVERSATION_ALREADY_SELECTED");
      continue;
    }
    if (selected.length >= input.maxConversations) {
      budgetExhausted = true;
      reject("BUDGET_EXHAUSTED");
      continue;
    }

    selected.push({ opportunity, evidenceId: candidate.evidenceId, rank: selected.length + 1 });
    seenFingerprints.add(opportunity.fingerprint);
    seenEvidenceIds.add(candidate.evidenceId);
    selectedCharacterIds.add(opportunity.characterId);
    selectedConversationIds.add(opportunity.conversationId);
  }

  return {
    selected,
    rejected,
    candidateCount: input.candidates.length,
    budgetExhausted,
  };
}

export type AutonomyOpportunitySourceCounts = Record<ConversationOpportunityReason, number>;

export type AutonomyOpportunityPlan = {
  readonly candidates: readonly OpportunityCandidate[];
  readonly selection: ConversationOpportunitySelection;
  readonly sourceCounts: AutonomyOpportunitySourceCounts;
  readonly conversationCount: number;
};

function emptySourceCounts(): AutonomyOpportunitySourceCounts {
  return {
    WORLD_EVENT: 0,
    RELATIONSHIP_CHANGE: 0,
    MEMORY_TRIGGER: 0,
    GOAL_PRESSURE: 0,
    INACTIVITY: 0,
  };
}

export function readConversationOpportunityAudit(
  metadata: unknown,
): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const requestMetadata = (metadata as Record<string, unknown>).requestMetadata;
  if (!requestMetadata || typeof requestMetadata !== "object" || Array.isArray(requestMetadata)) {
    return null;
  }
  const audit = (requestMetadata as Record<string, unknown>).conversationOpportunity;
  if (!audit || typeof audit !== "object" || Array.isArray(audit)) return null;
  return audit as Record<string, unknown>;
}

export function readConversationOpportunitySelectionAudit(
  metadata: unknown,
): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const requestMetadata = (metadata as Record<string, unknown>).requestMetadata;
  if (!requestMetadata || typeof requestMetadata !== "object" || Array.isArray(requestMetadata)) {
    return null;
  }
  const audit = (requestMetadata as Record<string, unknown>).opportunitySelection;
  if (!audit || typeof audit !== "object" || Array.isArray(audit)) return null;
  return audit as Record<string, unknown>;
}

export async function loadConversationOpportunityCooldown(input: {
  readonly universeId: string;
  readonly fromDate: Date;
  readonly cooldownHours: number;
}): Promise<ConversationOpportunityCooldown> {
  const since = new Date(input.fromDate.getTime() - input.cooldownHours * 60 * 60 * 1000);
  const decisions = await prisma.aiDecision.findMany({
    where: { universeId: input.universeId },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: COOLDOWN_LOOKBACK,
    select: { metadata: true },
  });
  const characterIds = new Set<string>();
  const conversationIds = new Set<string>();
  const fingerprints = new Set<string>();
  const evidenceIds = new Set<string>();
  for (const decision of decisions) {
    const audit = readConversationOpportunityAudit(decision.metadata);
    if (!audit) continue;
    const fingerprint = typeof audit.fingerprint === "string" ? audit.fingerprint : null;
    if (fingerprint) fingerprints.add(fingerprint);
    const windowStart = typeof audit.windowStart === "string" ? new Date(audit.windowStart) : null;
    if (!windowStart || Number.isNaN(windowStart.getTime())) continue;
    if (windowStart.getTime() < since.getTime()) continue;
    if (typeof audit.characterId === "string") characterIds.add(audit.characterId);
    if (typeof audit.conversationId === "string") conversationIds.add(audit.conversationId);
    if (typeof audit.evidenceId === "string") evidenceIds.add(audit.evidenceId);
  }
  return { characterIds, conversationIds, fingerprints, evidenceIds };
}

type EligibleConversation = {
  readonly id: string;
  readonly createdAt: Date;
  readonly participantIds: readonly string[];
  readonly aiCharacterIds: readonly string[];
};

export async function buildAutonomyOpportunityPlan(input: {
  readonly universeId: string;
  readonly fromDate: Date;
  readonly toDate: Date;
  readonly characterIds: readonly string[];
  readonly maxConversations: number;
  readonly cooldownHours: number;
}): Promise<AutonomyOpportunityPlan> {
  const empty: AutonomyOpportunityPlan = {
    candidates: [],
    selection: {
      selected: [],
      rejected: [],
      candidateCount: 0,
      budgetExhausted: false,
    },
    sourceCounts: emptySourceCounts(),
    conversationCount: 0,
  };
  const characterIdSet = new Set(input.characterIds);
  if (characterIdSet.size === 0) return empty;
  const characterIdList = [...input.characterIds];

  const conversations = await prisma.conversation.findMany({
    where: {
      status: "ACTIVE",
      participants: { some: { characterId: { in: characterIdList } } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      createdAt: true,
      participants: {
        select: {
          characterId: true,
          character: { select: { universeId: true } },
        },
      },
    },
  });

  const eligible: EligibleConversation[] = [];
  for (const conversation of conversations) {
    if (conversation.participants.length < 2) continue;
    if (
      !conversation.participants.every(
        (participant) => participant.character.universeId === input.universeId,
      )
    ) {
      continue;
    }
    const participantIds = conversation.participants
      .map((participant) => participant.characterId)
      .sort((a, b) => a.localeCompare(b));
    const aiCharacterIds = participantIds.filter((id) => characterIdSet.has(id));
    if (aiCharacterIds.length === 0) continue;
    eligible.push({
      id: conversation.id,
      createdAt: conversation.createdAt,
      participantIds,
      aiCharacterIds,
    });
  }
  if (eligible.length === 0) return empty;

  const fairnessRank = new Map(input.characterIds.map((id, index) => [id, index]));
  const candidates: OpportunityCandidate[] = [];
  const sourceCounts = emptySourceCounts();

  const pushSignal = (
    conversation: EligibleConversation,
    signal: ConversationOpportunitySignal,
  ): void => {
    const opportunity = buildConversationOpportunity({
      universeId: input.universeId,
      conversationId: conversation.id,
      participantIds: conversation.participantIds,
      windowStart: input.fromDate,
      signal,
    });
    if (!opportunity) return;
    candidates.push({
      opportunity,
      evidenceId: signal.evidenceId,
      fairnessRank: fairnessRank.get(signal.characterId) ?? Number.MAX_SAFE_INTEGER,
    });
    sourceCounts[signal.reason] += 1;
  };

  const pushEvidence = (conversation: EligibleConversation, evidence: OpportunityEvidence): void => {
    const signals = buildOpportunitySignals({
      universeId: input.universeId,
      conversationId: conversation.id,
      participantIds: conversation.participantIds,
      characterIds: conversation.aiCharacterIds,
      evidence,
    });
    for (const signal of signals) pushSignal(conversation, signal);
  };

  const [events, relationshipChanges, memories, goals] = await Promise.all([
    prisma.event.findMany({
      where: {
        worldDate: { gte: input.fromDate, lte: input.toDate },
        participants: { some: { characterId: { in: characterIdList } } },
      },
      orderBy: [{ worldDate: "asc" }, { id: "asc" }],
      take: OPPORTUNITY_SOURCE_LIMIT,
      select: {
        id: true,
        importance: true,
        participants: { select: { characterId: true }, orderBy: { characterId: "asc" } },
      },
    }),
    prisma.relationshipChange.findMany({
      where: {
        createdAt: { gte: input.fromDate, lte: input.toDate },
        OR: [
          { characterAId: { in: characterIdList } },
          { characterBId: { in: characterIdList } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: OPPORTUNITY_SOURCE_LIMIT,
      select: {
        id: true,
        characterAId: true,
        characterBId: true,
        delta: true,
        sourceType: true,
        sourceId: true,
      },
    }),
    prisma.memory.findMany({
      where: {
        universeId: input.universeId,
        status: "ACTIVE",
        createdAt: { gte: input.fromDate, lte: input.toDate },
        participants: { some: { characterId: { in: characterIdList } } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: OPPORTUNITY_SOURCE_LIMIT,
      select: {
        id: true,
        eventId: true,
        importance: true,
        participants: { select: { characterId: true }, orderBy: { characterId: "asc" } },
      },
    }),
    prisma.characterGoal.findMany({
      where: {
        universeId: input.universeId,
        characterId: { in: characterIdList },
        status: "ACTIVE",
      },
      orderBy: [{ priority: "desc" }, { id: "asc" }],
      select: {
        id: true,
        characterId: true,
        priority: true,
        targetCharacterId: true,
      },
    }),
  ]);

  for (const event of events) {
    const evidence: OpportunityEvidence = {
      kind: "EVENT",
      id: event.id,
      importance: event.importance,
      participantIds: event.participants.map((participant) => participant.characterId),
    };
    for (const conversation of eligible) pushEvidence(conversation, evidence);
  }

  for (const change of relationshipChanges) {
    const evidence: OpportunityEvidence = {
      kind: "RELATIONSHIP_CHANGE",
      id: change.id,
      sourceType: change.sourceType,
      sourceId: change.sourceId,
      characterAId: change.characterAId,
      characterBId: change.characterBId,
      delta: change.delta,
    };
    for (const conversation of eligible) pushEvidence(conversation, evidence);
  }

  for (const memory of memories) {
    const evidence: OpportunityEvidence = {
      kind: "MEMORY",
      id: memory.id,
      eventId: memory.eventId,
      importance: memory.importance,
      participantIds: memory.participants.map((participant) => participant.characterId),
    };
    for (const conversation of eligible) pushEvidence(conversation, evidence);
  }

  for (const goal of goals) {
    const evidence: OpportunityEvidence = {
      kind: "GOAL",
      id: goal.id,
      characterId: goal.characterId,
      priority: goal.priority,
      targetCharacterId: goal.targetCharacterId,
    };
    for (const conversation of eligible) pushEvidence(conversation, evidence);
  }

  const windowMs = input.toDate.getTime() - input.fromDate.getTime();
  for (const conversation of eligible) {
    const lastMessage = await prisma.message.findFirst({
      where: { conversationId: conversation.id },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: { id: true, createdAt: true },
    });
    const lastActivityAt = lastMessage?.createdAt ?? conversation.createdAt;
    const evidence: OpportunityEvidence = {
      kind: "INACTIVITY",
      conversationId: conversation.id,
      lastMessageId: lastMessage?.id ?? null,
      idleMs: input.toDate.getTime() - lastActivityAt.getTime(),
      windowMs,
    };
    pushEvidence(conversation, evidence);
  }

  const cooldown = await loadConversationOpportunityCooldown({
    universeId: input.universeId,
    fromDate: input.fromDate,
    cooldownHours: input.cooldownHours,
  });
  const selection = selectConversationOpportunities({
    universeId: input.universeId,
    maxConversations: input.maxConversations,
    candidates,
    cooldown,
  });

  return {
    candidates,
    selection,
    sourceCounts,
    conversationCount: eligible.length,
  };
}
