import { describe, expect, it } from "vitest";
import {
  type RetrievedExternalContext,
  type RetrievalResult,
  EXTERNAL_RETRIEVAL_RULE,
} from "./external-retrieval.js";
import {
  type ExternalRagContext,
  EXTERNAL_RAG_ADAPTER_RULE,
  isValidRagItem,
  mergeExternalRagContexts,
  toExternalRagContext,
} from "./external-rag-adapter.js";

// ---------------------------------------------------------------------------
// Testes do Adapter RAG → Context Assembly (Fase 13 STEP 10).
//
// O adapter é PURAMENTE FUNCIONAL: não usa prisma/DB, não faz HTTP, não usa
// provider/Cohere. Todos os testes rodam SEM conexão com banco (TEST/DEV) e
// SEM nenhum request de rede. A entrada é materializada diretamente.
// ---------------------------------------------------------------------------

const PROVIDER = "cohere";
const MODEL = "embed-multilingual-v3.0";
const VERSION = "v3.0";
const DIMENSIONS = 1024;

function mkItem(over: Partial<RetrievalResult> & { chunkId?: string }): RetrievalResult {
  return {
    sourceId: "src-1",
    documentId: "doc-1",
    chunkId: "c1",
    title: "título",
    content: "conteúdo do chunk",
    orderOriginal: 0,
    score: 1,
    distance: 0,
    citation: "Fonte — Título [chunk 0]",
    ...over,
  } as RetrievalResult;
}

function mkRetrieved(
  results: RetrievalResult[],
  partial?: Partial<RetrievedExternalContext>,
): RetrievedExternalContext {
  return {
    query: "pergunta",
    provider: PROVIDER,
    model: MODEL,
    version: VERSION,
    dimensions: DIMENSIONS,
    ruleApplied: EXTERNAL_RETRIEVAL_RULE,
    topK: 5,
    threshold: 0.55,
    results,
    ...partial,
  };
}

describe("toExternalRagContext — conversão pura/determinística", () => {
  it("A) converte 1 resultado", () => {
    const item = mkItem({});
    const out = toExternalRagContext(mkRetrieved([item]));
    expect(out.sourceType).toBe("external");
    expect(out.items).toHaveLength(1);
    expect(out.items[0].chunkId).toBe(item.chunkId);
  });

  it("B) converte múltiplos resultados", () => {
    const items = [mkItem({ chunkId: "a" }), mkItem({ chunkId: "b" }), mkItem({ chunkId: "c" })];
    const out = toExternalRagContext(mkRetrieved(items));
    expect(out.items).toHaveLength(3);
    expect(out.items.map((i) => i.chunkId)).toEqual(["a", "b", "c"]);
  });

  it("C) preserva todos os campos do item", () => {
    const item = mkItem({
      sourceId: "sX",
      documentId: "dY",
      chunkId: "cZ",
      title: "T",
      content: "C",
      orderOriginal: 7,
      score: 0.9,
      distance: 0.1,
      citation: "cit",
    });
    const out = toExternalRagContext(mkRetrieved([item]));
    const o = out.items[0];
    expect(o.sourceId).toBe("sX");
    expect(o.documentId).toBe("dY");
    expect(o.chunkId).toBe("cZ");
    expect(o.title).toBe("T");
    expect(o.content).toBe("C");
    expect(o.orderOriginal).toBe(7);
    expect(o.score).toBe(0.9);
    expect(o.distance).toBe(0.1);
    expect(o.citation).toBe("cit");
  });

  it("D) preserva a ordem original (sem reordenar)", () => {
    const first = mkItem({ chunkId: "c-low", score: 0.2, orderOriginal: 2 });
    const second = mkItem({ chunkId: "c-high", score: 0.9, orderOriginal: 1 });
    // ordem NÃO é score DESC aqui de propósito: o adapter deve preservar o que
    // o retrieval já retornou (inclusive numa ordem não-monótona).
    const out = toExternalRagContext(mkRetrieved([first, second]));
    expect(out.items.map((i) => i.chunkId)).toEqual(["c-low", "c-high"]);
  });

  it("E) vazio → items=[] com metadata preservada", () => {
    const out = toExternalRagContext(mkRetrieved([]));
    expect(out.items).toEqual([]);
    expect(out.provider).toBe(PROVIDER);
    expect(out.model).toBe(MODEL);
    expect(out.version).toBe(VERSION);
    expect(out.dimensions).toBe(DIMENSIONS);
    expect(out.ruleApplied).toBe(EXTERNAL_RETRIEVAL_RULE);
  });

  it("P) ruleApplied preservado", () => {
    const out = toExternalRagContext(mkRetrieved([mkItem({})]));
    expect(out.ruleApplied).toBe(EXTERNAL_RETRIEVAL_RULE);
  });

  it("Q/R/S/T) provider/model/version/dimensions preservados", () => {
    const out = toExternalRagContext(mkRetrieved([mkItem({})]));
    expect(out.provider).toBe(PROVIDER);
    expect(out.model).toBe(MODEL);
    expect(out.version).toBe(VERSION);
    expect(out.dimensions).toBe(DIMENSIONS);
  });

  it("N/O) determinismo: mesma entrada → saída serializada idêntica", () => {
    const input = mkRetrieved([mkItem({ chunkId: "a", score: 0.9 }), mkItem({ chunkId: "b", score: 0.5 })]);
    const a = toExternalRagContext(input);
    const b = toExternalRagContext(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("Y) entrada original NÃO sofre mutation", () => {
    const item = mkItem({ chunkId: "c1", score: 0.8, sourceId: "s1" });
    const input = mkRetrieved([item]);
    const snapshot = JSON.stringify(input);
    toExternalRagContext(input);
    mergeExternalRagContexts(toExternalRagContext(mkRetrieved([item])));
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("validation — itens inválidos (I, J, K, L, M)", () => {
  it("M) itens inválidos são ignorados conforme regra (sem lançar, sem corrigir)", () => {
    const valid = mkItem({ chunkId: "ok", score: 0.9 });
    const noChunk = mkItem({ chunkId: "" });
    const nanScore = mkItem({ chunkId: "nan", score: NaN });
    const infScore = mkItem({ chunkId: "inf", score: Infinity });
    const outOfBand = mkItem({ chunkId: "oob", score: 2 });

    const out = toExternalRagContext(mkRetrieved([valid, noChunk, nanScore, infScore, outOfBand]));
    expect(out.items).toHaveLength(1);
    expect(out.items[0].chunkId).toBe("ok");
  });

  it("I) item sem chunkId (ausente) é ignorado", () => {
    const missing = mkItem({ chunkId: undefined as unknown as string });
    const valid = mkItem({ chunkId: "ok", score: 0.9 });
    const out = toExternalRagContext(mkRetrieved([missing, valid]));
    expect(out.items).toHaveLength(1);
    expect(out.items[0].chunkId).toBe("ok");
  });

  it("J) item com score NaN é ignorado", () => {
    expect(isValidRagItem(mkItem({ chunkId: "a", score: NaN }))).toBe(false);
    const out = toExternalRagContext(mkRetrieved([mkItem({ chunkId: "a", score: NaN })]));
    expect(out.items).toEqual([]);
  });

  it("K) item com score Infinity/-Infinity é ignorado", () => {
    expect(isValidRagItem(mkItem({ chunkId: "a", score: Infinity }))).toBe(false);
    expect(isValidRagItem(mkItem({ chunkId: "a", score: -Infinity }))).toBe(false);
    const out = toExternalRagContext(
      mkRetrieved([mkItem({ chunkId: "a", score: Infinity }), mkItem({ chunkId: "b", score: 0.7 })]),
    );
    expect(out.items).toHaveLength(1);
    expect(out.items[0].chunkId).toBe("b");
  });

  it("L) score fora da convenção [-1,1] é ignorado", () => {
    expect(isValidRagItem(mkItem({ chunkId: "a", score: 2 }))).toBe(false);
    expect(isValidRagItem(mkItem({ chunkId: "b", score: -2 }))).toBe(false);
    expect(isValidRagItem(mkItem({ chunkId: "c", score: 1 }))).toBe(true);
    expect(isValidRagItem(mkItem({ chunkId: "d", score: -1 }))).toBe(true);
  });

  it("não corrige silenciosamente score inválido (mantém score original)", () => {
    const valid = mkItem({ chunkId: "ok", score: 0.75, distance: 0.25 });
    const out = toExternalRagContext(mkRetrieved([valid]));
    expect(out.items[0].score).toBe(0.75);
    expect(out.items[0].score + out.items[0].distance).toBeCloseTo(1, 10);
  });
});

describe("mergeExternalRagContexts — dedup determinístico (F, G, H)", () => {
  it("F) dedup por chunkId", () => {
    const a = toExternalRagContext(mkRetrieved([mkItem({ chunkId: "c1", score: 0.9 })]));
    const b = toExternalRagContext(mkRetrieved([mkItem({ chunkId: "c1", score: 0.9 }), mkItem({ chunkId: "c2", score: 0.5 })]));
    const out = mergeExternalRagContexts(a, b);
    expect(out.items.map((i) => i.chunkId).sort()).toEqual(["c1", "c2"]);
  });

  it("G) dedup mantém o maior score", () => {
    const lower = toExternalRagContext(mkRetrieved([mkItem({ chunkId: "c1", score: 0.4, sourceId: "s1" })]));
    const higher = toExternalRagContext(mkRetrieved([mkItem({ chunkId: "c1", score: 0.9, sourceId: "s1" })]));
    const out = mergeExternalRagContexts(lower, higher);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].score).toBe(0.9);
  });

  it("H) empate de score → tie-break chunkId ASC, determinístico (independente da ordem)", () => {
    const itemA = mkItem({ chunkId: "aaa", score: 0.5 });
    const itemB = mkItem({ chunkId: "bbb", score: 0.5 });
    const fwd = mergeExternalRagContexts(
      toExternalRagContext(mkRetrieved([itemB])),
      toExternalRagContext(mkRetrieved([itemA])),
    );
    const bwd = mergeExternalRagContexts(
      toExternalRagContext(mkRetrieved([itemA])),
      toExternalRagContext(mkRetrieved([itemB])),
    );
    expect(fwd.items.map((i) => i.chunkId)).toEqual(["aaa", "bbb"]);
    expect(str(fwd)).toBe(str(bwd));
  });

  it("metadata: preserva do primeiro contexto; vazio → items=[]", () => {
    const ctx = toExternalRagContext(mkRetrieved([mkItem({ chunkId: "c1", score: 0.8 })]));
    const out = mergeExternalRagContexts(ctx);
    expect(out.provider).toBe(PROVIDER);
    expect(out.model).toBe(MODEL);
    expect(out.version).toBe(VERSION);
    expect(out.dimensions).toBe(DIMENSIONS);
    expect(out.ruleApplied).toBe(EXTERNAL_RETRIEVAL_RULE);

    const empty = mergeExternalRagContexts();
    expect(empty.items).toEqual([]);
    expect(empty.sourceType).toBe("external");
  });
});

describe("security / leakage (V, W, X)", () => {
  it("V) nenhum vector/embedding é retornado", () => {
    const out = toExternalRagContext(mkRetrieved([mkItem({ chunkId: "c1", score: 0.9 })]));
    const json = JSON.stringify(out);
    expect(json).not.toContain('"embedding"');
    expect(json).not.toContain('"vector"');
    expect(out.items[0]).not.toHaveProperty("embedding");
    expect(out.items[0]).not.toHaveProperty("vector");
  });

  it("W/X) saída não contém nada de DB/HTTP/provider (sem fingerprint de rede)", () => {
    const out = toExternalRagContext(mkRetrieved([mkItem({ chunkId: "c1", score: 0.9 })]));
    const json = JSON.stringify(out);
    expect(json.toLowerCase()).not.toContain("queryraw");
    expect(json.toLowerCase()).not.toContain("executeraw");
    expect(json.toLowerCase()).not.toContain("fetch");
    expect(json.toLowerCase()).not.toContain("api.cohere.com");
    expect(json.toLowerCase()).not.toContain("auth");
    expect(json.toLowerCase()).not.toContain("sk-");
  });
});

describe("module boundary", () => {
  it("exporta a rule do adapter (interface-only)", () => {
    expect(EXTERNAL_RAG_ADAPTER_RULE).toMatch(/^external-rag-adapter\.v1#mode=pure#scope=service$/);
  });

  it("context.sourceType fixo em 'external'", () => {
    expect(toExternalRagContext(mkRetrieved([])).sourceType).toBe("external");
    expect(mergeExternalRagContexts().sourceType).toBe("external");
  });
});

function str(ctx: ExternalRagContext): string {
  return JSON.stringify(ctx);
}
