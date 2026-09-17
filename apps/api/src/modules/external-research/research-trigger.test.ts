import { describe, expect, it } from "vitest";

import {
  formulateResearchQuery,
  RESEARCH_TRIGGER_DEFAULT_CONFIG,
  RESEARCH_TRIGGER_RULE,
  RESEARCH_TRIGGER_VERSION,
  shouldResearch,
  type ResearchTriggerInternalContext,
} from "./research-trigger.js";

const DEEP_FIXED_CONTEXT: ResearchTriggerInternalContext = {
  participants: [
    { name: "Alicya Vasser", dna: { team: "Golconda", persona: ["focused", "speedy"] }, biography: "Piloto principal da Golconda. Débutou na temporada passada." },
    { name: "Hamilton", dna: { team: "Mercedes" }, biography: "Piloto multicampeão." },
  ],
  memories: [{ content: "Alicya venceu o GP de Mônaco na rodada anterior." }],
  events: [
    { title: "GP de Mônaco", description: "Encerrado. Alicya terminou em primeiro." },
  ],
  relationships: [{ characterAName: "Alicya Vasser", characterBName: "Hamilton" }],
  recentMessages: [{ content: "Sua equipe confirmou o novo desenho de duto de freios para o GP seguinte." }],
  worldState: {
    worldDate: "2026-09-16",
    currentSeasonId: "season-2026",
    currentRaceId: "race-7",
    raceNames: ["Grande Prêmio de Mônaco", "GP do Japão", "GP do Brasil"],
  },
};

describe("research-trigger (pure / deterministic)", () => {
  it("versão e regra", () => {
    expect(RESEARCH_TRIGGER_VERSION).toBe("research-trigger.v1");
    expect(RESEARCH_TRIGGER_RULE).toBe("research-trigger.v1#mode=pure#scope=decision");
  });

  it("mensagem vazia → sem pesquisa", () => {
    expect(shouldResearch({ message: "" })).toEqual({ shouldResearch: false, reasons: [], confidence: 0 });
  });

  it("saudação simples não dispara pesquisa", () => {
    const result = shouldResearch({ message: "Bom dia, gente!" });
    expect(result.shouldResearch).toBe(false);
    expect(result.queryHint).toBeUndefined();
  });

  it("afirmação factual sobre a protagonista não dispara pesquisa", () => {
    const result = shouldResearch({ message: "Alicya é a melhor piloto.", internal: DEEP_FIXED_CONTEXT });
    expect(result.shouldResearch).toBe(false);
    expect(result.reasons).not.toContain("DEFINITION_REQUEST");
  });

  it("pergunta de definição com conceito externo dispara pesquisa com queryHint", () => {
    const result = shouldResearch({ message: "O que significa síndrome de protagonista?" });
    expect(result.shouldResearch).toBe(true);
    expect(result.reasons).toContain("DEFINITION_REQUEST");
    expect(result.reasons).toContain("EXTERNAL_CONCEPT");
    expect(result.queryHint).toBe("síndrome de protagonista");
  });

  it("exemplo do enunciado ('... s.o que é isso?') dispara pesquisa", () => {
    const result = shouldResearch({
      message: "Alicya tem síndrome de protagonista. O que é isso?",
      internal: DEEP_FIXED_CONTEXT,
    });
    expect(result.shouldResearch).toBe(true);
    expect(result.queryHint).toBe("sindrome de protagonista");
  });

  it("internal-first: conceito coberto internamente NÃO dispara pesquisa externa", () => {
    const result = shouldResearch({
      message: "O que é o Grande Prêmio de Mônaco?",
      internal: DEEP_FIXED_CONTEXT,
    });
    expect(result.shouldResearch).toBe(false);
    expect(result.reasons).toContain("INTERNAL_COVERAGE");
    expect(result.reasons).not.toContain("EXTERNAL_CONCEPT");
    expect(result.queryHint).toBeUndefined();
  });

  it("participante conhecido em pergunta de definição não dispara pesquisa", () => {
    const result = shouldResearch({
      message: "Quem é a Alicya?",
      internal: DEEP_FIXED_CONTEXT,
    });
    expect(result.shouldResearch).toBe(false);
  });

  it("conceito em memórias do personagem → internal-first", () => {
    const result = shouldResearch({
      message: "O que é o duto de freios?",
      internal: DEEP_FIXED_CONTEXT,
    });
    expect(result.shouldResearch).toBe(false);
    expect(result.reasons).toContain("INTERNAL_COVERAGE");
  });

  it("determinismo: mesma entrada → mesma decisão", () => {
    const input = { message: "O que significa síndrome de protagonista?", internal: DEEP_FIXED_CONTEXT };
    const first = shouldResearch(input);
    const second = shouldResearch(input);
    expect(second).toEqual(first);
  });

  it("confidence sempre em [0,1]", () => {
    const messages = ["Bom dia, gente!", "O que é o BRT?", "Alicya é a melhor piloto.", "Como funciona a categoria?"];
    for (const m of messages) {
      const result = shouldResearch({ message: m, internal: DEEP_FIXED_CONTEXT });
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("config threshold 0 permite disparo mesmo de saudação (com conceito)", () => {
    const result = shouldResearch({ message: "Bom dia, gente!" }, { threshold: 0 });
    expect(result.shouldResearch).toBe(true);
    expect(result.queryHint).toBe("bom dia gente");
  });

  it("conceito coberto nunca gera pesquisa (gating), mesmo com penalty zerado", () => {
    const result = shouldResearch(
      { message: "O que é o Grande Prêmio de Mônaco?", internal: DEEP_FIXED_CONTEXT },
      { weights: { ...RESEARCH_TRIGGER_DEFAULT_CONFIG.weights, internalCoverage: 0 } },
    );
    expect(result.shouldResearch).toBe(false);
    expect(result.reasons).toContain("INTERNAL_COVERAGE");
    expect(result.reasons).not.toContain("EXTERNAL_CONCEPT");
  });

  describe("formulateResearchQuery", () => {
    it("objeto de definição preserva significado", () => {
      expect(formulateResearchQuery("O que significa síndrome de protagonista?")).toBe("síndrome de protagonista");
    });

    it("mensagem vazia → null", () => {
      expect(formulateResearchQuery("")).toBeNull();
      expect(formulateResearchQuery("   ")).toBeNull();
    });

    it("participante em pergunta de definição → null", () => {
      expect(formulateResearchQuery("Quem é a Alicya?", DEEP_FIXED_CONTEXT)).toBeNull();
    });

    it("conceito próprio (apelido) em texto correto → extrai runs", () => {
      const q = formulateResearchQuery("O Grande Prêmio do Japão será na próxima semana?", DEEP_FIXED_CONTEXT);
      expect(q).toBe("grande premio do japao");
    });

    it("respeita maxConceptTokens", () => {
      const q = formulateResearchQuery(
        "O que significa a síndrome de protagonista e outras coisas?",
        undefined,
        { maxConceptTokens: 3 },
      );
      expect(q?.split(/\s+/).length).toBeLessThanOrEqual(3);
    });
  });
});