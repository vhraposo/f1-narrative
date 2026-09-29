import { get, post } from "./api";

export type AiDecisionStatus =
  | "NO_ACTION"
  | "DECIDED"
  | "EXECUTING"
  | "EXECUTED"
  | "REJECTED"
  | "FAILED";

export type AiActionType = "NO_ACTION" | "SEND_MESSAGE" | "CREATE_EVENT";

export type AiDecision = {
  id: string;
  characterId: string;
  status: AiDecisionStatus;
  actionType: AiActionType;
  conversationId: string | null;
  reason: string | null;
  contextVersion: string;
  policyCode: string | null;
  executedMessageId: string | null;
  executedEventId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export function listCharacterDecisions(
  characterId: string,
  limit = 10,
): Promise<AiDecision[]> {
  return get<{ decisions: AiDecision[] }>(
    `/api/ai-behavior/decisions?characterId=${characterId}&limit=${limit}`,
  ).then((response) => response.decisions);
}

export function evaluateCharacterBehavior(
  characterId: string,
  trigger?: string,
): Promise<AiDecision> {
  return post<{ decision: AiDecision }>("/api/ai-behavior/evaluate", {
    characterId,
    ...(trigger ? { trigger } : {}),
  }).then((response) => response.decision);
}

export function executeCharacterDecision(
  decisionId: string,
): Promise<AiDecision> {
  return post<{ decision: AiDecision }>("/api/ai-behavior/execute", {
    decisionId,
  }).then((response) => response.decision);
}
