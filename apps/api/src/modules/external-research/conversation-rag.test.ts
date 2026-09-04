import { describe, expect, it } from "vitest";
import {
  canonicalizeRagQuery,
  canonicalizeScopeSourceIds,
  computeConversationRagFrameKey,
  computeConversationRagFreshnessAnchor,
  computeConversationRagSnapshotKey,
  computeRagQueryHash,
  isRagHash,
  isRagQueryHash,
} from "./conversation-rag.js";
import {
  reconstructExternalRagContext,
  reconstructItemToRow,
} from "./conversation-rag-reconstruction.js";

describe("conversation-rag — canonicalização de query", () => {
  it("A) mesma query em formas de EOL diferentes → mesma canonicalização", () => {
    expect(canonicalizeRagQuery("  consulta\r\nsobre f1  ")).toBe("consulta\nsobre f1");
  });

  it("B) canonicalização preserva acentuação/semântica (não destrói)", () => {
    expect(canonicalizeRagQuery("Chuva em Interlagos")).toBe("Chuva em Interlagos");
  });

  it("C) whitespace à direita por linha é removido, iternos preservados", () => {
    expect(canonicalizeRagQuery("a  b   \n c")).toBe("a  b\n c");
  });

  it("D) trims o total", () => {
    expect(canonicalizeRagQuery("   \n\t x ")).toBe("x");
  });
});

describe("conversation-rag — queryHash", () => {
  it("E) mesma query canônica → mesmo hash", () => {
    expect(computeRagQueryHash("Buscar corrida\r\nem Spa  ")).toBe(
      computeRagQueryHash("Buscar corrida\nem Spa"),
    );
  });

  it("F) queries diferentes → hashes diferentes", () => {
    expect(computeRagQueryHash("monaco gp")).not.toBe(computeRagQueryHash("monza gp"));
  });

  it("G) formato estável sha256:<64 hex>", () => {
    expect(computeRagQueryHash("x")).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(isRagQueryHash(computeRagQueryHash("x"))).toBe(true);
    expect(isRagQueryHash("not-a-hash")).toBe(false);
  });
});

describe("conversation-rag — scope canonical", () => {
  it("H) undefined/null → []", () => {
    expect(canonicalizeScopeSourceIds(undefined)).toEqual([]);
    expect(canonicalizeScopeSourceIds(null)).toEqual([]);
  });

  it("I) lista canonicalizada (sorted-unique) independente da ordem", () => {
    expect(canonicalizeScopeSourceIds(["b", "a", "b"])).toEqual(["a", "b"]);
  });

  it("J) valor inválido → erro", () => {
    expect(() => canonicalizeScopeSourceIds("não-array")).toThrow(/array/);
    expect(() => canonicalizeScopeSourceIds(["ok", 42])).toThrow(/inválida/);
  });
});

describe("conversation-rag — frameKey determinístico", () => {
  const base = {
    queryHash: computeRagQueryHash("buscar gp"),
    scopeSourceIds: ["s1", "s2"],
    topK: 5,
    threshold: 0.55,
    provider: "cohere",
    model: "embed-multilingual-v3.0",
    version: "v3.0",
    dimensions: 1024,
    ruleApplied: "external-retrieval.v1",
  };

  it("K) mesma identidade → mesmo frameKey", () => {
    expect(computeConversationRagFrameKey(base)).toBe(computeConversationRagFrameKey(base));
  });

  it("L) ordem do scope não altera o frameKey", () => {
    const a = computeConversationRagFrameKey({ ...base, scopeSourceIds: ["s2", "s1", "s2"] });
    const b = computeConversationRagFrameKey({ ...base, scopeSourceIds: ["s1", "s2"] });
    expect(a).toBe(b);
  });

  it("M) mudança que altera resultado muda frameKey (query, topK, threshold, provider)", () => {
    const q = computeConversationRagFrameKey(base);
    expect(computeConversationRagFrameKey({ ...base, queryHash: computeRagQueryHash("outro") })).not.toBe(q);
    expect(computeConversationRagFrameKey({ ...base, topK: 10 })).not.toBe(q);
    expect(computeConversationRagFrameKey({ ...base, threshold: 0.7 })).not.toBe(q);
    expect(computeConversationRagFrameKey({ ...base, provider: "mock" })).not.toBe(q);
  });
});

describe("conversation-rag — freshnessAnchor + snapshotKey", () => {
  const ref = {
    frameKey: "fk-1",
    scopeSourceIds: ["s1"],
    topK: 5,
    threshold: 0.5,
    provider: "cohere",
    model: "embed-multilingual-v3.0",
    version: "v3.0",
    dimensions: 1024,
    ruleApplied: "external-retrieval.v1",
  };
  const bindings = [
    { chunkId: "c2", contentHash: "sha256:aaa", embeddedContentHash: "sha256:aaa" },
    { chunkId: "c1", contentHash: "sha256:bbb", embeddedContentHash: "sha256:bbb" },
  ];

  it("N) mesma entrada → mesma anchor", () => {
    expect(computeConversationRagFreshnessAnchor({ ...ref, chunkBindings: bindings })).toBe(
      computeConversationRagFreshnessAnchor({ ...ref, chunkBindings: [...bindings].reverse() }),
    );
  });

  it("O) conteúdo alterado → anchor diferente (freshness)", () => {
    const a = computeConversationRagFreshnessAnchor({ ...ref, chunkBindings: bindings });
    const changed = computeConversationRagFreshnessAnchor({
      ...ref,
      chunkBindings: [
        { ...bindings[0], contentHash: "sha256:ccc" },
        { ...bindings[1] },
      ],
    });
    expect(changed).not.toBe(a);
  });

  it("P) mesmo snapshotKey para mesma frame+anchor; diferente para anchor diferente", () => {
    const anchor = computeConversationRagFreshnessAnchor({ ...ref, chunkBindings: bindings });
    expect(computeConversationRagSnapshotKey("fk-1", anchor)).toBe(
      computeConversationRagSnapshotKey("fk-1", anchor),
    );
    expect(computeConversationRagSnapshotKey("fk-1", anchor)).not.toBe(
      computeConversationRagSnapshotKey("fk-1", "sha256:other"),
    );
  });

  it("Q) hash helpers", () => {
    expect(isRagHash("sha256:" + "a".repeat(64))).toBe(true);
    expect(isRagHash(undefined)).toBe(false);
  });
});

describe("conversation-rag-reconstruction — contrato neutro", () => {
  const frame = {
    provider: "cohere",
    model: "embed-multilingual-v3.0",
    version: "v3.0",
    dimensions: 1024,
    ruleApplied: "external-retrieval.v1#mode=pgvector#scope=service",
  };

  function mkRow(over: Partial<ReturnType<typeof reconstructItemToRow>> = {}): ReturnType<typeof reconstructItemToRow> {
    return {
      order: 0,
      chunkId: "chunk-1",
      sourceId: "src-1",
      documentId: "doc-1",
      title: "Fonte 1",
      content: "conteúdo",
      orderOriginal: 0,
      score: 0.9,
      distance: 0.1,
      citation: "Fonte 1 (linha 1)",
      ...over,
    };
  }

  it("R) reconstrói contrato com provenance/score/distance/citation preservados", () => {
    const ctx = reconstructExternalRagContext(frame, [mkRow()]);
    expect(ctx.sourceType).toBe("external");
    expect(ctx.provider).toBe("cohere");
    expect(ctx.dimensions).toBe(1024);
    expect(ctx.ruleApplied).toMatch(/external-retrieval/);
    expect(ctx.items).toHaveLength(1);
    expect(ctx.items[0]).toMatchObject({
      sourceId: "src-1",
      documentId: "doc-1",
      chunkId: "chunk-1",
      title: "Fonte 1",
      content: "conteúdo",
      score: 0.9,
      distance: 0.1,
      citation: "Fonte 1 (linha 1)",
    });
  });

  it("S) ordena por order ASC (determinístico)", () => {
    const ctx = reconstructExternalRagContext(frame, [
      mkRow({ order: 1, chunkId: "b" }),
      mkRow({ order: 0, chunkId: "a" }),
      mkRow({ order: 2, chunkId: "c" }),
    ]);
    expect(ctx.items.map((i) => i.chunkId)).toEqual(["a", "b", "c"]);
  });

  it("T) não inclui vector/embedding/secrets", () => {
    const ctx = reconstructExternalRagContext(frame, [mkRow()]);
    const json = JSON.stringify(ctx);
    expect(ctx.items[0]).not.toHaveProperty("embedding");
    expect(ctx.items[0]).not.toHaveProperty("vector");
    expect(json).not.toMatch(/apiKey|bearer|Authorization|secret|token/i);
  });

  it("U) empty items → contexto com items vazio", () => {
    const ctx = reconstructExternalRagContext(frame, []);
    expect(ctx.items).toEqual([]);
  });
});
