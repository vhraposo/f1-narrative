import {
  DialogueUtteranceSchema,
  type DialogueIntent,
  type DialogueUtterance,
} from "./conversation.dialogue.js";
import {
  isGenericText,
  validateRealizerResult,
  type DialogueRealizerContext,
} from "./conversation.dialogue-realizer.js";

export type DialogueOutputViolation =
  | "INVALID_SCHEMA"
  | "SPEAKER_MISMATCH"
  | "INTENT_MISMATCH"
  | "REPLY_TO_MISMATCH"
  | "REPLY_TO_UNKNOWN"
  | "REPLY_TO_FUTURE"
  | "EMPTY_OUTPUT"
  | "EMPTY_TEXT"
  | "JSON_TEXT"
  | "META_TEXT"
  | "GENERIC_TEXT"
  | "FRAGMENT_OVERFLOW"
  | "FRAGMENT_INDEX_INVALID"
  | "MONOLOGUE"
  | "DUPLICATE_IMMEDIATE"
  | "SILENCE_WITH_TEXT"
  | "QUESTION_WITHOUT_QUESTION"
  | "STOP_WITH_OUTPUT";

export type DialogueOutputValidation = {
  readonly valid: boolean;
  readonly normalized: DialogueUtterance | null;
  readonly violations: readonly DialogueOutputViolation[];
  readonly fallbackRequired: boolean;
  readonly reason: string | null;
};

const INTENT_MONOLOGUE_LIMIT: Record<DialogueIntent, number> = {
  REACTION: 80,
  INTERRUPTION: 60,
  QUESTION: 140,
  FOLLOW_UP: 140,
  JOKE: 120,
  TEASE: 120,
  TOPIC_CHANGE: 200,
  SUPPORT: 300,
  DISAGREE: 300,
  CALLBACK: 300,
  ANSWER: 400,
  SILENCE: 0,
};

const META_PATTERNS: readonly RegExp[] = [
  /como (?:uma )?ia\b/i,
  /como assistente/i,
  /neste contexto/i,
  /aqui está (?:a|o|minha|meu)/i,
  /minha resposta é/i,
  /enquanto personagem/i,
];

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function validateDialogueOutput(input: {
  readonly context: DialogueRealizerContext;
  readonly utterance: DialogueUtterance;
  readonly previousMessageContent?: string | null;
  readonly stopped?: boolean;
  readonly replyToKnown?: boolean;
  readonly replyToIsFuture?: boolean;
}): DialogueOutputValidation {
  const violations: DialogueOutputViolation[] = [];
  if (input.context.intent === "SILENCE" && input.utterance.messages.length === 0) {
    return {
      valid: true,
      normalized: {
        speakerCharacterId: input.utterance.speakerCharacterId,
        replyToMessageId: input.utterance.replyToMessageId,
        intent: input.utterance.intent,
        messages: [],
      },
      violations: [],
      fallbackRequired: false,
      reason: null,
    };
  }
  const structural = validateRealizerResult(input.utterance, {
    speakerCharacterId: input.context.speakerCharacterId,
    intent: input.context.intent,
    replyToMessageId: input.context.replyToMessageId,
    maxMessages: input.context.maxMessages,
  });
  if (!structural.valid) {
    const mapped = structural.errors.map((error): DialogueOutputViolation => {
      if (error === "INVALID_SCHEMA") return "INVALID_SCHEMA";
      if (error === "SPEAKER_MISMATCH") return "SPEAKER_MISMATCH";
      if (error === "INTENT_MISMATCH") return "INTENT_MISMATCH";
      if (error === "REPLY_TO_MISMATCH") return "REPLY_TO_MISMATCH";
      if (error === "EMPTY_OUTPUT") return "EMPTY_OUTPUT";
      if (error === "EMPTY_TEXT") return "EMPTY_TEXT";
      if (error === "JSON_TEXT") return "JSON_TEXT";
      if (error === "MAX_MESSAGES_EXCEEDED") return "FRAGMENT_OVERFLOW";
      return "FRAGMENT_INDEX_INVALID";
    });
    return {
      valid: false,
      normalized: null,
      violations: mapped,
      fallbackRequired: true,
      reason: mapped[0] ?? "INVALID_OUTPUT",
    };
  }

  if (input.replyToKnown === false) violations.push("REPLY_TO_UNKNOWN");
  if (input.replyToIsFuture === true) violations.push("REPLY_TO_FUTURE");
  if (input.stopped === true && input.utterance.messages.length > 0) {
    violations.push("STOP_WITH_OUTPUT");
  }
  if (input.context.intent === "SILENCE" && input.utterance.messages.length > 0) {
    violations.push("SILENCE_WITH_TEXT");
  }

  const previous = input.previousMessageContent ? normalizeText(input.previousMessageContent) : null;
  const normalizedMessages: { text: string; fragmentIndex: number }[] = [];
  input.utterance.messages.forEach((message, index) => {
    const text = normalizeText(message.text);
    if (text.length === 0) violations.push("EMPTY_TEXT");
    if (text.startsWith("{") || text.startsWith("[")) violations.push("JSON_TEXT");
    if (META_PATTERNS.some((pattern) => pattern.test(text))) violations.push("META_TEXT");
    if (isGenericText(text)) violations.push("GENERIC_TEXT");
    if (text.length > INTENT_MONOLOGUE_LIMIT[input.context.intent]) violations.push("MONOLOGUE");
    if (previous !== null && text === previous) violations.push("DUPLICATE_IMMEDIATE");
    if (input.context.intent === "QUESTION" && !text.includes("?")) {
      violations.push("QUESTION_WITHOUT_QUESTION");
    }
    normalizedMessages.push({ text, fragmentIndex: index });
  });

  if (violations.length > 0) {
    return {
      valid: false,
      normalized: null,
      violations,
      fallbackRequired: true,
      reason: violations[0] ?? "INVALID_OUTPUT",
    };
  }

  const normalized = DialogueUtteranceSchema.parse({
    speakerCharacterId: input.utterance.speakerCharacterId,
    replyToMessageId: input.utterance.replyToMessageId,
    intent: input.utterance.intent,
    messages: normalizedMessages,
  });
  return {
    valid: true,
    normalized,
    violations: [],
    fallbackRequired: false,
    reason: null,
  };
}
