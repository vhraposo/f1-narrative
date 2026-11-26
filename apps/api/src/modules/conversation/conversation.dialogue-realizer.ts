import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import { z } from "zod";

import {
  DialogueIntentSchema,
  DialogueUtteranceSchema,
  type DialogueIntent,
  type DialogueUtterance,
} from "./conversation.dialogue.js";
import { DialogueEmotionContextSchema } from "./conversation.dialogue-emotion.js";
import { DialogueTopicContextSchema } from "./conversation.dialogue-topic.js";
import { DialogueMemoryContextSchema } from "./conversation.dialogue-memory.js";
import { DialogueKnowledgeContextSchema } from "./conversation.dialogue-context.js";
import { DialogueResponseStrategySchema } from "./conversation.dialogue-strategy.js";

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
  interlocutorName: z.string().min(1).nullable().optional().default(null),
  strategy: DialogueResponseStrategySchema.nullable().optional().default(null),
  intent: DialogueIntentSchema,
  replyToMessageId: z.string().nullable(),
  replyToContent: z.string().nullable(),
  recentMessages: z.array(RealizerRecentMessageSchema).max(6),
  topic: z.string().nullable(),
  topicContext: DialogueTopicContextSchema.nullable().optional().default(null),
  memoryContext: DialogueMemoryContextSchema.nullable().optional().default(null),
  knowledgeContext: DialogueKnowledgeContextSchema.nullable().optional().default(null),
  emotionalTone: z.string().nullable(),
  emotion: DialogueEmotionContextSchema.nullable().optional().default(null),
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
  readonly lastTrace?: RealizerTrace | null;
  realize(context: DialogueRealizerContext): Promise<DialogueUtterance>;
}

export function realizerLanguageMetadata(
  trace: RealizerTrace | null | undefined,
): { provider: string; model: string; fallback: boolean } | null {
  if (!trace) return null;
  return {
    provider: trace.provider,
    model: trace.model ?? "unknown",
    fallback: trace.fallback,
  };
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
  readonly greetingPhrases?: readonly string[];
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
    questionPhrases: ["Boa pergunta.", "Pode ser.", "Sei lá, depende.", "Difícil dizer."],
    greetingPhrases: ["oi", "bom dia", "e aí", "olá", "opa"],
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
    greetingPhrases: ["oi", "bom dia", "e aí", "olá", "opa"],
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
    greetingPhrases: ["oi, bom dia", "bom dia", "oi", "e aí", "olá"],
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

function normalizeForRepeat(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
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

function isLowEnergyTone(context: DialogueRealizerContext): boolean {
  const tone = context.emotion?.tone;
  return tone === "SAD" || tone === "TENSE";
}

function pickPhrase(context: DialogueRealizerContext, policy: IntentRealizationPolicy): string {
  const affinity = context.relationshipAffinity;
  const lowAffinity = affinity !== null && affinity <= 0.3;
  const reply = context.replyToContent ?? "";
  const isGreeting = /^\s*(bom dia|boa tarde|boa noite|oi|ol[aá]|e a[íi]|eai|opa)\b/i.test(reply);
  const hasQuestion = reply.includes("?");
  let pool = policy.phrases;
  if (isGreeting && !lowAffinity && !isLowEnergyTone(context) && policy.greetingPhrases) {
    pool = policy.greetingPhrases;
  } else if (hasQuestion && policy.questionPhrases) {
    pool = policy.questionPhrases;
  } else if ((lowAffinity || isLowEnergyTone(context)) && policy.neutralPhrases) {
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
  if (context.strategy?.questionMode === "FORBIDDEN") {
    const withoutQuestions = pool.filter((phrase) => !phrase.trim().endsWith("?"));
    if (withoutQuestions.length > 0) pool = withoutQuestions;
  }
  const index = (seededIndex(seed, pool.length) + voiceBucket(context.voice.informality)) % pool.length;
  let candidate = pool[index] ?? pool[0] ?? "";
  const recent = new Set(context.recentMessages.map((message) => normalizeForRepeat(message.content)));
  if (recent.size > 0 && recent.has(normalizeForRepeat(candidate))) {
    for (let step = 1; step < pool.length; step += 1) {
      const alternative = pool[(index + step) % pool.length] ?? candidate;
      if (!recent.has(normalizeForRepeat(alternative))) {
        candidate = alternative;
        break;
      }
    }
  }
  if (candidate.length <= policy.maxChars) {
    if (context.strategy?.lengthMode === "SHORT" && candidate.length > 40) {
      return [...pool].sort((a, b) => a.length - b.length)[0] ?? candidate;
    }
    return candidate;
  }
  return [...pool].sort((a, b) => a.length - b.length)[0] ?? candidate;
}

function applyVoice(text: string, context: DialogueRealizerContext): string {
  const affinity = context.relationshipAffinity;
  const emojiAllowed =
    context.voice.emojiTendency >= 0.6 ||
    (affinity !== null && affinity >= 0.7 && context.voice.emojiTendency >= 0.3);
  if (!emojiAllowed || isLowEnergyTone(context) || context.strategy?.emojiMode === "OFF") {
    return text;
  }
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

export type DialogueRealizerKind = "off" | "deterministic" | "llm";

export function resolveDialogueRealizerKind(
  value: string | undefined = process.env.DIALOGUE_REALIZER,
): DialogueRealizerKind {
  if (value === "llm") return "llm";
  if (value === "off") return "off";
  return "deterministic";
}

export type RealizerTrace = {
  readonly realizerKind: "llm";
  readonly provider: string;
  readonly model: string | null;
  readonly latencyMs: number;
  readonly valid: boolean;
  readonly fallback: boolean;
  readonly invalidReason: string | null;
};

export class LlmDialogueRealizer implements DialogueRealizer {
  readonly kind = "llm" as const;
  private trace: RealizerTrace | null = null;
  private readonly deterministic = new DeterministicDialogueRealizer();

  constructor(private readonly provider: DialogueRealizerProvider) {}

  get lastTrace(): RealizerTrace | null {
    return this.trace;
  }

  async realize(context: DialogueRealizerContext): Promise<DialogueUtterance> {
    const started = performance.now();
    if (context.intent === "SILENCE") {
      const utterance = await this.deterministic.realize(context);
      this.trace = {
        realizerKind: "llm",
        provider: this.provider.name,
        model: this.provider.model ?? null,
        latencyMs: Math.round(performance.now() - started),
        valid: true,
        fallback: false,
        invalidReason: null,
      };
      return utterance;
    }
    try {
      const raw = await this.provider.realize(context);
      const validation = validateRealizerResult(raw, {
        speakerCharacterId: context.speakerCharacterId,
        intent: context.intent,
        replyToMessageId: context.replyToMessageId,
        maxMessages: context.maxMessages,
      });
      if (!validation.valid) {
        return this.fallback(context, validation.errors[0] ?? "INVALID_OUTPUT", started);
      }
      this.trace = {
        realizerKind: "llm",
        provider: this.provider.name,
        model: this.provider.model ?? null,
        latencyMs: Math.round(performance.now() - started),
        valid: true,
        fallback: false,
        invalidReason: null,
      };
      return raw as DialogueUtterance;
    } catch {
      return this.fallback(context, "PROVIDER_ERROR", started);
    }
  }

  private async fallback(
    context: DialogueRealizerContext,
    reason: string,
    started: number,
  ): Promise<DialogueUtterance> {
    const utterance = await this.deterministic.realize(context);
    this.trace = {
      realizerKind: "llm",
      provider: this.provider.name,
      model: this.provider.model ?? null,
      latencyMs: Math.round(performance.now() - started),
      valid: false,
      fallback: true,
      invalidReason: reason,
    };
    return utterance;
  }
}

export function createDialogueRealizer(
  kind: DialogueRealizerKind,
  provider?: DialogueRealizerProvider,
): DialogueRealizer {
  if (kind === "llm" && provider) return new LlmDialogueRealizer(provider);
  return new DeterministicDialogueRealizer();
}
