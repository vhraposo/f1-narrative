import { z } from "zod";

import type { ConversationEnergy, ResponseWindow } from "./conversation.energy.js";
import {
  selectResponseCandidates,
  type ResponseCandidate,
  type ResponseSelectionInput,
  type ResponseSelectionResult,
} from "./conversation.response-engine.js";

export const DIALOGUE_INTENTS = [
  "ANSWER",
  "QUESTION",
  "REACTION",
  "JOKE",
  "TEASE",
  "SUPPORT",
  "DISAGREE",
  "FOLLOW_UP",
  "TOPIC_CHANGE",
  "INTERRUPTION",
  "CALLBACK",
  "SILENCE",
] as const;

export const DialogueIntentSchema = z.enum(DIALOGUE_INTENTS);
export type DialogueIntent = z.infer<typeof DialogueIntentSchema>;

export const DialogueTurnSchema = z.object({
  speakerCharacterId: z.string().min(1),
  replyToMessageId: z.string().nullable(),
  intent: DialogueIntentSchema,
  maxMessages: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  priority: z.number(),
});
export type DialogueTurn = z.infer<typeof DialogueTurnSchema>;

export const DialoguePlanSchema = z.object({
  conversationIntent: z.enum(["CONTINUE", "CLOSE", "SHIFT_TOPIC", "REACT"]),
  topic: z.string().nullable(),
  emotionalTone: z.enum(["NEUTRAL", "PLAYFUL", "TENSE", "AFFECTIVE", "SAD", "EXCITED"]),
  turns: z.array(DialogueTurnSchema),
  continuation: z.enum(["RE_EVALUATE", "STOP"]),
  stopReason: z.enum([
    "SELECTED",
    "NATURAL_END",
    "NO_OPPORTUNITY",
    "TOPIC_CLOSED",
    "BUDGET",
    "INACTIVE",
    "PLANNER_DECLINED",
  ]),
});
export type DialoguePlan = z.infer<typeof DialoguePlanSchema>;

export const DialogueUtteranceSchema = z.object({
  speakerCharacterId: z.string().min(1),
  replyToMessageId: z.string().nullable(),
  intent: DialogueIntentSchema,
  messages: z.array(
    z.object({
      text: z.string(),
      fragmentIndex: z.number().int().min(0),
    }),
  ),
});
export type DialogueUtterance = z.infer<typeof DialogueUtteranceSchema>;

export const MessageDialogueMetadataSchema = z.object({
  responseType: DialogueIntentSchema.optional(),
  replyToMessageId: z.string().nullable().optional(),
  fragmentIndex: z.number().int().min(0).optional(),
  topicTag: z.string().nullable().optional(),
});
export type MessageDialogueMetadata = z.infer<typeof MessageDialogueMetadataSchema>;

export type CandidateSetEntry = {
  readonly characterId: string;
  readonly name: string;
  readonly eligible: boolean;
  readonly opportunity: number;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly allowedIntents: readonly DialogueIntent[];
  readonly recentActivity: number;
};

export type DialogueCandidateSet = {
  readonly conversationId: string;
  readonly universeId: string;
  readonly lastMessageId: string;
  readonly lastMessageContent: string;
  readonly depth: number;
  readonly energy: ConversationEnergy;
  readonly window: ResponseWindow;
  readonly candidates: readonly CandidateSetEntry[];
  readonly selected: readonly CandidateSetEntry[];
  readonly rejected: readonly CandidateSetEntry[];
};

const INTENT_BY_REASON: Readonly<Record<string, DialogueIntent>> = {
  DIRECT_MENTION: "ANSWER",
  SOCIAL_BASELINE: "REACTION",
  RECENTLY_SPOKE: "FOLLOW_UP",
  DEPTH_PENALTY: "REACTION",
  SEEDED_VARIATION: "REACTION",
};

function allowedIntentsFor(reasons: readonly string[]): DialogueIntent[] {
  const intents = new Set<DialogueIntent>(["REACTION", "FOLLOW_UP", "SUPPORT", "SILENCE"]);
  for (const reason of reasons) {
    const intent = INTENT_BY_REASON[reason];
    if (intent) intents.add(intent);
  }
  return [...intents];
}

function toCandidateEntry(
  candidate: ResponseCandidate,
  eligible: boolean,
  recentActivity: number,
): CandidateSetEntry {
  return {
    characterId: candidate.characterId,
    name: candidate.name,
    eligible,
    opportunity: candidate.opportunity,
    score: candidate.score,
    reasons: candidate.reasons,
    allowedIntents: allowedIntentsFor(candidate.reasons),
    recentActivity,
  };
}

export function buildDialogueCandidateSet(input: {
  readonly conversationId: string;
  readonly universeId: string;
  readonly lastMessageId: string;
  readonly lastMessageContent: string;
  readonly depth: number;
  readonly energy: ConversationEnergy;
  readonly window: ResponseWindow;
  readonly selection: ResponseSelectionResult;
}): DialogueCandidateSet {
  const selectedIds = new Set(input.selection.selected.map((candidate) => candidate.characterId));
  const candidates = [
    ...input.selection.selected.map((candidate) =>
      toCandidateEntry(candidate, true, selectedIds.size > 0 ? 1 : 0),
    ),
    ...input.selection.rejected
      .filter((candidate) => !candidate.reasons.includes("ALREADY_RESPONDED"))
      .map((candidate) => toCandidateEntry(candidate, false, 0)),
  ];
  return {
    conversationId: input.conversationId,
    universeId: input.universeId,
    lastMessageId: input.lastMessageId,
    lastMessageContent: input.lastMessageContent,
    depth: input.depth,
    energy: input.energy,
    window: input.window,
    candidates,
    selected: candidates.filter((candidate) => candidate.eligible),
    rejected: candidates.filter((candidate) => !candidate.eligible),
  };
}

const RACE_TOPIC_PATTERN = /\b(corrida|classifica|qualifica|resultado|gp|podium|pódio|pole|volta|equipe|carro)\b/;

function deriveTopic(content: string): string | null {
  const normalized = content
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (RACE_TOPIC_PATTERN.test(normalized)) return "race";
  return null;
}

export function deriveDialogueIntent(input: {
  readonly content: string;
  readonly mentioned: boolean;
  readonly energy: ConversationEnergy;
}): DialogueIntent {
  const normalized = input.content.toLowerCase();
  if (input.mentioned) return normalized.includes("?") ? "ANSWER" : "FOLLOW_UP";
  if (normalized.includes("?")) return "ANSWER";
  if (/\b(kkk+|rsrs+|haha+)\b/.test(normalized)) return "JOKE";
  if (input.energy.reasons.includes("GREETING")) return "REACTION";
  if (input.energy.intensity >= 0.5) return "SUPPORT";
  return "REACTION";
}

export type DialoguePlannerInput = {
  readonly candidateSet: DialogueCandidateSet;
};

export interface DialoguePlanner {
  readonly kind: "deterministic" | "llm";
  plan(input: DialoguePlannerInput): Promise<DialoguePlan>;
}

const MAX_TURNS_HARD_CEILING = 4;

export class DeterministicDialoguePlanner implements DialoguePlanner {
  readonly kind = "deterministic" as const;

  async plan(input: DialoguePlannerInput): Promise<DialoguePlan> {
    const { candidateSet } = input;
    const topic = deriveTopic(candidateSet.lastMessageContent);
    const emotionalTone =
      candidateSet.energy.intensity >= 0.5
        ? "TENSE"
        : candidateSet.energy.reasons.includes("GREETING")
          ? "PLAYFUL"
          : "NEUTRAL";

    if (candidateSet.energy.level === "QUIET" && candidateSet.selected.length === 0) {
      return {
        conversationIntent: "CLOSE",
        topic,
        emotionalTone,
        turns: [],
        continuation: "STOP",
        stopReason: "NO_OPPORTUNITY",
      };
    }

    const turnCeiling = Math.min(
      MAX_TURNS_HARD_CEILING,
      candidateSet.window.maxInitialResponders + candidateSet.window.maxReactions,
    );
    const ranked = [...candidateSet.selected].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.characterId.localeCompare(b.characterId);
    });

    const turns: DialogueTurn[] = [];
    for (const candidate of ranked) {
      if (turns.length >= turnCeiling) break;
      const mentioned = candidate.reasons.includes("DIRECT_MENTION");
      const intent =
        mentioned || candidate.reasons.includes("SOCIAL_BASELINE")
          ? deriveDialogueIntent({
              content: candidateSet.lastMessageContent,
              mentioned,
              energy: candidateSet.energy,
            })
          : (candidate.allowedIntents[0] ?? "REACTION");
      const maxMessages: 1 | 2 | 3 =
        candidateSet.energy.level === "HIGHLY_ACTIVE" && intent === "ANSWER" ? 2 : 1;
      turns.push({
        speakerCharacterId: candidate.characterId,
        replyToMessageId: candidateSet.lastMessageId,
        intent,
        maxMessages,
        priority: candidate.score / 100,
      });
    }

    if (turns.length === 0) {
      return {
        conversationIntent: "CLOSE",
        topic,
        emotionalTone,
        turns: [],
        continuation: "STOP",
        stopReason: candidateSet.window.maxInitialResponders === 0 ? "BUDGET" : "NO_OPPORTUNITY",
      };
    }

    const exhausted = candidateSet.depth + turns.length >= candidateSet.window.maxChainDepth;
    return {
      conversationIntent: topic ? "CONTINUE" : "REACT",
      topic,
      emotionalTone,
      turns,
      continuation: exhausted ? "STOP" : "RE_EVALUATE",
      stopReason: "SELECTED",
    };
  }
}

export function buildPlannerInput(input: ResponseSelectionInput, meta: {
  readonly conversationId: string;
  readonly universeId: string;
  readonly lastMessageContent: string;
  readonly energy: ConversationEnergy;
  readonly window: ResponseWindow;
}): DialoguePlannerInput {
  const selection = selectResponseCandidates(input);
  return {
    candidateSet: buildDialogueCandidateSet({
      conversationId: meta.conversationId,
      universeId: meta.universeId,
      lastMessageId: input.seed.lastMessageId,
      lastMessageContent: meta.lastMessageContent,
      depth: input.depth,
      energy: meta.energy,
      window: meta.window,
      selection,
    }),
  };
}

export type DialogueValidationContext = {
  readonly participantIds: ReadonlySet<string>;
  readonly aiParticipantIds: ReadonlySet<string>;
  readonly eligibleCandidateIds: ReadonlySet<string>;
  readonly availablePutativeIds: ReadonlySet<string>;
  readonly messageIds: ReadonlySet<string>;
  readonly maxTurns: number;
  readonly remainingBudget: number;
};

export type DialogueValidation = {
  readonly valid: boolean;
  readonly errors: readonly string[];
};

export function validateDialoguePlan(
  plan: DialoguePlan,
  context: DialogueValidationContext,
): DialogueValidation {
  const errors: string[] = [];
  if (plan.turns.length > context.maxTurns) errors.push("TURNS_OVER_CEILING");
  if (plan.turns.length > context.remainingBudget) errors.push("TURNS_OVER_BUDGET");
  const seen = new Set<string>();
  for (const turn of plan.turns) {
    if (!context.participantIds.has(turn.speakerCharacterId)) errors.push("SPEAKER_NOT_PARTICIPANT");
    if (!context.aiParticipantIds.has(turn.speakerCharacterId)) errors.push("SPEAKER_NOT_AI");
    if (!context.eligibleCandidateIds.has(turn.speakerCharacterId)) errors.push("SPEAKER_NOT_CANDIDATE");
    if (!context.availablePutativeIds.has(turn.speakerCharacterId)) errors.push("SPEAKER_UNAVAILABLE");
    if (seen.has(turn.speakerCharacterId)) errors.push("DUPLICATE_SPEAKER");
    seen.add(turn.speakerCharacterId);
    if (turn.replyToMessageId !== null && !context.messageIds.has(turn.replyToMessageId)) {
      errors.push("REPLY_TO_UNKNOWN");
    }
    if (![2, 3].includes(turn.maxMessages) && turn.maxMessages !== 1) errors.push("MAX_MESSAGES_INVALID");
  }
  return { valid: errors.length === 0, errors };
}

export function buildFallbackPlan(candidateSet: DialogueCandidateSet): DialoguePlan {
  const best = candidateSet.selected[0];
  if (!best) {
    return {
      conversationIntent: "CLOSE",
      topic: deriveTopic(candidateSet.lastMessageContent),
      emotionalTone: "NEUTRAL",
      turns: [],
      continuation: "STOP",
      stopReason: "PLANNER_DECLINED",
    };
  }
  return {
    conversationIntent: "REACT",
    topic: deriveTopic(candidateSet.lastMessageContent),
    emotionalTone: "NEUTRAL",
    turns: [
      {
        speakerCharacterId: best.characterId,
        replyToMessageId: candidateSet.lastMessageId,
        intent: best.allowedIntents.includes("ANSWER") ? "ANSWER" : "REACTION",
        maxMessages: 1,
        priority: best.score / 100,
      },
    ],
    continuation: "STOP",
    stopReason: "PLANNER_DECLINED",
  };
}
