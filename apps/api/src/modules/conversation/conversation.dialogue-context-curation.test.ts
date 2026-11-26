import { describe, expect, it } from "vitest";

import {
  buildDialogueRealizerContext,
} from "./conversation.dialogue-realizer.js";
import {
  curateDialogueMemories,
  measureDialogueContextBudget,
  normalizeContextText,
} from "./conversation.dialogue-context-curation.js";

describe("F22.4 — curadoria de contexto e memória", () => {
  it("normaliza para comparação sem acento/caixa", () => {
    expect(normalizeContextText("  Vitória  Difícil ")).toBe("vitoria dificil");
  });

  it("remove vazias, duplicadas e memórias iguais a mensagens recentes", () => {
    const curated = curateDialogueMemories(
      [" café ", "CAFÉ", "", "treino", "viagem"],
      { recentTexts: ["viagem"], limit: 3 },
    );
    expect(curated).toEqual(["café", "treino"]);
  });

  it("respeita o limite de memórias", () => {
    const curated = curateDialogueMemories(["a", "b", "c", "d"], {
      recentTexts: [],
      limit: 2,
    });
    expect(curated).toEqual(["a", "b"]);
  });

  it("mede o orçamento de contexto do realizer", () => {
    const context = buildDialogueRealizerContext({
      speakerCharacterId: "ai-kimi",
      speakerName: "Kimi",
      interlocutorName: "Alicya",
      intent: "REACTION",
      replyToMessageId: "m-1",
      replyToContent: "bom dia",
      recentMessages: [{ speakerName: "Alicya", content: "bom dia" }],
      topic: "clima",
      emotionalTone: "NEUTRAL",
      relationshipAffinity: 0.7,
      memorySummaries: ["café no paddock"],
      voice: { informality: 0.6, warmth: 0.5, humor: 0.5, emojiTendency: 0.4, verbosity: 0.3 },
      maxMessages: 1,
      language: "pt-BR",
    });
    const budget = measureDialogueContextBudget(context);
    expect(budget.memories).toBe(1);
    expect(budget.recentMessages).toBe(1);
    expect(budget.chars).toBeGreaterThan(0);
    expect(budget.components).toBeGreaterThanOrEqual(5);
  });
});
