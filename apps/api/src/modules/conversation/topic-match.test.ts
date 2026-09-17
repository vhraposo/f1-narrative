import { describe, expect, it } from "vitest";
import {
  TOPIC_MATCH_RULE,
  TOPIC_MATCH_VERSION,
  isTopicMatch,
  normalizeTopicText,
  topicOverlap,
} from "./topic-match.js";

describe("STEP 109E - topic-match léxico puro", () => {
  it("1) exporta versão e regra", () => {
    expect(TOPIC_MATCH_VERSION).toBe("topic-match.v1");
    expect(TOPIC_MATCH_RULE).toContain("topic-match.v1-rule");
  });

  it("2) normalizeTopicText remove acentos e normaliza caixa", () => {
    expect(normalizeTopicText("Mônaco")).toBe("monaco");
    expect(normalizeTopicText("  VOCÊS VOCÊ MONZA! ")).toBe("voces voce monza");
    expect(normalizeTopicText("")).toBe("");
  });

  it("3) match com 2+ tokens significativos compartilhados", () => {
    expect(
      isTopicMatch("A vitória de Interlagos foi linda", "Em Interlagos a vitória veio cedo"),
    ).toBe(true);
  });

  it("4) topicOverlap retorna tokens distintos e ordenados", () => {
    expect(topicOverlap("zebra zebra ok", "ok y zebra")).toEqual(["ok", "zebra"]);
    expect(topicOverlap("zebra amarela", "cachorro preto")).toEqual([]);
  });

  it("5) token único longo (>=5) basta, mesmo em minúsculas", () => {
    expect(isTopicMatch("comentem sobre interlagos", "Interlagos estava molhado")).toBe(
      true,
    );
  });

  it("6) token único curto NÃO capitalizado não casa (regra da força)", () => {
    expect(isTopicMatch("fala do sena hoje", "o sena ontem venceu")).toBe(false);
  });

  it("7) token único curto Capitalizado no original casa (nome próprio)", () => {
    expect(isTopicMatch("Fale sobre Baku!", "Baku foi incrível ontem")).toBe(true);
  });

  it("8) acrônimo ALL_CAPS casa mesmo curto", () => {
    expect(isTopicMatch("A FIA decidiu o caso?", "decisão da FIA foi justa")).toBe(true);
  });

  it("9) case-insensitive após normalização", () => {
    expect(isTopicMatch("quem venceu no JAPÃO?", "o japao dominou a corrida")).toBe(true);
  });

  it("10) diacríticos não impedem o match", () => {
    expect(isTopicMatch("Falam de Mônaco?", "a vitória em monaco foi épica")).toBe(true);
  });

  it("11) stopwords são ignoradas (sopa de conectivos não casa)", () => {
    expect(isTopicMatch("o que de e em o a", "que de em o a e")).toBe(false);
    expect(isTopicMatch("Bom dia a todos", "Bom dia a todos em Interlagos")).toBe(false);
  });

  it("12) sem tokens compartilhados → false", () => {
    expect(isTopicMatch("zebra amarela corre", "cachorro preto dorme")).toBe(false);
    expect(isTopicMatch("", "qualquer coisa")).toBe(false);
  });
});