import { describe, expect, it } from "vitest";

import type { DialogueIntent } from "./conversation.dialogue.js";
import {
  buildDialogueRealizerContext,
  DeterministicDialogueRealizer,
  INTENT_REALIZATION_POLICY,
  isGenericText,
  type DialogueRealizerContext,
} from "./conversation.dialogue-realizer.js";

const realizer = new DeterministicDialogueRealizer();

const INTENTS: DialogueIntent[] = [
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
];

function context(overrides: Partial<DialogueRealizerContext> = {}): DialogueRealizerContext {
  return buildDialogueRealizerContext({
    speakerCharacterId: "ai-alicya",
    speakerName: "Alicya",
    intent: "REACTION",
    replyToMessageId: "m-1",
    replyToContent: "falamos depois",
    recentMessages: [{ speakerName: "Kimi", content: "falamos depois" }],
    topic: null,
    emotionalTone: "NEUTRAL",
    relationshipAffinity: 0.6,
    memorySummaries: [],
    voice: { informality: 0.6, warmth: 0.5, humor: 0.5, emojiTendency: 0.5, verbosity: 0.3 },
    maxMessages: 1,
    language: "pt-BR",
    ...overrides,
  });
}

async function textFor(
  intent: DialogueIntent,
  overrides: Partial<DialogueRealizerContext> = {},
): Promise<string> {
  const utterance = await realizer.realize(context({ intent, ...overrides }));
  return utterance.messages.map((message) => message.text).join(" ");
}

describe("F22 baseline — qualidade conversacional determinística", () => {
  it("question rate fica em banda explícita e perguntas vêm dos intents de pergunta", async () => {
    const asked: DialogueIntent[] = [];
    for (const intent of INTENTS) {
      if ((await textFor(intent)).endsWith("?")) asked.push(intent);
    }
    expect(asked).toContain("QUESTION");
    expect(asked).toContain("FOLLOW_UP");
    expect(asked).not.toContain("INTERRUPTION");
    const rate = asked.length / INTENTS.length;
    expect(rate).toBeGreaterThanOrEqual(0.1);
    expect(rate).toBeLessThanOrEqual(0.5);
  });

  it("tamanho varia entre intents e nunca excede a política", async () => {
    const lengths: number[] = [];
    for (const intent of INTENTS) {
      const text = await textFor(intent);
      expect(text.length).toBeLessThanOrEqual(INTENT_REALIZATION_POLICY[intent].maxChars);
      lengths.push(text.length);
    }
    const spread = Math.max(...lengths) - Math.min(...lengths);
    expect(spread).toBeGreaterThanOrEqual(20);
  });

  it("seeds diferentes produzem respostas diferentes (diversidade estrutural)", async () => {
    const outputs = new Set<string>();
    for (let index = 0; index < 6; index += 1) {
      outputs.add(
        await textFor("REACTION", {
          replyToMessageId: `m-${index}`,
          replyToContent: `assunto ${index}`,
        }),
      );
    }
    expect(outputs.size).toBeGreaterThanOrEqual(3);
  });

  it("personagens diferentes não soam idênticos no mesmo contexto", async () => {
    const outputs = new Set<string>();
    for (const speaker of ["ai-alicya", "ai-kimi", "ai-charles"]) {
      outputs.add(await textFor("SUPPORT", { speakerCharacterId: speaker }));
    }
    expect(outputs.size).toBeGreaterThanOrEqual(2);
  });

  it("tom SAD/TENSE evita risada e emoji mesmo com voz calorosa", async () => {
    const sad = await textFor("REACTION", {
      relationshipAffinity: 0.9,
      replyToContent: "oi",
      emotion: { tone: "SAD", intensity: 0.8, sourceSignals: ["SAD_LANGUAGE"] },
      voice: { informality: 0.6, warmth: 0.8, humor: 0.5, emojiTendency: 0.9, verbosity: 0.3 },
    });
    expect(INTENT_REALIZATION_POLICY.REACTION.neutralPhrases ?? []).toContain(sad);
    expect(/k{3,}|😂|❤️/iu.test(sad)).toBe(false);

    const tense = await textFor("SUPPORT", {
      emotion: { tone: "TENSE", intensity: 0.7, sourceSignals: ["HIGH_INTENSITY"] },
      voice: { informality: 0.5, warmth: 0.9, humor: 0.5, emojiTendency: 0.9, verbosity: 0.3 },
    });
    expect(INTENT_REALIZATION_POLICY.SUPPORT.neutralPhrases ?? []).toContain(tense);
    expect(tense).not.toContain("❤️");
  });

  it("nada de texto genérico/corporativo em nenhum intent ou tom", async () => {
    const tones = ["NEUTRAL", "PLAYFUL", "AFFECTIVE", "SAD", "TENSE", "EXCITED"] as const;
    for (const intent of INTENTS) {
      for (const tone of tones) {
        const text = await textFor(intent, {
          emotion: { tone, intensity: 0.6, sourceSignals: ["BASELINE"] },
        });
        expect(text.length).toBeGreaterThan(0);
        expect(isGenericText(text)).toBe(false);
      }
    }
  });

  it("replay determinístico permanece (mesmo contexto, mesmo texto)", async () => {
    const first = await textFor("SUPPORT", { maxMessages: 2 });
    const second = await textFor("SUPPORT", { maxMessages: 2 });
    expect(first).toBe(second);
  });

  it("saudação recebe resposta socialmente coerente (não 'ué'/'mds')", async () => {
    const text = await textFor("REACTION", { replyToContent: "ola" });
    expect(INTENT_REALIZATION_POLICY.REACTION.greetingPhrases ?? []).toContain(text);
    expect(["ué", "mds", "kkkk"]).not.toContain(text);
  });

  it("saudação de relação distante permanece neutra", async () => {
    const text = await textFor("REACTION", { replyToContent: "oi", relationshipAffinity: 0.1 });
    expect(INTENT_REALIZATION_POLICY.REACTION.neutralPhrases ?? []).toContain(text);
  });

  it("pergunta direta não recebe afirmação genérica", async () => {
    const text = await textFor("ANSWER", { replyToContent: "kimi voce é gay ?" });
    expect(INTENT_REALIZATION_POLICY.ANSWER.questionPhrases ?? []).toContain(text);
    expect(INTENT_REALIZATION_POLICY.ANSWER.phrases).not.toContain(text);
  });
});
