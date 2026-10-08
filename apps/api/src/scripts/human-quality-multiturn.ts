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
import { validateConversationNaturalness } from "../modules/conversation/conversation.dialogue-naturalness.js";
import { measureRecentRepetition } from "../modules/conversation/conversation.dialogue-repetition.js";
import type { DialogueIntent } from "../modules/conversation/conversation.dialogue.js";

type Turn = {
  readonly speaker: string;
  readonly content: string;
  readonly intent: DialogueIntent;
  readonly emotionTone: "NEUTRAL" | "PLAYFUL" | "TENSE" | "AFFECTIVE" | "SAD" | "EXCITED";
};

type Sequence = {
  readonly id: string;
  readonly affinity: number;
  readonly turns: readonly Turn[];
};

const SEQUENCES: Sequence[] = [
  {
    id: "smalltalk",
    affinity: 0.6,
    turns: [
      { speaker: "Alicya", content: "oi, tudo bem?", intent: "ANSWER", emotionTone: "NEUTRAL" },
      { speaker: "Alicya", content: "que semana corrida", intent: "REACTION", emotionTone: "NEUTRAL" },
      { speaker: "Alicya", content: "você treinou hoje?", intent: "ANSWER", emotionTone: "NEUTRAL" },
      { speaker: "Alicya", content: "kkk imaginei", intent: "REACTION", emotionTone: "PLAYFUL" },
      { speaker: "Alicya", content: "bom, vou nessa", intent: "REACTION", emotionTone: "NEUTRAL" },
    ],
  },
  {
    id: "support-close",
    affinity: 0.9,
    turns: [
      { speaker: "Alicya", content: "tô exausta", intent: "SUPPORT", emotionTone: "SAD" },
      { speaker: "Alicya", content: "não sei se dou conta dessa semana", intent: "SUPPORT", emotionTone: "TENSE" },
      { speaker: "Alicya", content: "obrigada por ouvir", intent: "SUPPORT", emotionTone: "AFFECTIVE" },
      { speaker: "Alicya", content: "e você, como tá?", intent: "ANSWER", emotionTone: "NEUTRAL" },
      { speaker: "Alicya", content: "vamos marcar algo", intent: "REACTION", emotionTone: "PLAYFUL" },
    ],
  },
  {
    id: "rival-tension",
    affinity: 0.2,
    turns: [
      { speaker: "Charles", content: "eu sou mais rápido que você", intent: "DISAGREE", emotionTone: "TENSE" },
      { speaker: "Charles", content: "prova domingo", intent: "TEASE", emotionTone: "TENSE" },
      { speaker: "Charles", content: "não vai dar conta", intent: "DISAGREE", emotionTone: "TENSE" },
      { speaker: "Charles", content: "tá com medo?", intent: "TEASE", emotionTone: "PLAYFUL" },
      { speaker: "Charles", content: "boa sorte então", intent: "CALLBACK", emotionTone: "NEUTRAL" },
    ],
  },
  {
    id: "memory-emotion",
    affinity: 0.85,
    turns: [
      { speaker: "Alicya", content: "lembrei daquela corrida", intent: "CALLBACK", emotionTone: "AFFECTIVE" },
      { speaker: "Alicya", content: "foi difícil", intent: "REACTION", emotionTone: "SAD" },
      { speaker: "Alicya", content: "mas valeu", intent: "REACTION", emotionTone: "AFFECTIVE" },
      { speaker: "Alicya", content: "o que você lembra?", intent: "ANSWER", emotionTone: "NEUTRAL" },
      { speaker: "Alicya", content: "bom demais", intent: "REACTION", emotionTone: "PLAYFUL" },
    ],
  },
];

const VOICE = { informality: 0.6, warmth: 0.5, humor: 0.5, emojiTendency: 0.4, verbosity: 0.3 };

function contextFor(input: {
  sequence: Sequence;
  turn: Turn;
  previous: readonly { speaker: string; content: string }[];
}): DialogueRealizerContext {
  const strategy = deriveDialogueResponseStrategy({
    intent: input.turn.intent,
    emotionTone: input.turn.emotionTone === "NEUTRAL" ? null : input.turn.emotionTone,
    voice: VOICE,
    replyToContent: input.turn.content,
    relationshipAffinity: input.sequence.affinity,
  });
  return buildDialogueRealizerContext({
    speakerCharacterId: "ai-kimi",
    speakerName: "Kimi",
    interlocutorName: input.turn.speaker,
    strategy,
    intent: input.turn.intent,
    replyToMessageId: "mt-1",
    replyToContent: input.turn.content,
    recentMessages: input.previous.slice(-3).map((entry) => ({
      speakerName: entry.speaker,
      content: entry.content,
    })),
    topic: null,
    emotionalTone: input.turn.emotionTone,
    relationshipAffinity: input.sequence.affinity,
    memorySummaries: [],
    voice: VOICE,
    maxMessages: 1,
    language: "pt-BR",
  });
}

async function runSequence(
  sequence: Sequence,
  realizer: DeterministicDialogueRealizer | LlmDialogueRealizer,
) {
  const outputs: string[] = [];
  const violations: string[] = [];
  let fallbacks = 0;
  let latencyMs = 0;
  const previous: { speaker: string; content: string }[] = [];
  for (const turn of sequence.turns) {
    const context = contextFor({ sequence, turn, previous });
    const started = performance.now();
    const utterance = await realizer.realize(context);
    latencyMs += Math.round(performance.now() - started);
    const text = utterance.messages.map((message) => message.text).join(" ");
    if (realizer instanceof LlmDialogueRealizer) {
      if (realizer.lastTrace?.fallback) fallbacks += 1;
    }
    violations.push(
      ...validateConversationNaturalness({
        text,
        replyToContent: context.replyToContent,
        emotionTone: context.emotion?.tone ?? null,
        emojiAllowed: context.strategy?.emojiMode !== "OFF",
        questionMode: context.strategy?.questionMode ?? null,
      }),
    );
    outputs.push(text);
    previous.push({ speaker: "Kimi", content: text });
  }
  const repetition = measureRecentRepetition(outputs.map((content) => ({ content })));
  return {
    outputs,
    violations,
    fallbacks,
    latencyMs,
    questionRate: outputs.filter((text) => text.trim().endsWith("?")).length / outputs.length,
    duplicateRate: repetition.duplicateRate,
    openingRate: repetition.openingRate,
    genericCount: outputs.filter((text) => isGenericText(text)).length,
  };
}

async function main(): Promise<void> {
  const model = process.env.OLLAMA_MODEL ?? "llama3.2";
  const provider = createOllamaDialogueRealizerProviderFromEnv({ model, timeoutMs: 60_000 });
  const deterministic = new DeterministicDialogueRealizer();
  const llm = provider ? new LlmDialogueRealizer(provider) : null;

  const results: Array<{ id: string; deterministic: unknown; llm: unknown }> = [];
  for (const sequence of SEQUENCES) {
    const det = await runSequence(sequence, deterministic);
    const llmResult = llm ? await runSequence(sequence, llm) : null;
    results.push({ id: sequence.id, deterministic: det, llm: llmResult });
  }

  const outDir = join(tmpdir(), "opencode", "f22-8-multiturn");
  await mkdir(outDir, { recursive: true });
  await writeFile(
    join(outDir, "multiturn.json"),
    JSON.stringify({ model: llm ? model : null, results }, null, 2),
    "utf8",
  );
  const lines = [`# F22.8 Multi-turn — ${llm ? model : "LLM não executado"}`, ""];
  for (const result of results) {
    lines.push(`## ${result.id}`);
    lines.push(`- deterministic: ${JSON.stringify(result.deterministic)}`);
    lines.push(`- llm: ${result.llm ? JSON.stringify(result.llm) : "não executado"}`);
    lines.push("");
  }
  await writeFile(join(outDir, "multiturn.md"), lines.join("\n"), "utf8");
  console.log(`F22.8 multi-turn — ${SEQUENCES.length} sequências`);
  for (const result of results) {
    console.log(`${result.id} deterministic: ${JSON.stringify(result.deterministic)}`);
    console.log(`${result.id} llm: ${result.llm ? JSON.stringify(result.llm) : "não executado"}`);
  }
  console.log(`artifacts: ${outDir}`);
}

await main();
