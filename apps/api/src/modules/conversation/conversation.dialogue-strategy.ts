import { z } from "zod";

import type { DialogueIntent } from "./conversation.dialogue.js";
import type { DialogueEmotionTone } from "./conversation.dialogue-emotion.js";
import type { RealizerVoice } from "./conversation.dialogue-realizer.js";

export const DialogueResponseStrategySchema = z.object({
  questionMode: z.enum(["FORBIDDEN", "OPTIONAL", "REQUIRED"]),
  echoMode: z.enum(["FORBIDDEN", "LIMITED"]),
  emojiMode: z.enum(["OFF", "OPTIONAL"]),
  lengthMode: z.enum(["SHORT", "NORMAL", "EXPANSIVE"]),
  nameMode: z.literal("KNOWN_ONLY"),
  actionClaimMode: z.literal("FORBIDDEN"),
});

export type DialogueQuestionMode = "FORBIDDEN" | "OPTIONAL" | "REQUIRED";
export type DialogueEchoMode = "FORBIDDEN" | "LIMITED";
export type DialogueEmojiMode = "OFF" | "OPTIONAL";
export type DialogueLengthMode = "SHORT" | "NORMAL" | "EXPANSIVE";
export type DialogueNameMode = "KNOWN_ONLY";
export type DialogueActionClaimMode = "FORBIDDEN";

export type DialogueResponseStrategy = {
  readonly questionMode: DialogueQuestionMode;
  readonly echoMode: DialogueEchoMode;
  readonly emojiMode: DialogueEmojiMode;
  readonly lengthMode: DialogueLengthMode;
  readonly nameMode: DialogueNameMode;
  readonly actionClaimMode: DialogueActionClaimMode;
};

const QUESTION_FORBIDDEN: ReadonlySet<DialogueIntent> = new Set([
  "INTERRUPTION",
  "SILENCE",
  "JOKE",
  "CALLBACK",
  "TOPIC_CHANGE",
]);

const ECHO_LIMITED: ReadonlySet<DialogueIntent> = new Set([
  "QUESTION",
  "FOLLOW_UP",
  "INTERRUPTION",
]);

const EXPANSIVE: ReadonlySet<DialogueIntent> = new Set(["SUPPORT", "DISAGREE", "CALLBACK"]);

export function deriveDialogueResponseStrategy(input: {
  readonly intent: DialogueIntent;
  readonly emotionTone: DialogueEmotionTone | null;
  readonly voice: RealizerVoice;
  readonly replyToContent: string | null;
}): DialogueResponseStrategy {
  const questionMode: DialogueQuestionMode =
    input.intent === "QUESTION" || input.intent === "FOLLOW_UP"
      ? "REQUIRED"
      : QUESTION_FORBIDDEN.has(input.intent)
        ? "FORBIDDEN"
        : "OPTIONAL";
  const lowEnergy = input.emotionTone === "SAD" || input.emotionTone === "TENSE";
  const replyLength = input.replyToContent?.trim().length ?? 0;
  const lengthMode: DialogueLengthMode =
    EXPANSIVE.has(input.intent) && input.voice.verbosity >= 0.6
      ? "EXPANSIVE"
      : input.intent === "REACTION" ||
          input.intent === "INTERRUPTION" ||
          input.voice.verbosity <= 0.3 ||
          (replyLength > 0 && replyLength <= 12)
        ? "SHORT"
        : "NORMAL";
  return {
    questionMode,
    echoMode: ECHO_LIMITED.has(input.intent) ? "LIMITED" : "FORBIDDEN",
    emojiMode: lowEnergy ? "OFF" : "OPTIONAL",
    lengthMode,
    nameMode: "KNOWN_ONLY",
    actionClaimMode: "FORBIDDEN",
  };
}
