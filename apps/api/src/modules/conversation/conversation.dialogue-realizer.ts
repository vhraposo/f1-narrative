import { createHash } from "node:crypto";

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

type IntentRealizationPolicy = {
  readonly maxChars: number;
  readonly fragmentsAllowed: boolean;
  readonly phrases: readonly string[];
  readonly neutralPhrases?: readonly string[];
  readonly questionPhrases?: readonly string[];
};

export const INTENT_REALIZATION_POLICY: Record<DialogueIntent, IntentRealizationPolicy> = {
  ANSWER: {
    maxChars: 90,
    fragmentsAllowed: true,
    phrases: [
      "Sim, acho que vai ser por aí.",
      "Pode ser, mas não é garantido.",
      "Depende do dia, mas tô confiante.",
      "Acho que sim, vamos ver.",
      "Talvez, não dá pra cravar.",
    ],
    neutralPhrases: ["Acho que sim.", "Pode ser.", "Vamos ver.", "Provavelmente."],
  },
  QUESTION: {
    maxChars: 60,
    fragmentsAllowed: false,
    phrases: ["E você faria diferente?", "Você acha mesmo isso?", "Como assim?", "Sério? Por quê?"],
  },
  REACTION: {
    maxChars: 40,
    fragmentsAllowed: true,
    phrases: ["kkkk", "pior que sim", "nem fala", "ué", "sério isso?", "mds"],
    neutralPhrases: ["entendi", "ok", "certo", "tá"],
    questionPhrases: ["sei lá", "boa pergunta", "depende", "difícil dizer"],
  },
  JOKE: {
    maxChars: 60,
    fragmentsAllowed: true,
    phrases: [
      "kkkk você não presta",
      "olha o nível",
      "kkkk para",
      "essa foi boa",
      "kkkk impossível",
    ],
  },
  TEASE: {
    maxChars: 60,
    fragmentsAllowed: false,
    phrases: ["olha quem tá falando", "fala logo", "confia", "sei...", "tá com medo?"],
  },
  SUPPORT: {
    maxChars: 90,
    fragmentsAllowed: true,
    phrases: [
      "Relaxa, vai dar certo.",
      "Calma, isso passa.",
      "Tô contigo nessa.",
      "Vai ficar tudo bem.",
      "Respira, você dá conta.",
    ],
    neutralPhrases: ["Vai dar certo.", "Calma.", "Isso passa.", "Conte comigo."],
  },
  DISAGREE: {
    maxChars: 80,
    fragmentsAllowed: false,
    phrases: [
      "Não acho que seja assim.",
      "Discordo, mas tudo bem.",
      "Não concordo, sinceramente.",
      "Acho que não é bem isso.",
    ],
  },
  FOLLOW_UP: {
    maxChars: 60,
    fragmentsAllowed: false,
    phrases: ["Mas e depois?", "E aí, o que rolou?", "Como assim?", "E você, o que acha?"],
  },
  TOPIC_CHANGE: {
    maxChars: 70,
    fragmentsAllowed: false,
    phrases: ["Aliás, mudando de assunto...", "Gente, outra coisa.", "Mudando de papo...", "Ah, e outra coisa."],
  },
  INTERRUPTION: {
    maxChars: 30,
    fragmentsAllowed: false,
    phrases: ["pera", "não", "calma", "espera"],
  },
  CALLBACK: {
    maxChars: 90,
    fragmentsAllowed: true,
    phrases: [
      "ainda lembro disso",
      "não acredito que voltamos nisso",
      "isso de novo kkkk",
      "clássico",
    ],
  },
  SILENCE: {
    maxChars: 0,
    fragmentsAllowed: false,
    phrases: [],
  },
};

const GENERIC_PATTERNS: readonly RegExp[] = [
  /entendo perfeitamente/i,
  /excelente pergunta/i,
  /com certeza, vamos/i,
  /de fato,/i,
  /isso é muito interessante/i,
  /vamos analisar/i,
  /é importante ressaltar/i,
];

export function isGenericText(text: string): boolean {
  return GENERIC_PATTERNS.some((pattern) => pattern.test(text));
}

function seededIndex(seed: string, length: number): number {
  const digest = createHash("sha256").update(seed).digest();
  return digest.readUInt32BE(0) % Math.max(1, length);
}

function voiceBucket(informality: number): number {
  if (informality >= 0.66) return 2;
  if (informality >= 0.4) return 1;
  return 0;
}

function pickPhrase(context: DialogueRealizerContext, policy: IntentRealizationPolicy): string {
  const affinity = context.relationshipAffinity;
  const lowAffinity = affinity !== null && affinity <= 0.3;
  let pool = policy.phrases;
  if (context.intent === "REACTION" && context.replyToContent?.includes("?") && policy.questionPhrases) {
    pool = policy.questionPhrases;
  } else if (lowAffinity && policy.neutralPhrases) {
    pool = policy.neutralPhrases;
  }
  const seed = [
    context.speakerCharacterId,
    context.intent,
    context.replyToMessageId ?? "none",
    context.replyToContent ?? "",
    context.recentMessages[0]?.content ?? "",
    String(context.maxMessages),
  ].join(":");
  const index = (seededIndex(seed, pool.length) + voiceBucket(context.voice.informality)) % pool.length;
  const candidate = pool[index] ?? pool[0] ?? "";
  if (candidate.length <= policy.maxChars) return candidate;
  return [...pool].sort((a, b) => a.length - b.length)[0] ?? candidate;
}

function applyVoice(text: string, context: DialogueRealizerContext): string {
  const affinity = context.relationshipAffinity;
  const emojiAllowed =
    context.voice.emojiTendency >= 0.6 ||
    (affinity !== null && affinity >= 0.7 && context.voice.emojiTendency >= 0.3);
  if (!emojiAllowed) return text;
  if (/(?:😂|❤️|😭)/u.test(text)) return text;
  if (context.intent === "SUPPORT" && context.voice.warmth >= 0.6) return `${text} ❤️`;
  if (context.intent === "JOKE" || context.intent === "TEASE" || context.intent === "REACTION") {
    return `${text} 😂`;
  }
  return text;
}

function fragmentText(
  text: string,
  context: DialogueRealizerContext,
  policy: IntentRealizationPolicy,
): string[] {
  if (context.maxMessages === 1 || !policy.fragmentsAllowed) return [text];
  const laugh = /^(k{3,}|rs+|haha+)\s+(.+)$/i.exec(text);
  if (laugh) return [laugh[1]!, laugh[2]!];
  if (context.voice.verbosity >= 0.7) {
    const split = text.indexOf(". ");
    if (split > 0) return [text.slice(0, split + 1), text.slice(split + 2)];
  }
  return [text];
}

export class DeterministicDialogueRealizer implements DialogueRealizer {
  readonly kind = "deterministic" as const;

  async realize(context: DialogueRealizerContext): Promise<DialogueUtterance> {
    if (context.intent === "SILENCE") {
      return {
        speakerCharacterId: context.speakerCharacterId,
        replyToMessageId: context.replyToMessageId,
        intent: context.intent,
        messages: [],
      };
    }
    const policy = INTENT_REALIZATION_POLICY[context.intent];
    const phrase = applyVoice(pickPhrase(context, policy), context);
    const fragments = fragmentText(phrase, context, policy).slice(0, context.maxMessages);
    return {
      speakerCharacterId: context.speakerCharacterId,
      replyToMessageId: context.replyToMessageId,
      intent: context.intent,
      messages: fragments.map((text, index) => ({ text, fragmentIndex: index })),
    };
  }
}
