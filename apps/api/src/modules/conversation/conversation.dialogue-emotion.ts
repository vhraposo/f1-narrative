import { z } from "zod";

import type { ConversationEnergy } from "./conversation.energy.js";

export const DIALOGUE_EMOTION_TONES = [
  "NEUTRAL",
  "PLAYFUL",
  "TENSE",
  "AFFECTIVE",
  "SAD",
  "EXCITED",
] as const;

export const DialogueEmotionToneSchema = z.enum(DIALOGUE_EMOTION_TONES);
export type DialogueEmotionTone = z.infer<typeof DialogueEmotionToneSchema>;

export const DialogueEmotionContextSchema = z.object({
  tone: DialogueEmotionToneSchema,
  intensity: z.number().min(0).max(1),
  sourceSignals: z.array(z.string()).max(4),
});
export type DialogueEmotionContext = z.infer<typeof DialogueEmotionContextSchema>;

const SAD_PATTERN = /\b(triste|chorar|sofrendo|pessimo|pra baixo)\b/;
const TENSE_PATTERN = /\b(nervos[ao]|raiva|odeio|absurdo|urgencia|socorro)\b/;
const LAUGHTER_PATTERN = /\b(kkk+|rsrs+|haha+)\b/;

export function deriveDialogueEmotion(input: {
  readonly energy: ConversationEnergy;
  readonly affinity: number | null;
  readonly recentMessages: readonly { readonly content: string }[];
}): DialogueEmotionContext | null {
  const normalized = input.recentMessages
    .map((message) => message.content)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const signals: string[] = [];
  const laughter = LAUGHTER_PATTERN.test(normalized);
  const sad = SAD_PATTERN.test(normalized);
  const tense = TENSE_PATTERN.test(normalized);
  const playful = input.energy.reasons.includes("GREETING") || laughter;
  const affective = typeof input.affinity === "number" && input.affinity >= 0.7;

  if (laughter) signals.push("LAUGHTER");
  if (sad) signals.push("SAD_LANGUAGE");
  if (tense) signals.push("HIGH_INTENSITY");
  if (playful) signals.push("PLAYFUL_CONTEXT");
  if (affective) signals.push("CLOSE_RELATIONSHIP");

  if (signals.length === 0) return null;

  let tone: DialogueEmotionTone = "NEUTRAL";
  if (sad) tone = "SAD";
  else if (tense) tone = "TENSE";
  else if (affective) tone = "AFFECTIVE";
  else if (playful) tone = "PLAYFUL";
  else if (input.energy.level === "HIGHLY_ACTIVE") tone = "EXCITED";

  return {
    tone,
    intensity: Math.max(0, Math.min(1, input.energy.intensity)),
    sourceSignals: signals.slice(0, 4),
  };
}
