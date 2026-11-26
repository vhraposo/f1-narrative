export type ConversationTurnLimits = {
  readonly maxAiTurnsPerRound: number;
  readonly maxTotalAiMessages: number;
  readonly maxConsecutiveSameSpeaker: number;
  readonly inactivityTimeoutMs: number;
  readonly maxSummaryChars: number;
  readonly recentMessageWindow: number;
};

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function conversationTurnLimits(): ConversationTurnLimits {
  return {
    maxAiTurnsPerRound: readPositiveInt("CONVERSATION_MAX_AI_TURNS_PER_ROUND", 4),
    maxTotalAiMessages: readPositiveInt("CONVERSATION_MAX_AI_MESSAGES", 20),
    maxConsecutiveSameSpeaker: readPositiveInt("CONVERSATION_MAX_CONSECUTIVE_SPEAKER", 2),
    inactivityTimeoutMs: readPositiveInt(
      "CONVERSATION_INACTIVITY_TIMEOUT_MS",
      72 * 60 * 60 * 1000,
    ),
    maxSummaryChars: readPositiveInt("CONVERSATION_MAX_SUMMARY_CHARS", 600),
    recentMessageWindow: readPositiveInt("CONVERSATION_RECENT_MESSAGE_WINDOW", 12),
  };
}

export const CONVERSATION_TURN_PLAN_VERSION = "conversation-turn-plan.v1";
