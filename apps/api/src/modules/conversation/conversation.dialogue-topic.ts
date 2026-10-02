import { z } from "zod";

export const DIALOGUE_TOPIC_TAGS = [
  "qualifying",
  "race",
  "team",
  "weather",
  "joke",
  "support",
  "conflict",
  "callback",
  "personal",
] as const;

export const DialogueTopicTagSchema = z.enum(DIALOGUE_TOPIC_TAGS);
export type DialogueTopicTag = z.infer<typeof DialogueTopicTagSchema>;

export const DialogueTopicContextSchema = z.object({
  topicTag: DialogueTopicTagSchema.nullable(),
  confidence: z.number().min(0).max(1),
  previousTopic: DialogueTopicTagSchema.nullable(),
  changed: z.boolean(),
  sourceSignals: z.array(z.string()).max(4),
});
export type DialogueTopicContext = z.infer<typeof DialogueTopicContextSchema>;

const TOPIC_PATTERNS: ReadonlyArray<{
  readonly tag: DialogueTopicTag;
  readonly pattern: RegExp;
  readonly signal: string;
}> = [
  { tag: "qualifying", pattern: /\b(qualifica\w*|classifica\w*|pole|grid)\b/, signal: "QUALIFYING_KEYWORDS" },
  { tag: "race", pattern: /\b(corrida|gp|grande premio|podium|podio|volta|resultado|bandeira)\b/, signal: "RACE_KEYWORDS" },
  { tag: "team", pattern: /\b(equipe|time|carro|motor|box|pit)\b/, signal: "TEAM_KEYWORDS" },
  { tag: "weather", pattern: /\b(chuva|molhado|seco|clima|pista)\b/, signal: "WEATHER_KEYWORDS" },
  { tag: "joke", pattern: /\b(kkk+|rsrs+|haha+|piada|zoeira)\b/, signal: "JOKE_KEYWORDS" },
  { tag: "support", pattern: /\b(nervos|triste|ajuda|calma|relaxa|desabafa)\b/, signal: "SUPPORT_KEYWORDS" },
  { tag: "conflict", pattern: /\b(odeio|raiva|briga|discussao|absurdo)\b/, signal: "CONFLICT_KEYWORDS" },
  { tag: "callback", pattern: /\b(lembra|aquela vez|de novo|bomba|chuveiro)\b/, signal: "CALLBACK_KEYWORDS" },
  { tag: "personal", pattern: /\b(amor|saudade|familia|casa|aniversario|viagem)\b/, signal: "PERSONAL_KEYWORDS" },
];

export function deriveDialogueTopic(input: {
  readonly messages: readonly { readonly content: string }[];
  readonly previousTopic?: DialogueTopicTag | null;
}): DialogueTopicContext | null {
  const normalized = input.messages
    .map((message) => message.content)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (normalized.trim().length === 0) return null;
  const hits = TOPIC_PATTERNS.filter((entry) => entry.pattern.test(normalized));
  if (hits.length === 0) return null;
  const topicTag = hits[0]!.tag;
  const previousTopic = input.previousTopic ?? null;
  return {
    topicTag,
    confidence: Math.min(1, 0.4 + hits.length * 0.2),
    previousTopic,
    changed: previousTopic !== null && previousTopic !== topicTag,
    sourceSignals: hits.slice(0, 4).map((entry) => entry.signal),
  };
}
