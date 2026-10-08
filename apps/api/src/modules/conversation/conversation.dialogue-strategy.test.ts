import { describe, expect, it } from "vitest";

import {
  buildDialogueRealizerContext,
  DeterministicDialogueRealizer,
  type DialogueRealizerContext,
} from "./conversation.dialogue-realizer.js";
import { deriveDialogueResponseStrategy } from "./conversation.dialogue-strategy.js";

const VOICE = {
  informality: 0.6,
  warmth: 0.5,
  humor: 0.5,
  emojiTendency: 0.4,
  verbosity: 0.3,
};

function strategyFor(overrides: {
  intent: Parameters<typeof deriveDialogueResponseStrategy>[0]["intent"];
  emotionTone?: Parameters<typeof deriveDialogueResponseStrategy>[0]["emotionTone"];
  voice?: Partial<typeof VOICE>;
  replyToContent?: string | null;
}) {
  return deriveDialogueResponseStrategy({
    intent: overrides.intent,
    emotionTone: overrides.emotionTone ?? null,
    voice: { ...VOICE, ...overrides.voice },
    replyToContent: overrides.replyToContent ?? null,
  });
}

function realizerContext(overrides: Partial<DialogueRealizerContext> = {}): DialogueRealizerContext {
  return buildDialogueRealizerContext({
    speakerCharacterId: "ai-kimi",
    speakerName: "Kimi",
    interlocutorName: "Alicya",
    strategy: strategyFor({ intent: "REACTION" }),
    intent: "REACTION",
    replyToMessageId: "m-1",
    replyToContent: "oi",
    recentMessages: [{ speakerName: "Alicya", content: "oi" }],
    topic: null,
    emotionalTone: "NEUTRAL",
    relationshipAffinity: 0.8,
    memorySummaries: [],
    voice: VOICE,
    maxMessages: 1,
    language: "pt-BR",
    ...overrides,
  });
}

describe("F22.3 — DialogueResponseStrategy (efêmera e determinística)", () => {
  it("questionMode: REQUIRED para QUESTION/FOLLOW_UP, FORBIDDEN para JOKE/INTERRUPTION", () => {
    expect(strategyFor({ intent: "QUESTION" }).questionMode).toBe("REQUIRED");
    expect(strategyFor({ intent: "FOLLOW_UP" }).questionMode).toBe("REQUIRED");
    expect(strategyFor({ intent: "JOKE" }).questionMode).toBe("FORBIDDEN");
    expect(strategyFor({ intent: "INTERRUPTION" }).questionMode).toBe("FORBIDDEN");
    expect(strategyFor({ intent: "REACTION" }).questionMode).toBe("OPTIONAL");
  });

  it("emojiMode OFF em SAD/TENSE e OPTIONAL nos demais tons", () => {
    expect(strategyFor({ intent: "REACTION", emotionTone: "SAD" }).emojiMode).toBe("OFF");
    expect(strategyFor({ intent: "REACTION", emotionTone: "TENSE" }).emojiMode).toBe("OFF");
    expect(strategyFor({ intent: "REACTION", emotionTone: "PLAYFUL" }).emojiMode).toBe("OPTIONAL");
  });

  it("lengthMode responde a intent, verbosidade e tamanho do reply", () => {
    expect(strategyFor({ intent: "REACTION" }).lengthMode).toBe("SHORT");
    expect(strategyFor({ intent: "SUPPORT", voice: { verbosity: 0.9 } }).lengthMode).toBe(
      "EXPANSIVE",
    );
    expect(strategyFor({ intent: "ANSWER", replyToContent: "oi" }).lengthMode).toBe("SHORT");
    expect(
      strategyFor({
        intent: "ANSWER",
        voice: { verbosity: 0.6 },
        replyToContent: "pergunta longa sobre o treino",
      }).lengthMode,
    ).toBe("NORMAL");
  });

  it("echoMode LIMITED apenas onde citar é aceitável; sem autoridade de domínio", () => {
    expect(strategyFor({ intent: "QUESTION" }).echoMode).toBe("LIMITED");
    expect(strategyFor({ intent: "REACTION" }).echoMode).toBe("FORBIDDEN");
    const strategy = strategyFor({ intent: "REACTION" });
    expect(strategy.nameMode).toBe("KNOWN_ONLY");
    expect(strategy.actionClaimMode).toBe("FORBIDDEN");
  });

  it("mesma entrada produz exatamente a mesma estratégia", () => {
    const first = strategyFor({ intent: "SUPPORT", emotionTone: "TENSE" });
    const second = strategyFor({ intent: "SUPPORT", emotionTone: "TENSE" });
    expect(first).toEqual(second);
  });
});

describe("F22.3 — deterministic realizer respeita a estratégia", () => {
  const realizer = new DeterministicDialogueRealizer();

  it("questionMode FORBIDDEN remove perguntas do pool", async () => {
    const utterance = await realizer.realize(
      realizerContext({
        intent: "JOKE",
        strategy: strategyFor({ intent: "JOKE" }),
        voice: { ...VOICE, emojiTendency: 1 },
        relationshipAffinity: 0.9,
      }),
    );
    expect(utterance.messages[0]!.text.endsWith("?")).toBe(false);
  });

  it("emojiMode OFF suprime emoji mesmo com voz calorosa", async () => {
    const utterance = await realizer.realize(
      realizerContext({
        intent: "REACTION",
        strategy: strategyFor({ intent: "REACTION", emotionTone: "SAD" }),
        voice: { ...VOICE, emojiTendency: 1 },
        relationshipAffinity: 0.9,
      }),
    );
    expect(/(?:😂|❤️|😭)/u.test(utterance.messages[0]!.text)).toBe(false);
  });

  it("lengthMode SHORT prefere frase curta", async () => {
    const utterance = await realizer.realize(
      realizerContext({
        intent: "SUPPORT",
        strategy: strategyFor({ intent: "SUPPORT" }),
      }),
    );
    expect(utterance.messages[0]!.text.length).toBeLessThanOrEqual(40);
  });
});
