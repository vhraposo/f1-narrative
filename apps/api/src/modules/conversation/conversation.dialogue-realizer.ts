import { z } from "zod";

import {
  DialogueIntentSchema,
  DialogueUtteranceSchema,
  type DialogueIntent,
  type DialogueUtterance,
} from "./conversation.dialogue.js";

export const RealizerVoiceSchema = z.object({
  informality: z.number().min(0).max(1),
  warmth: z.number().min(0).max(1),
  humor: z.number().min(0).max(1),
  emojiTendency: z.number().min(0).max(1),
  verbosity: z.number().min(0).max(1),
});
export type RealizerVoice = z.infer<typeof RealizerVoiceSchema>;

export const RealizerRecentMessageSchema = z.object({
  speakerName: z.string().min(1),
  content: z.string(),
});

export const DialogueRealizerContextSchema = z.object({
  speakerCharacterId: z.string().min(1),
  speakerName: z.string().min(1),
  intent: DialogueIntentSchema,
  replyToMessageId: z.string().nullable(),
  replyToContent: z.string().nullable(),
  recentMessages: z.array(RealizerRecentMessageSchema).max(6),
  topic: z.string().nullable(),
  emotionalTone: z.string().nullable(),
  relationshipAffinity: z.number().min(0).max(1).nullable(),
  memorySummaries: z.array(z.string()).max(3),
  voice: RealizerVoiceSchema,
  maxMessages: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  language: z.literal("pt-BR"),
});
export type DialogueRealizerContext = z.infer<typeof DialogueRealizerContextSchema>;

export function buildDialogueRealizerContext(
  input: z.input<typeof DialogueRealizerContextSchema>,
): DialogueRealizerContext {
  return DialogueRealizerContextSchema.parse(input);
}

export type DialogueRealizerProvider = {
  readonly name: string;
  readonly model?: string;
  realize(context: DialogueRealizerContext): Promise<unknown>;
};

export interface DialogueRealizer {
  readonly kind: "deterministic" | "llm";
  realize(context: DialogueRealizerContext): Promise<DialogueUtterance>;
}

export type RealizerValidation = {
  readonly valid: boolean;
  readonly errors: readonly string[];
};

export function validateRealizerResult(
  result: unknown,
  expected: {
    readonly speakerCharacterId: string;
    readonly intent: DialogueIntent;
    readonly replyToMessageId: string | null;
    readonly maxMessages: number;
  },
): RealizerValidation {
  const parsed = DialogueUtteranceSchema.safeParse(result);
  if (!parsed.success) return { valid: false, errors: ["INVALID_SCHEMA"] };
  const utterance = parsed.data;
  const errors: string[] = [];
  if (utterance.speakerCharacterId !== expected.speakerCharacterId) errors.push("SPEAKER_MISMATCH");
  if (utterance.intent !== expected.intent) errors.push("INTENT_MISMATCH");
  if (utterance.replyToMessageId !== expected.replyToMessageId) errors.push("REPLY_TO_MISMATCH");
  if (utterance.messages.length === 0) errors.push("EMPTY_OUTPUT");
  if (utterance.messages.length > expected.maxMessages) errors.push("MAX_MESSAGES_EXCEEDED");
  utterance.messages.forEach((message, index) => {
    const text = message.text.trim();
    if (text.length === 0) errors.push("EMPTY_TEXT");
    if (text.startsWith("{") || text.startsWith("[")) errors.push("JSON_TEXT");
    if (message.fragmentIndex !== index) errors.push("FRAGMENT_INDEX_INVALID");
  });
  return { valid: errors.length === 0, errors };
}
