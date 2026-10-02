import { createHash } from "node:crypto";

import { z } from "zod";

export const CONVERSATION_OPPORTUNITY_REASONS = [
  "WORLD_EVENT",
  "RELATIONSHIP_CHANGE",
  "MEMORY_TRIGGER",
  "GOAL_PRESSURE",
  "INACTIVITY",
] as const;

export const ConversationOpportunityReasonSchema = z.enum(CONVERSATION_OPPORTUNITY_REASONS);
export type ConversationOpportunityReason = z.infer<typeof ConversationOpportunityReasonSchema>;

const REASON_BASE_PRIORITY: Record<ConversationOpportunityReason, number> = {
  WORLD_EVENT: 0.8,
  RELATIONSHIP_CHANGE: 0.6,
  MEMORY_TRIGGER: 0.5,
  GOAL_PRESSURE: 0.4,
  INACTIVITY: 0.3,
};

export const ConversationOpportunitySignalSchema = z.object({
  universeId: z.string().min(1),
  characterId: z.string().min(1),
  reason: ConversationOpportunityReasonSchema,
  strength: z.number().min(0).max(1),
  evidenceId: z.string().min(1),
  targetCharacterId: z.string().min(1).nullable().optional(),
});
export type ConversationOpportunitySignal = z.infer<typeof ConversationOpportunitySignalSchema>;

export const ConversationOpportunitySchema = z.object({
  universeId: z.string().min(1),
  conversationId: z.string().min(1),
  characterId: z.string().min(1),
  targetCharacterId: z.string().min(1).nullable(),
  reason: ConversationOpportunityReasonSchema,
  priority: z.number().min(0).max(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  windowStart: z.string().datetime(),
});
export type ConversationOpportunity = z.infer<typeof ConversationOpportunitySchema>;

export function computeOpportunityFingerprint(input: {
  readonly universeId: string;
  readonly conversationId: string;
  readonly characterId: string;
  readonly targetCharacterId: string | null;
  readonly reason: ConversationOpportunityReason;
  readonly windowStart: Date;
  readonly evidenceId: string;
}): string {
  return createHash("sha256")
    .update(
      [
        input.universeId,
        input.conversationId,
        input.characterId,
        input.targetCharacterId ?? "none",
        input.reason,
        input.windowStart.toISOString(),
        input.evidenceId,
      ].join(":"),
    )
    .digest("hex");
}

export function buildConversationOpportunity(input: {
  readonly universeId: string;
  readonly conversationId: string;
  readonly participantIds: readonly string[];
  readonly windowStart: Date;
  readonly signal: ConversationOpportunitySignal;
}): ConversationOpportunity | null {
  const { signal } = input;
  if (signal.universeId !== input.universeId) return null;
  if (!input.participantIds.includes(signal.characterId)) return null;
  if (signal.strength <= 0) return null;
  if (signal.targetCharacterId && !input.participantIds.includes(signal.targetCharacterId)) {
    return null;
  }
  const targetCharacterId = signal.targetCharacterId ?? null;
  const priority =
    Math.round(
      Math.max(
        0,
        Math.min(1, REASON_BASE_PRIORITY[signal.reason] + signal.strength * 0.2),
      ) * 1000,
    ) / 1000;
  return ConversationOpportunitySchema.parse({
    universeId: input.universeId,
    conversationId: input.conversationId,
    characterId: signal.characterId,
    targetCharacterId,
    reason: signal.reason,
    priority,
    fingerprint: computeOpportunityFingerprint({
      universeId: input.universeId,
      conversationId: input.conversationId,
      characterId: signal.characterId,
      targetCharacterId,
      reason: signal.reason,
      windowStart: input.windowStart,
      evidenceId: signal.evidenceId,
    }),
    windowStart: input.windowStart.toISOString(),
  });
}
