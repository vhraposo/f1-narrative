import { describe, expect, it } from "vitest";

import { evaluateConversationEnergy } from "./conversation.energy.js";
import { deriveDialogueEmotion, DialogueEmotionContextSchema } from "./conversation.dialogue-emotion.js";

function energyFor(message: string, recentAiMessages = 0) {
  return evaluateConversationEnergy({ message, participantCount: 4, recentAiMessages });
}

describe("F5.1 — emoção derivada do diálogo", () => {
  it("sem sinais suficientes retorna null", () => {
    const emotion = deriveDialogueEmotion({
      energy: energyFor("ok"),
      affinity: 0.4,
      recentMessages: [{ content: "certo" }],
    });
    expect(emotion).toBeNull();
  });

  it("risada produz tom PLAYFUL", () => {
    const emotion = deriveDialogueEmotion({
      energy: energyFor("KKKK vocês são impossíveis"),
      affinity: 0.4,
      recentMessages: [{ content: "KKKK vocês são impossíveis" }],
    });
    expect(emotion?.tone).toBe("PLAYFUL");
    expect(emotion?.sourceSignals).toContain("LAUGHTER");
  });

  it("alta intensidade produz tom TENSE", () => {
    const emotion = deriveDialogueEmotion({
      energy: energyFor("NÃO ACREDITO NISSO!! Que absurdo"),
      affinity: 0.4,
      recentMessages: [{ content: "eu odeio quando isso acontece" }],
    });
    expect(emotion?.tone).toBe("TENSE");
    expect(emotion?.sourceSignals).toContain("HIGH_INTENSITY");
  });

  it("linguagem triste produz tom SAD", () => {
    const emotion = deriveDialogueEmotion({
      energy: energyFor("tô muito triste hoje"),
      affinity: 0.4,
      recentMessages: [{ content: "tô muito triste hoje" }],
    });
    expect(emotion?.tone).toBe("SAD");
  });

  it("relação próxima com sinais produz AFFECTIVE por speaker", () => {
    const message = "bom dia amor";
    const close = deriveDialogueEmotion({
      energy: energyFor(message),
      affinity: 0.9,
      recentMessages: [{ content: message }],
    });
    const distant = deriveDialogueEmotion({
      energy: energyFor(message),
      affinity: 0.1,
      recentMessages: [{ content: message }],
    });
    expect(close?.tone).toBe("AFFECTIVE");
    expect(distant?.tone).toBe("PLAYFUL");
    expect(close?.tone).not.toBe(distant?.tone);
  });

  it("intensity fica no intervalo 0..1 e sinais limitados a 4", () => {
    const emotion = deriveDialogueEmotion({
      energy: energyFor("NÃO ACREDITO NISSO!! KKKK absurdo, tô triste e nervoso"),
      affinity: 0.9,
      recentMessages: [{ content: "KKKK que absurdo, tô triste e nervoso" }],
    });
    expect(emotion).not.toBeNull();
    expect(emotion!.intensity).toBeGreaterThanOrEqual(0);
    expect(emotion!.intensity).toBeLessThanOrEqual(1);
    expect(emotion!.sourceSignals.length).toBeLessThanOrEqual(4);
    expect(DialogueEmotionContextSchema.safeParse(emotion).success).toBe(true);
  });

  it("deterministic replay: mesmos sinais, mesma emoção", () => {
    const input = {
      energy: energyFor("bom dia amigos"),
      affinity: 0.8,
      recentMessages: [{ content: "bom dia amigos" }],
    };
    expect(deriveDialogueEmotion(input)).toEqual(deriveDialogueEmotion(input));
  });

  it("contexto é pequeno e sem campos extras", () => {
    const emotion = deriveDialogueEmotion({
      energy: energyFor("bom dia"),
      affinity: 0.9,
      recentMessages: [{ content: "bom dia" }],
    });
    expect(Object.keys(emotion!).sort()).toEqual(["intensity", "sourceSignals", "tone"]);
  });
});
