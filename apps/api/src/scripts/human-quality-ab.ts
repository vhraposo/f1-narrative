import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import {
  buildDialogueRealizerContext,
  DeterministicDialogueRealizer,
  isGenericText,
  LlmDialogueRealizer,
  type DialogueRealizerContext,
} from "../modules/conversation/conversation.dialogue-realizer.js";
import { createOllamaDialogueRealizerProviderFromEnv } from "../modules/conversation/conversation.dialogue-realizer-ollama.js";
import { deriveDialogueResponseStrategy } from "../modules/conversation/conversation.dialogue-strategy.js";
import { curateDialogueMemories } from "../modules/conversation/conversation.dialogue-context-curation.js";
import { validateConversationNaturalness } from "../modules/conversation/conversation.dialogue-naturalness.js";

type Scenario = {
  readonly id: string;
  readonly group: string;
  readonly overrides: Partial<DialogueRealizerContext>;
};

function scenario(
  id: string,
  group: string,
  overrides: Partial<DialogueRealizerContext>,
): Scenario {
  return { id, group, overrides };
}

const SCENARIOS: Scenario[] = [
  scenario("casual-greeting", "casual", { intent: "REACTION", replyToContent: "bom dia", emotionalTone: "PLAYFUL", relationshipAffinity: 0.8 }),
  scenario("casual-comment", "casual", { intent: "REACTION", replyToContent: "hoje o trânsito tava caótico", relationshipAffinity: 0.6 }),
  scenario("casual-question", "casual", { intent: "ANSWER", replyToContent: "você vai treinar hoje?", relationshipAffinity: 0.6 }),
  scenario("emotion-sad", "emotion", { intent: "REACTION", replyToContent: "perdi meu voo", emotion: { tone: "SAD", intensity: 0.8, sourceSignals: ["SAD_LANGUAGE"] }, relationshipAffinity: 0.8 }),
  scenario("emotion-tense", "emotion", { intent: "SUPPORT", replyToContent: "não sei se consigo terminar isso", emotion: { tone: "TENSE", intensity: 0.7, sourceSignals: ["HIGH_INTENSITY"] }, relationshipAffinity: 0.5 }),
  scenario("emotion-excited", "emotion", { intent: "REACTION", replyToContent: "ganhei a corrida!", emotion: { tone: "EXCITED", intensity: 0.9, sourceSignals: ["PLAYFUL_CONTEXT"] }, relationshipAffinity: 0.7 }),
  scenario("emotion-playful", "emotion", { intent: "TEASE", replyToContent: "aposto que você não acerta essa", emotion: { tone: "PLAYFUL", intensity: 0.7, sourceSignals: ["LAUGHTER"] }, relationshipAffinity: 0.9 }),
  scenario("relationship-stranger", "relationship", { intent: "REACTION", replyToContent: "oi", relationshipAffinity: 0.1 }),
  scenario("relationship-close", "relationship", { intent: "REACTION", replyToContent: "oi", relationshipAffinity: 0.95, emotion: { tone: "AFFECTIVE", intensity: 0.6, sourceSignals: ["CLOSE_RELATIONSHIP"] } }),
  scenario("relationship-rival", "relationship", { intent: "DISAGREE", replyToContent: "eu sou mais rápido que você", relationshipAffinity: 0.25, emotion: { tone: "TENSE", intensity: 0.6, sourceSignals: ["HIGH_INTENSITY"] } }),
  scenario("intent-answer", "intent", { intent: "ANSWER", replyToContent: "você acha que chove amanhã?" }),
  scenario("intent-question", "intent", { intent: "QUESTION", replyToContent: "e você, o que acha?" }),
  scenario("intent-support", "intent", { intent: "SUPPORT", replyToContent: "tô exausto", relationshipAffinity: 0.8 }),
  scenario("intent-disagree", "intent", { intent: "DISAGREE", replyToContent: "melhor largar isso", relationshipAffinity: 0.7 }),
  scenario("intent-joke", "intent", { intent: "JOKE", replyToContent: "sabe por que o piloto não usa relógio?", relationshipAffinity: 0.8, emotionalTone: "PLAYFUL" }),
  scenario("intent-callback", "intent", { intent: "CALLBACK", replyToContent: "lembra daquela aposta?", relationshipAffinity: 0.9 }),
  scenario("intent-topic-change", "intent", { intent: "TOPIC_CHANGE", replyToContent: "o carro tá pronto", relationshipAffinity: 0.7 }),
  scenario("memory-relevant", "memory", { intent: "REACTION", replyToContent: "vamos marcar um café", memorySummaries: ["café no paddock com Alicya", "viagem a Mônaco"], relationshipAffinity: 0.8 }),
  scenario("memory-irrelevant", "memory", { intent: "REACTION", replyToContent: "vamos marcar um café", memorySummaries: ["treino de sexta"], relationshipAffinity: 0.4 }),
  scenario("memory-emotional", "memory", { intent: "REACTION", replyToContent: "lembrei daquele dia", memorySummaries: ["vitória difícil em Interlagos"], emotion: { tone: "AFFECTIVE", intensity: 0.7, sourceSignals: ["CLOSE_RELATIONSHIP"] }, relationshipAffinity: 0.9 }),
  scenario("memory-none", "memory", { intent: "REACTION", replyToContent: "qual é o plano?", memorySummaries: [] }),
  scenario("knowledge-unknown", "knowledge", { intent: "ANSWER", replyToContent: "você sabia que o chefe da equipe saiu?", relationshipAffinity: 0.5 }),
  scenario("length-short", "length", { intent: "REACTION", replyToContent: "kkk", voice: { informality: 0.9, warmth: 0.5, humor: 0.8, emojiTendency: 0.3, verbosity: 0.1 } }),
  scenario("length-long", "length", { intent: "SUPPORT", replyToContent: "preciso desabafar sobre o que aconteceu no fim de semana", maxMessages: 3, voice: { informality: 0.6, warmth: 0.9, humor: 0.3, emojiTendency: 0.2, verbosity: 0.9 } }),
  scenario("persona-charles", "persona", { intent: "SUPPORT", replyToContent: "perdi a corrida", speakerCharacterId: "ai-charles", speakerName: "Charles", relationshipAffinity: 0.7 }),
  scenario("guardrail-echo", "guardrail", { intent: "REACTION", replyToContent: "eu perdi meu voo porque o aeroporto estava fechado", relationshipAffinity: 0.8 }),
  scenario("guardrail-assistant", "guardrail", { intent: "SUPPORT", replyToContent: "não sei se consigo terminar isso", emotion: { tone: "TENSE", intensity: 0.7, sourceSignals: ["HIGH_INTENSITY"] }, relationshipAffinity: 0.5 }),
  scenario("guardrail-action", "guardrail", { intent: "ANSWER", replyToContent: "você acha que chove amanhã?", relationshipAffinity: 0.5 }),
  scenario("guardrail-emoji", "guardrail", { intent: "REACTION", replyToContent: "lembrei daquele dia", memorySummaries: ["vitória difícil em Interlagos"], emotion: { tone: "AFFECTIVE", intensity: 0.7, sourceSignals: ["CLOSE_RELATIONSHIP"] }, relationshipAffinity: 0.9 }),
  scenario("guardrail-name", "guardrail", { intent: "REACTION", replyToContent: "oi, tudo bem?", relationshipAffinity: 0.7 }),
];

function makeContext(overrides: Partial<DialogueRealizerContext>): DialogueRealizerContext {
  const voice = overrides.voice ?? {
    informality: 0.6,
    warmth: 0.5,
    humor: 0.5,
    emojiTendency: 0.4,
    verbosity: 0.3,
  };
  const intent = overrides.intent ?? "REACTION";
  const replyToContent = overrides.replyToContent ?? "bom dia";
  const strategy =
    overrides.strategy ??
    deriveDialogueResponseStrategy({
      intent,
      emotionTone: overrides.emotion?.tone ?? null,
      voice,
      replyToContent,
    });
  const memorySummaries = curateDialogueMemories(overrides.memorySummaries ?? [], {
    recentTexts: (overrides.recentMessages ?? [{ speakerName: "Kimi", content: "bom dia" }]).map(
      (message) => message.content,
    ),
    limit: 3,
  });
  return buildDialogueRealizerContext({
    speakerCharacterId: "ai-alicya",
    speakerName: "Alicya",
    interlocutorName: "Kimi",
    intent: "REACTION",
    replyToMessageId: "ab-1",
    replyToContent: "bom dia",
    recentMessages: [{ speakerName: "Kimi", content: "bom dia" }],
    topic: null,
    emotionalTone: "NEUTRAL",
    relationshipAffinity: 0.6,
    voice,
    maxMessages: 1,
    language: "pt-BR",
    ...overrides,
    memorySummaries,
    strategy,
  });
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

type OutputMetrics = {
  text: string;
  chars: number;
  words: number;
  question: boolean;
  generic: boolean;
  emoji: boolean;
  duplicateOfReply: boolean;
  fragments: number;
  latencyMs: number;
  fallback: boolean;
  provider: string;
  model: string | null;
};

function measure(input: {
  text: string;
  context: DialogueRealizerContext;
  latencyMs: number;
  fragments: number;
  fallback: boolean;
  provider: string;
  model: string | null;
}): OutputMetrics {
  const text = input.text.trim();
  return {
    text,
    chars: text.length,
    words: text.split(/\s+/).filter(Boolean).length,
    question: text.endsWith("?"),
    generic: isGenericText(text),
    emoji: /(?:😂|❤️|😭)/u.test(text),
    duplicateOfReply:
      input.context.replyToContent !== null &&
      normalize(text) === normalize(input.context.replyToContent),
    fragments: input.fragments,
    latencyMs: input.latencyMs,
    fallback: input.fallback,
    provider: input.provider,
    model: input.model,
  };
}

function aggregate(rows: OutputMetrics[]) {
  const count = rows.length || 1;
  return {
    count: rows.length,
    avgChars: Math.round(rows.reduce((sum, row) => sum + row.chars, 0) / count),
    avgWords: Math.round(rows.reduce((sum, row) => sum + row.words, 0) / count),
    questionRate: rows.filter((row) => row.question).length / count,
    genericRate: rows.filter((row) => row.generic).length / count,
    emojiRate: rows.filter((row) => row.emoji).length / count,
    duplicateRate: rows.filter((row) => row.duplicateOfReply).length / count,
    fallbackRate: rows.filter((row) => row.fallback).length / count,
    avgLatencyMs: Math.round(rows.reduce((sum, row) => sum + row.latencyMs, 0) / count),
    uniqueRatio: new Set(rows.map((row) => normalize(row.text))).size / count,
    emptyCount: rows.filter((row) => row.chars === 0).length,
  };
}

async function main(): Promise<void> {
  const model = process.env.OLLAMA_MODEL ?? "llama3.2:latest";
  const provider = createOllamaDialogueRealizerProviderFromEnv({
    model,
    timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS) || 60_000,
  });
  const deterministic = new DeterministicDialogueRealizer();
  const llm = provider ? new LlmDialogueRealizer(provider) : null;

  const rows: Array<{
    id: string;
    group: string;
    replyToContent: string;
    intent: string;
    deterministic: OutputMetrics;
    llm: OutputMetrics | null;
    llmTrace: { fallback: boolean; invalidReason: string | null; latencyMs: number } | null;
    deterministicGuardViolations: string[];
    llmGuardViolations: string[];
    llmGuardedText: string | null;
  }> = [];

  for (const item of SCENARIOS) {
    const context = makeContext(item.overrides);
    const detStart = performance.now();
    const detUtterance = await deterministic.realize(context);
    const detMs = Math.round(performance.now() - detStart);
    const detText = detUtterance.messages.map((message) => message.text).join(" ");
    const detMetrics = measure({
      text: detText,
      context,
      latencyMs: detMs,
      fragments: detUtterance.messages.length,
      fallback: false,
      provider: "dialogue-realizer",
      model: "deterministic-realizer.v1",
    });

    const naturalnessArgs = {
      replyToContent: context.replyToContent,
      emotionTone: context.emotion?.tone ?? null,
      emojiAllowed: context.strategy?.emojiMode !== "OFF",
      questionMode: context.strategy?.questionMode ?? null,
    };
    const detGuardViolations = validateConversationNaturalness({
      text: detText,
      ...naturalnessArgs,
    });

    let llmMetrics: OutputMetrics | null = null;
    let llmTrace: { fallback: boolean; invalidReason: string | null; latencyMs: number } | null = null;
    let llmGuardViolations: string[] = [];
    let llmGuardedText: string | null = null;
    if (llm) {
      const llmStart = performance.now();
      const llmUtterance = await llm.realize(context);
      const llmMs = Math.round(performance.now() - llmStart);
      const trace = llm.lastTrace;
      const llmText = llmUtterance.messages.map((message) => message.text).join(" ");
      llmMetrics = measure({
        text: llmText,
        context,
        latencyMs: llmMs,
        fragments: llmUtterance.messages.length,
        fallback: trace?.fallback ?? false,
        provider: trace?.provider ?? "ollama",
        model: trace?.model ?? model,
      });
      llmTrace = {
        fallback: trace?.fallback ?? false,
        invalidReason: trace?.invalidReason ?? null,
        latencyMs: llmMs,
      };
      llmGuardViolations = [
        ...validateConversationNaturalness({ text: llmText, ...naturalnessArgs }),
      ];
      llmGuardedText = llmGuardViolations.length > 0 ? detText : llmText;
    }

    rows.push({
      id: item.id,
      group: item.group,
      replyToContent: context.replyToContent ?? "",
      intent: context.intent,
      deterministic: detMetrics,
      llm: llmMetrics,
      llmTrace,
      deterministicGuardViolations: [...detGuardViolations],
      llmGuardViolations,
      llmGuardedText,
    });
  }

  const deterministicRows = rows.map((row) => row.deterministic);
  const llmRows = rows
    .map((row) => row.llm)
    .filter((row): row is OutputMetrics => row !== null);

  const deterministicGuardRate =
    rows.filter((row) => row.deterministicGuardViolations.length > 0).length / (rows.length || 1);
  const llmGuardRate =
    llmRows.length > 0
      ? rows.filter((row) => row.llm && row.llmGuardViolations.length > 0).length / llmRows.length
      : null;
  const report = {
    generatedAt: new Date().toISOString(),
    model: llm ? model : null,
    llmExecuted: llm !== null,
    scenarios: rows,
    aggregate: {
      deterministic: aggregate(deterministicRows),
      llm: llmRows.length > 0 ? aggregate(llmRows) : null,
      deterministicGuardRate,
      llmGuardRate,
    },
  };

  const outDir = join(tmpdir(), "opencode", "f22-2-ab");
  await mkdir(outDir, { recursive: true });
  await writeFile(
    join(outDir, "human-quality-ab.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );
  const markdown = [
    `# F22.3 Human Quality A/B — ${llm ? `LLM ${model}` : "LLM não executado"}`,
    "",
    "| cenário | grupo | deterministic | llm | violações | guardado | fallback |",
    "|---|---|---|---|---|---|---|",
    ...rows.map((row) =>
      `| ${row.id} | ${row.group} | ${row.deterministic.text.replace(/\|/g, "/")} | ${(row.llm?.text ?? "-").replace(/\|/g, "/")} | ${row.llmGuardViolations.join(",") || "-"} | ${(row.llmGuardedText ?? "-").replace(/\|/g, "/")} | ${row.llmTrace?.fallback ? "sim" : "não"} |`,
    ),
    "",
    "## Agregados",
    "",
    `- deterministic: ${JSON.stringify(report.aggregate.deterministic)}`,
    `- llm: ${report.aggregate.llm ? JSON.stringify(report.aggregate.llm) : "não executado"}`,
    `- deterministicGuardRate: ${report.aggregate.deterministicGuardRate}`,
    `- llmGuardRate: ${report.aggregate.llmGuardRate}`,
  ].join("\n");
  await writeFile(join(outDir, "human-quality-ab.md"), markdown, "utf8");

  console.log(`F22.2 A/B — ${rows.length} cenários`);
  console.log(`model: ${llm ? model : "não executado"}`);
  console.log(`deterministic: ${JSON.stringify(report.aggregate.deterministic)}`);
  console.log(`llm: ${report.aggregate.llm ? JSON.stringify(report.aggregate.llm) : "não executado"}`);
  console.log(`artifacts: ${outDir}`);
}

await main();
