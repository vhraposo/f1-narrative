import { describe, expect, it } from "vitest";

import {
  buildDialogueRealizerContext,
  DeterministicDialogueRealizer,
  INTENT_REALIZATION_POLICY,
  type DialogueRealizerContext,
} from "./conversation.dialogue-realizer.js";
import { measureRecentRepetition } from "./conversation.dialogue-repetition.js";

function context(overrides: Partial<DialogueRealizerContext> = {}): DialogueRealizerContext {
  return buildDialogueRealizerContext({
    speakerCharacterId: "ai-kimi",
    speakerName: "Kimi",
    interlocutorName: "Alicya",
    intent: "REACTION",
    replyToMessageId: "m-1",
    replyToContent: "oi",
    recentMessages: [{ speakerName: "Alicya", content: "bom dia" }],
    topic: null,
    emotionalTone: "NEUTRAL",
    relationshipAffinity: 0.8,
    memorySummaries: [],
    voice: { informality: 0.6, warmth: 0.5, humor: 0.5, emojiTendency: 0, verbosity: 0.3 },
    maxMessages: 1,
    language: "pt-BR",
    ...overrides,
  });
}

describe("F22.6 — anti-repetição e métricas", () => {
  const realizer = new DeterministicDialogueRealizer();

  it("evita repetir a mesma frase presente no histórico recente", async () => {
    const first = await realizer.realize(context());
    const repeated = first.messages[0]!.text;
    const second = await realizer.realize(
      context({
        recentMessages: [
          { speakerName: "Alicya", content: "bom dia" },
          { speakerName: "Kimi", content: repeated },
        ],
      }),
    );
    expect(second.messages[0]!.text).not.toBe(repeated);
    expect(INTENT_REALIZATION_POLICY.REACTION.phrases).toContain(second.messages[0]!.text);
  });

  it("mantém replay determinístico quando não há repetição", async () => {
    const first = await realizer.realize(context());
    const second = await realizer.realize(context());
    expect(first).toEqual(second);
  });

  it("mede duplicatas e aberturas repetidas", () => {
    const metrics = measureRecentRepetition([
      { content: "Ah, que isso" },
      { content: "Ah, que isso" },
      { content: "Ah, legal" },
      { content: "bom dia" },
    ]);
    expect(metrics.count).toBe(4);
    expect(metrics.duplicateRate).toBeGreaterThan(0);
    expect(metrics.openingRate).toBeGreaterThan(0);
  });

  it("métricas vazias são zero", () => {
    expect(measureRecentRepetition([])).toEqual({ count: 0, duplicateRate: 0, openingRate: 0 });
  });
});
