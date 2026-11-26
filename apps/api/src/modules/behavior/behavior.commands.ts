import type { Prisma } from "@prisma/client";

import { createEventWithDerivations } from "../events/event-create.js";
import { applyRelationshipDelta } from "../relationships/relationship.evolution.js";
import { deterministicTextFor } from "./behavior.language.js";
import {
  BehaviorError,
  type BehaviorActionType,
  type BehaviorCandidate,
  type BehaviorContextView,
  type BehaviorDecisionRequest,
} from "./behavior.types.js";

export type BehaviorDialogueMetadata = {
  readonly intent?: string;
  readonly replyToMessageId?: string | null;
  readonly fragmentIndex?: number;
  readonly topicTag?: string | null;
};

export type BehaviorLanguageOverride = {
  readonly text: string;
  readonly provider: string;
  readonly model: string;
  readonly fallback: boolean;
  readonly dialogue?: BehaviorDialogueMetadata;
};

export type BehaviorCommandInput = {
  readonly tx: Prisma.TransactionClient;
  readonly request: BehaviorDecisionRequest;
  readonly context: BehaviorContextView;
  readonly candidate: BehaviorCandidate;
  readonly worldDate: Date;
  readonly contentOverride?: BehaviorLanguageOverride;
};

export type BehaviorCommandResult = {
  readonly messageId?: string;
  readonly eventId?: string;
};

const ALLOWED_EVENT_TYPES = new Set(["SOCIAL", "PERSONAL", "RELATIONSHIP"]);

function requireAiCharacter(request: BehaviorDecisionRequest, context: BehaviorContextView): void {
  if (!request.userInitiated && context.identity.controller !== "AI") {
    throw new BehaviorError(
      "CHARACTER_NOT_AI",
      "Personagem controlado pelo usuário não executa ação autônoma",
      403,
    );
  }
}

async function requireTargetInUniverse(
  tx: Prisma.TransactionClient,
  universeId: string,
  targetCharacterId: string | null,
): Promise<string | null> {
  if (!targetCharacterId) return null;
  const target = await tx.character.findUnique({
    where: { id: targetCharacterId },
    select: { id: true, universeId: true },
  });
  if (!target) {
    throw new BehaviorError("TARGET_NOT_FOUND", "Personagem alvo não encontrado", 404);
  }
  if (target.universeId !== universeId) {
    throw new BehaviorError("UNIVERSE_MISMATCH", "Alvo pertence a outro Universe", 403);
  }
  return target.id;
}

async function executeMessageCommand(
  input: BehaviorCommandInput,
): Promise<BehaviorCommandResult> {
  requireAiCharacter(input.request, input.context);
  const conversationId = input.candidate.conversationId;
  if (!conversationId) {
    throw new BehaviorError("TARGET_NOT_FOUND", "Conversa não informada", 400);
  }
  const conversation = await input.tx.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      participants: { select: { characterId: true }, orderBy: { characterId: "asc" } },
    },
  });
  if (!conversation) {
    throw new BehaviorError("TARGET_NOT_FOUND", "Conversa não encontrada", 404);
  }
  const participantIds = conversation.participants.map((participant) => participant.characterId);
  if (!participantIds.includes(input.request.characterId)) {
    throw new BehaviorError(
      "TARGET_NOT_PARTICIPANT",
      "Personagem não participa da conversa",
      403,
    );
  }
  await requireTargetInUniverse(input.tx, input.request.universeId, input.candidate.targetCharacterId);

  // F7.5: o alvo da mensagem precisa ser participante da conversa (defesa
  // estrutural no Command Layer; não depende de conteúdo).
  if (
    input.candidate.targetCharacterId &&
    !participantIds.includes(input.candidate.targetCharacterId)
  ) {
    throw new BehaviorError(
      "TARGET_NOT_PARTICIPANT",
      "Alvo não participa da conversa",
      403,
    );
  }

  const override = input.contentOverride;
  const content = override ? override.text.trim() : deterministicTextFor(input.context, input.candidate.reasonCode);
  if (content.length === 0 || content.length > 5000) {
    throw new BehaviorError("PRECONDITION_FAILED", "Conteúdo de mensagem inválido", 400);
  }
  const message = await input.tx.message.create({
    data: {
      conversationId,
      senderType: "AI_CHARACTER",
      characterId: input.request.characterId,
      content,
      contextJson: {
        behavior: {
          reasonCode: input.candidate.reasonCode,
          actionFingerprint: input.candidate.metadata.actionFingerprint ?? null,
          goalIds: input.candidate.goalIds,
        },
        ...(override
          ? {
              language: {
                provider: override.provider,
                model: override.model,
                fallback: override.fallback,
              },
            }
          : {}),
        ...(override?.dialogue ? { dialogue: override.dialogue } : {}),
      },
    },
    select: { id: true },
  });
  await input.tx.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: input.worldDate },
  });
  return { messageId: message.id };
}

async function executeCreateEventCommand(
  input: BehaviorCommandInput,
): Promise<BehaviorCommandResult> {
  requireAiCharacter(input.request, input.context);
  const requestedType =
    typeof input.candidate.metadata.eventType === "string"
      ? input.candidate.metadata.eventType
      : "SOCIAL";
  const eventType = ALLOWED_EVENT_TYPES.has(requestedType) ? requestedType : "SOCIAL";
  const targetId = await requireTargetInUniverse(
    input.tx,
    input.request.universeId,
    input.candidate.targetCharacterId,
  );
  const participantIds = targetId
    ? [input.request.characterId, targetId]
    : [input.request.characterId];
  const created = await createEventWithDerivations(
    input.tx,
    {
      type: eventType as "SOCIAL" | "PERSONAL" | "RELATIONSHIP",
      title: `${input.context.identity.name}: ${input.candidate.reasonCode}`,
      description: deterministicTextFor(input.context, input.candidate.reasonCode),
      importance: "MEDIUM",
      source: "GENERATED_EVENT",
      worldDate: input.worldDate,
      payload: {
        behavior: {
          reasonCode: input.candidate.reasonCode,
          actionFingerprint: input.candidate.metadata.actionFingerprint ?? null,
        },
      },
    },
    participantIds,
  );
  return { eventId: created.id };
}

async function executeCreateMemoryCommand(
  input: BehaviorCommandInput,
): Promise<BehaviorCommandResult> {
  requireAiCharacter(input.request, input.context);
  const targetId = await requireTargetInUniverse(
    input.tx,
    input.request.universeId,
    input.candidate.targetCharacterId,
  );
  const experience = input.context.experience.recent[0] ?? null;
  const content = experience
    ? `${input.context.identity.name}: ${experience.title} (${input.candidate.reasonCode})`
    : deterministicTextFor(input.context, input.candidate.reasonCode);
  const participantIds = targetId
    ? [input.request.characterId, targetId]
    : [input.request.characterId];
  const fingerprint =
    typeof input.candidate.metadata.actionFingerprint === "string"
      ? input.candidate.metadata.actionFingerprint
      : null;
  await input.tx.memory.create({
    data: {
      universeId: input.request.universeId,
      content,
      summary: experience?.title ?? null,
      importance: "HIGH",
      derivation: "RULE_DERIVED",
      status: "ACTIVE",
      revision: 1,
      source: "GENERATED_EVENT",
      derivedKey: fingerprint,
      memoryType: experience?.experienceType ?? null,
      participants: {
        create: participantIds.map((characterId) => ({ characterId })),
      },
      context: {
        behavior: {
          reasonCode: input.candidate.reasonCode,
          actionFingerprint: fingerprint,
          goalIds: input.candidate.goalIds,
        },
      },
    },
  });
  return {};
}

async function executeUpdateRelationshipCommand(
  input: BehaviorCommandInput,
): Promise<BehaviorCommandResult> {
  requireAiCharacter(input.request, input.context);
  const targetId = input.candidate.targetCharacterId;
  if (!targetId) {
    throw new BehaviorError("TARGET_NOT_FOUND", "Alvo não informado", 400);
  }
  await requireTargetInUniverse(input.tx, input.request.universeId, targetId);
  const confront = /CONFRONT/.test(input.candidate.reasonCode);
  const fingerprint =
    typeof input.candidate.metadata.actionFingerprint === "string"
      ? input.candidate.metadata.actionFingerprint
      : null;
  await applyRelationshipDelta(
    {
      characterAId: input.request.characterId,
      characterBId: targetId,
      deltas: { respect: confront ? -1 : 2, rivalry: confront ? 2 : -1 },
      ruleCode: confront
        ? "relationship-rule.behavior-confront.v1"
        : "relationship-rule.behavior-support.v1",
      sourceType: "BEHAVIOR_DECISION",
      sourceId: fingerprint,
      worldDate: input.worldDate,
      metadata: { reasonCode: input.candidate.reasonCode },
    },
    input.tx,
  );
  return {};
}

export function commandForAction(
  actionType: BehaviorActionType,
): ((input: BehaviorCommandInput) => Promise<BehaviorCommandResult>) | null {
  switch (actionType) {
    case "RESPOND":
    case "SEND_MESSAGE":
      return executeMessageCommand;
    case "CREATE_EVENT":
      return executeCreateEventCommand;
    case "CREATE_MEMORY":
      return executeCreateMemoryCommand;
    case "UPDATE_RELATIONSHIP":
      return executeUpdateRelationshipCommand;
    default:
      return null;
  }
}
