import { describe, expect, it } from "vitest";

import {
  describeRelationshipAffinity,
  describeVoiceStyle,
} from "./conversation.dialogue-persona.js";

const BASE_VOICE = {
  informality: 0.6,
  warmth: 0.5,
  humor: 0.5,
  emojiTendency: 0.4,
  verbosity: 0.3,
};

describe("F22.5 — projeção determinística de relação e estilo", () => {
  it("rotula afinidade em distante/neutra/próxima", () => {
    expect(describeRelationshipAffinity(0.1)).toBe("distante");
    expect(describeRelationshipAffinity(0.5)).toBe("neutra");
    expect(describeRelationshipAffinity(0.9)).toBe("próxima");
    expect(describeRelationshipAffinity(null)).toBeNull();
    expect(describeRelationshipAffinity(Number.NaN)).toBeNull();
  });

  it("projeta estilo a partir da voz existente sem inventar eixos", () => {
    expect(describeVoiceStyle(BASE_VOICE)).toBe("informal, conciso");
    expect(
      describeVoiceStyle({ ...BASE_VOICE, informality: 0.9, warmth: 0.8, humor: 0.9 }),
    ).toBe("informal, caloroso, bem-humorado, conciso");
    expect(
      describeVoiceStyle({ ...BASE_VOICE, informality: 0.2, warmth: 0.1, verbosity: 0.9 }),
    ).toBe("formal, seco, expansivo");
  });

  it("mesma entrada produz o mesmo rótulo (determinístico)", () => {
    expect(describeRelationshipAffinity(0.75)).toBe(describeRelationshipAffinity(0.75));
    expect(describeVoiceStyle(BASE_VOICE)).toBe(describeVoiceStyle(BASE_VOICE));
  });
});
