import { describe, expect, it } from "vitest";
import {
  characterDnaHasContent,
  flattenScalars,
  formatBiographySnippet,
  formatDnaLines,
  normalizeCharacterDna,
} from "./dna-contract.js";

describe("dna-contract — normalizador defensivo de Character.dna (STEP 109C)", () => {
  it("1) dna completo → contrato preenchido (keys canônicas)", () => {
    const dna = normalizeCharacterDna({
      personality: "ousada",
      behavior: "metódica",
      speechStyle: "frases curtas",
      tendencies: ["direta", "competitiva"],
      values: "integridade",
      traits: ["audaz", "leal"],
    });
    expect(dna).toEqual({
      personality: "ousada",
      behavior: "metódica",
      speechStyle: "frases curtas",
      tendencies: "direta, competitiva",
      values: "integridade",
      traits: "audaz, leal",
    });
    expect(characterDnaHasContent(dna)).toBe(true);
  });

  it("2) dna vazio {} → contrato vazio; hasContent false; não quebra", () => {
    expect(normalizeCharacterDna({})).toEqual({});
    expect(normalizeCharacterDna({})).not.toHaveProperty("personality");
    expect(characterDnaHasContent(normalizeCharacterDna({}))).toBe(false);
  });

  it("3) shape parcial → apenas campos presentes são preenchidos", () => {
    const dna = normalizeCharacterDna({ personality: "sereno" });
    expect(dna).toEqual({ personality: "sereno" });
    expect(dna.behavior).toBeUndefined();
  });

  it("4) aliases PT (personalidade/comportamento/…) são normalizados p/ keys canônicas", () => {
    const dna = normalizeCharacterDna({
      personalidade: "ousada",
      comportamento: "metódico",
      valores: ["lealdade"],
      caracteristicas: ["rápido"],
    });
    expect(dna.personality).toBe("ousada");
    expect(dna.behavior).toBe("metódico");
    expect(dna.values).toBe("lealdade");
    expect(dna.traits).toBe("rápido");
  });

  it("5) arrays de escalares viram texto legível; escalares são stringificados", () => {
    expect(normalizeCharacterDna({ tendencies: ["a", "b"] }).tendencies).toBe("a, b");
    expect(normalizeCharacterDna({ values: 3 }).values).toBe("3");
    expect(normalizeCharacterDna({ traits: true }).traits).toBe("true");
  });

  it("6) objetos aninhados não explodem; folhas escalares são achatadas", () => {
    expect(flattenScalars({ nested: { a: 1, b: 2 } })).toBe("nested: a: 1; b: 2");
    const dna = normalizeCharacterDna({ personality: { estilo: "direto", tom: "seco" } });
    expect(dna.personality).toBe("estilo: direto; tom: seco");
  });

  it("7) campos desconhecidos/types estranhos são ignorados sem lançar", () => {
    const dna = normalizeCharacterDna({
      hack: { x: { y: [1, 2] } },
      outraChave: "zzz",
      personality: 42,
    } as unknown as Parameters<typeof normalizeCharacterDna>[0]);
    expect(dna).toEqual({ personality: "42" });
  });

  it("8) raws inválidos (null/string/array/number) → {} sem quebrar", () => {
    expect(normalizeCharacterDna(null)).toEqual({});
    expect(normalizeCharacterDna(undefined)).toEqual({});
    expect(normalizeCharacterDna("oi")).toEqual({});
    expect(normalizeCharacterDna([1, 2])).toEqual({});
    expect(normalizeCharacterDna(7)).toEqual({});
  });

  it("9) valores longos são capados em 500 chars", () => {
    const long = "x".repeat(600);
    const dna = normalizeCharacterDna({ personality: long });
    expect(dna.personality!.length).toBe(501);
    expect(dna.personality!.endsWith("…")).toBe(true);
  });

  it("10) determinístico: mesma entrada → mesmo resultado byte-a-byte", () => {
    const input = {
      personality: "ousada",
      tendencies: ["direta", "competitiva"],
      extra: { a: 1 },
    };
    expect(JSON.stringify(normalizeCharacterDna(input))).toBe(
      JSON.stringify(normalizeCharacterDna(input)),
    );
  });

  it("11) formatDnaLines: somente campos presentes, labels fixos", () => {
    expect(formatDnaLines({ personality: "P", traits: "T" })).toEqual([
      "- Personality: P",
      "- Traits: T",
    ]);
    expect(formatDnaLines({})).toEqual([]);
  });

  it("12) biography: ausente/vazia → null; longa → truncada em limite de palavra", () => {
    expect(formatBiographySnippet(null)).toBeNull();
    expect(formatBiographySnippet(undefined)).toBeNull();
    expect(formatBiographySnippet("   ")).toBeNull();
    expect(formatBiographySnippet("  João da Silva  ")).toBe("João da Silva");
    const long = `palavra ${"y".repeat(610)} fim`;
    const snippet = formatBiographySnippet(long)!;
    expect(snippet.length).toBeLessThanOrEqual(601);
    expect(snippet.endsWith("…")).toBe(true);
  });
});