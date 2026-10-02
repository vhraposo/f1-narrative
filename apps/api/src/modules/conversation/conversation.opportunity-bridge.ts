import type { EventImportance, MemoryImportance } from "@prisma/client";

import type {
  ConversationOpportunityReason,
  ConversationOpportunitySignal,
} from "./conversation.opportunity.js";

/**
 * F6.4 — ponte determinística evento/derivação → ConversationOpportunitySignal.
 *
 * A ponte NÃO persiste nada, NÃO executa conversa e NÃO chama LLM: apenas
 * converte uma evidência de domínio já existente (Event, Memory,
 * RelationshipChange, CharacterGoal ou inatividade) em sinais que alimentam
 * `buildConversationOpportunity` e, por consequência, o plano do tick (F6.2).
 *
 * EvidenceId canônico: quando uma linha é derivada de um Event, a evidência
 * usa a raiz `event:<eventId>` (mesmo evento = mesma evidência em replay),
 * evitando duplicação entre evento + memória + relationship change derivados.
 */

export type OpportunityEvidence =
  | {
      readonly kind: "EVENT";
      readonly id: string;
      readonly importance: EventImportance;
      readonly participantIds: readonly string[];
    }
  | {
      readonly kind: "MEMORY";
      readonly id: string;
      readonly eventId: string | null;
      readonly importance: MemoryImportance;
      readonly participantIds: readonly string[];
    }
  | {
      readonly kind: "RELATIONSHIP_CHANGE";
      readonly id: string;
      readonly sourceType: string;
      readonly sourceId: string | null;
      readonly characterAId: string;
      readonly characterBId: string;
      readonly delta: number;
    }
  | {
      readonly kind: "GOAL";
      readonly id: string;
      readonly characterId: string;
      readonly priority: number;
      readonly targetCharacterId: string | null;
    }
  | {
      readonly kind: "INACTIVITY";
      readonly conversationId: string;
      readonly lastMessageId: string | null;
      readonly idleMs: number;
      readonly windowMs: number;
    };

const EVENT_IMPORTANCE_STRENGTH: Record<EventImportance, number> = {
  LOW: 0.25,
  MEDIUM: 0.5,
  HIGH: 0.75,
  CRITICAL: 1,
};

const MEMORY_IMPORTANCE_STRENGTH: Record<MemoryImportance, number> = {
  LOW: 0.25,
  MEDIUM: 0.5,
  HIGH: 0.75,
  CRITICAL: 1,
};

export function canonicalEvidenceId(evidence: OpportunityEvidence): string {
  switch (evidence.kind) {
    case "EVENT":
      return `event:${evidence.id}`;
    case "MEMORY":
      return evidence.eventId ? `event:${evidence.eventId}` : `memory:${evidence.id}`;
    case "RELATIONSHIP_CHANGE":
      return evidence.sourceType === "EVENT" && evidence.sourceId
        ? `event:${evidence.sourceId}`
        : `relationship-change:${evidence.id}`;
    case "GOAL":
      return `goal:${evidence.id}`;
    case "INACTIVITY":
      return `inactivity:${evidence.conversationId}:${evidence.lastMessageId ?? "none"}`;
  }
}

export function relationshipChangeStrength(delta: number): number {
  return Math.min(1, Math.max(0.2, Math.abs(delta) / 50));
}

export function inactivityStrength(idleMs: number, windowMs: number): number {
  if (windowMs <= 0 || idleMs < windowMs) return 0;
  return Math.min(1, idleMs / (windowMs * 2));
}

function pickTargetCharacterId(
  candidateIds: readonly string[],
  characterId: string,
  participantIds: readonly string[],
): string | null {
  const participants = new Set(participantIds);
  const eligible = candidateIds
    .filter((id) => id !== characterId && participants.has(id))
    .sort((a, b) => a.localeCompare(b));
  return eligible[0] ?? null;
}

function eligibleCharacters(
  characterIds: readonly string[],
  participantIds: readonly string[],
  evidenceParticipantIds: readonly string[],
): readonly string[] {
  const participants = new Set(participantIds);
  const evidenceParticipants = new Set(evidenceParticipantIds);
  return [...characterIds]
    .filter((id) => participants.has(id) && evidenceParticipants.has(id))
    .sort((a, b) => a.localeCompare(b));
}

function signal(input: {
  readonly universeId: string;
  readonly characterId: string;
  readonly targetCharacterId: string | null;
  readonly reason: ConversationOpportunityReason;
  readonly strength: number;
  readonly evidenceId: string;
}): ConversationOpportunitySignal {
  return {
    universeId: input.universeId,
    characterId: input.characterId,
    reason: input.reason,
    strength: input.strength,
    evidenceId: input.evidenceId,
    ...(input.targetCharacterId ? { targetCharacterId: input.targetCharacterId } : {}),
  };
}

export function buildOpportunitySignals(input: {
  readonly universeId: string;
  readonly conversationId: string;
  readonly participantIds: readonly string[];
  readonly characterIds: readonly string[];
  readonly evidence: OpportunityEvidence;
}): readonly ConversationOpportunitySignal[] {
  const { evidence } = input;
  const evidenceId = canonicalEvidenceId(evidence);
  const signals: ConversationOpportunitySignal[] = [];

  if (evidence.kind === "EVENT" || evidence.kind === "MEMORY") {
    const reason: ConversationOpportunityReason =
      evidence.kind === "EVENT" ? "WORLD_EVENT" : "MEMORY_TRIGGER";
    const strength =
      evidence.kind === "EVENT"
        ? EVENT_IMPORTANCE_STRENGTH[evidence.importance]
        : MEMORY_IMPORTANCE_STRENGTH[evidence.importance];
    for (const characterId of eligibleCharacters(
      input.characterIds,
      input.participantIds,
      evidence.participantIds,
    )) {
      signals.push(
        signal({
          universeId: input.universeId,
          characterId,
          targetCharacterId: pickTargetCharacterId(
            evidence.participantIds,
            characterId,
            input.participantIds,
          ),
          reason,
          strength,
          evidenceId,
        }),
      );
    }
    return signals;
  }

  if (evidence.kind === "RELATIONSHIP_CHANGE") {
    const involved = [evidence.characterAId, evidence.characterBId];
    const strength = relationshipChangeStrength(evidence.delta);
    for (const characterId of eligibleCharacters(
      input.characterIds,
      input.participantIds,
      involved,
    )) {
      const other = involved.find((id) => id !== characterId) ?? null;
      signals.push(
        signal({
          universeId: input.universeId,
          characterId,
          targetCharacterId:
            other && input.participantIds.includes(other) ? other : null,
          reason: "RELATIONSHIP_CHANGE",
          strength,
          evidenceId,
        }),
      );
    }
    return signals;
  }

  if (evidence.kind === "GOAL") {
    const strength = Math.min(1, Math.max(0, evidence.priority / 100));
    if (strength <= 0) return signals;
    if (
      !input.participantIds.includes(evidence.characterId) ||
      !input.characterIds.includes(evidence.characterId)
    ) {
      return signals;
    }
    const explicitTarget =
      evidence.targetCharacterId &&
      evidence.targetCharacterId !== evidence.characterId &&
      input.participantIds.includes(evidence.targetCharacterId)
        ? evidence.targetCharacterId
        : null;
    signals.push(
      signal({
        universeId: input.universeId,
        characterId: evidence.characterId,
        targetCharacterId:
          explicitTarget ??
          pickTargetCharacterId(
            input.participantIds,
            evidence.characterId,
            input.participantIds,
          ),
        reason: "GOAL_PRESSURE",
        strength,
        evidenceId,
      }),
    );
    return signals;
  }

  const strength = inactivityStrength(evidence.idleMs, evidence.windowMs);
  if (strength <= 0) return signals;
  for (const characterId of eligibleCharacters(
    input.characterIds,
    input.participantIds,
    input.participantIds,
  )) {
    signals.push(
      signal({
        universeId: input.universeId,
        characterId,
        targetCharacterId: pickTargetCharacterId(
          input.participantIds,
          characterId,
          input.participantIds,
        ),
        reason: "INACTIVITY",
        strength,
        evidenceId,
      }),
    );
  }
  return signals;
}
