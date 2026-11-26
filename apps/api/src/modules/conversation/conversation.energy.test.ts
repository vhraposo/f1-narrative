import { describe, expect, it } from "vitest";

import { evaluateConversationEnergy, planResponseWindow } from "./conversation.energy.js";

describe("conversation.energy", () => {
  it("classifica saudação curta como NORMAL (baseline social)", () => {
    const energy = evaluateConversationEnergy({
      message: "bom dia",
      participantCount: 4,
      recentAiMessages: 0,
    });
    expect(energy.level).toBe("NORMAL");
    expect(energy.reasons).toContain("GREETING");
  });

  it("pergunta sobre corrida eleva energia para ACTIVE ou acima", () => {
    const energy = evaluateConversationEnergy({
      message: "Como foi a corrida de vocês hoje? Vi que a classificação mudou!",
      participantCount: 4,
      recentAiMessages: 2,
    });
    expect(["ACTIVE", "HIGHLY_ACTIVE"]).toContain(energy.level);
    expect(energy.reasons).toContain("QUESTION");
    expect(energy.reasons).toContain("TOPIC_F1");
  });

  it("mensagem intensa ganha intensidade e boost de janela", () => {
    const energy = evaluateConversationEnergy({
      message: "NÃO ACREDITO NISSO!! Que absurdo, estou com muita raiva!",
      participantCount: 3,
      recentAiMessages: 1,
    });
    expect(energy.intensity).toBeGreaterThanOrEqual(0.5);
    const window = planResponseWindow(energy, { budgetRemaining: 6 });
    expect(window.reasonCodes).toContain("INTENSITY_BOOST");
    expect(window.maxInitialResponders).toBeGreaterThanOrEqual(2);
  });

  it("respeita o orçamento restante como teto", () => {
    const energy = evaluateConversationEnergy({
      message: "Alguém viu o resultado do GP? Estou nervoso com a pole!",
      participantCount: 6,
      recentAiMessages: 4,
    });
    const window = planResponseWindow(energy, { budgetRemaining: 1 });
    expect(window.maxInitialResponders).toBeLessThanOrEqual(1);
    expect(window.maxChainDepth).toBeLessThanOrEqual(1);
  });

  it("janela QUIET exige score maior que HIGHLY_ACTIVE", () => {
    const quiet = planResponseWindow(
      evaluateConversationEnergy({ message: "oi", participantCount: 3, recentAiMessages: 0 }),
      { budgetRemaining: 8 },
    );
    const highly = planResponseWindow(
      evaluateConversationEnergy({
        message: "Que corrida incrível!! Alguém acredita nesse resultado?",
        participantCount: 6,
        recentAiMessages: 3,
      }),
      { budgetRemaining: 8 },
    );
    expect(quiet.stopThresholds.initial).toBeGreaterThan(highly.stopThresholds.initial);
    expect(quiet.maxInitialResponders).toBeLessThanOrEqual(highly.maxInitialResponders);
  });
});
