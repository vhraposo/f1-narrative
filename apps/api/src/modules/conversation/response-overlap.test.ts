import { describe, expect, it } from "vitest";
import {
  HIGH_OVERLAP_THRESHOLD,
  isHighLexicalOverlap,
  lexicalOverlap,
  maxLexicalOverlap,
  RESPONSE_OVERLAP_RULE,
  RESPONSE_OVERLAP_VERSION,
} from "./response-overlap.js";

// STEP 109F §5/§16.17 — redundância: comparação lexical simples/determinística
// que DETECTA respostas quase idênticas sem BLOQUEAR respostas distintas.

describe("response-overlap (STEP 109F)", () => {
  it("constantes de versão/regra presentes", () => {
    expect(RESPONSE_OVERLAP_VERSION).toBe("response-overlap.v1");
    expect(RESPONSE_OVERLAP_RULE).toContain("response-overlap.v1-rule");
    expect(HIGH_OVERLAP_THRESHOLD).toBe(0.7);
  });

  it("textos idênticos → sobreposição 1 (alta)", () => {
    expect(lexicalOverlap("Eu vi a corrida.", "Eu vi a corrida.")).toBe(1);
    expect(isHighLexicalOverlap(lexicalOverlap("a", "b"))).toBe(false);
  });

  it("respostas quase idênticas → alta sobreposição (exemplo do enunciado)", () => {
    // Kimi praticamente repete Alicya (formulação ligeiramente diferente).
    const score = lexicalOverlap("Eu vi a corrida.", "Eu também vi a corrida.");
    expect(score).toBeGreaterThanOrEqual(HIGH_OVERLAP_THRESHOLD);
  });

  it("respostas distintas que só compartilham palavras → NÃO alta (não bloqueia)", () => {
    // Alicya:
    const a = "Eu vi a corrida.";
    // Kimi amplia com tema próprio: compartilha "vi" mas diverge.
    const b = "Vi, e aquela estratégia da última parada foi absurda.";
    const score = lexicalOverlap(a, b);
    expect(score).toBeLessThan(HIGH_OVERLAP_THRESHOLD);
    expect(score).toBeGreaterThan(0);
  });

  it("inputs vazios → 0 sem NaN", () => {
    expect(lexicalOverlap("", "alguma coisa")).toBe(0);
    expect(lexicalOverlap("alguma coisa", "")).toBe(0);
    expect(lexicalOverlap("", "")).toBe(0);
    expect(Number.isNaN(lexicalOverlap("   ", "!!!"))).toBe(false);
  });

  it("maxLexicalOverlap: maior sobreposição entre candidato e respostas anteriores", () => {
    const others = [
      "A estratégia de DRS foi o grande divisor.",
      "A chuva complicou a estratégia de todos.",
    ];
    const max = maxLexicalOverlap(
      "A estratégia de pit stop salvou a corrida inteira.",
      others,
    );
    expect(max).toBeGreaterThan(0);
    // resultado é o máximo das comparações dois-a-dois
    const pairwise = others.map((o) => lexicalOverlap("A estratégia de pit stop salvou a corrida inteira.", o));
    expect(max).toBe(Math.max(...pairwise));
  });

  it("maxLexicalOverlap sem respostas anteriores → 0", () => {
    expect(maxLexicalOverlap("qualquer coisa", [])).toBe(0);
  });

  it("isHighLexicalOverlap segue o limiar (>= 0.7)", () => {
    expect(isHighLexicalOverlap(0.69)).toBe(false);
    expect(isHighLexicalOverlap(0.7)).toBe(true);
    expect(isHighLexicalOverlap(1)).toBe(true);
  });
});