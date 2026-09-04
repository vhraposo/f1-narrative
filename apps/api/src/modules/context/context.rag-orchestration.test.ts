import { describe, expect, it } from "vitest";
import type { ExternalRagContext, ExternalRagItem } from "../external-research/external-rag-adapter.js";
import type { AssembledContext } from "./context.assembly.js";
import {
  assembleContextWithExternalRag,
  isValidRagBoundary,
  ExternalRagContractError,
} from "./context.rag-orchestration.js";

// ---------------------------------------------------------------------------
// Tests da fronteira de orchestration RAG → Context Assembly (Fase 13 STEP 13).
//
// TUDO puro e determinístico: NENHUM prisma instanciado, NENHUM HTTP/provider,
// NENHUM retrieval. O orchester é um wrapper fino sobre `withExternalRag` (STEP 11)
// com a ÚNICA responsabilidade nova: validação estrutural mínima da fronteira,
// com FAIL-FAST de contrato (presente-porém-malformado NUNCA vira ausência).
// ---------------------------------------------------------------------------

function mkItem(over: Partial<ExternalRagItem> & { chunkId?: string } = {}): ExternalRagItem {
  return {
    sourceId: "src-1",
    documentId: "doc-1",
    chunkId: "c1",
    title: "título",
    content: "conteúdo do chunk",
    orderOriginal: 0,
    score: 0.9,
    distance: 0.1,
    citation: "Fonte — Título [chunk 0]",
    ...over,
  } as ExternalRagItem;
}

function mkRag(items: ExternalRagItem[] = [], over: Partial<ExternalRagContext> = {}): ExternalRagContext {
  return {
    sourceType: "external",
    provider: "cohere",
    model: "embed-multilingual-v3.0",
    version: "v3.0",
    dimensions: 1024,
    ruleApplied: "external-retrieval.v1#mode=pgvector#scope=service",
    items,
    ...over,
  };
}

function mkAssembled(over: Partial<AssembledContext> = {}): AssembledContext {
  return {
    meta: {
      version: "context.v1",
      conversationId: "00000000-0000-4000-8000-000000000013",
      conversationType: "GROUP",
      participantCharacterIds: [],
      assembledAt: "2026-01-01T00:00:00.000Z",
      ruleApplied: "context.v1-policy:msgs=50#mem=15#evt=10#rel=10#news=8",
    },
    participants: [],
    activeSpeaker: { characterId: null, senderType: "USER_CHARACTER" },
    temporal: {
      worldDate: null,
      currentSeasonId: null,
      currentRaceId: null,
      currentSession: null,
      phaseMarker: null,
    },
    recentMessages: [],
    memories: [],
    events: [],
    relationships: [],
    motorsport: null,
    news: [],
    omitted: { oldestMessagesTruncated: 0, memoriesOmitted: 0, reasons: [] },
    ...over,
  } as AssembledContext;
}

describe("STEP 13 - sem RAG (undefined/null)", () => {
  it("A) undefined -> externalRag AUSENTE; contexto pré-RAG preservado byte-a-byte", () => {
    const base = mkAssembled();
    const out = assembleContextWithExternalRag(base, undefined);
    expect("externalRag" in out).toBe(false);
    expect(out).toEqual(base);
  });

  it("B) null -> externalRag AUSENTE (não vira objeto vazio nem inventa dados)", () => {
    const base = mkAssembled();
    const out = assembleContextWithExternalRag(base, null);
    expect("externalRag" in out).toBe(false);
    expect(out).toEqual(base);
  });

  it("undefined -> saída deterministicamente igual (duas chamadas)", () => {
    const base = mkAssembled();
    expect(JSON.stringify(assembleContextWithExternalRag(base, undefined))).toBe(
      JSON.stringify(assembleContextWithExternalRag(base, undefined)),
    );
  });
});

describe("STEP 13 - com RAG válido (verbatim)", () => {
  const RAG: ExternalRagContext = mkRag([
    mkItem({ chunkId: "c1", title: "doc um", content: "passagem um", orderOriginal: 0, score: 0.95, distance: 0.05, citation: "Cite A" }),
    mkItem({ chunkId: "c2", title: "doc dois", content: "passagem dois", orderOriginal: 3, score: 0.8, distance: 0.2, citation: "Cite B" }),
    mkItem({ chunkId: "c3", title: "doc três", content: "passagem três", orderOriginal: 5, score: 0.9, distance: 0.1, citation: "Cite C" }),
  ]);

  it("D) RAG presente -> externalRag anexado exatamente como recebido", () => {
    const base = mkAssembled();
    const out = assembleContextWithExternalRag(base, RAG);
    expect(out.externalRag).toBe(RAG);
    expect(out.externalRag).toEqual(RAG);
  });

  it("G/I/J/K/L/M) provenance, citation, score, distance, sourceType preservados", () => {
    const out = assembleContextWithExternalRag(mkAssembled(), RAG);
    const items = out.externalRag!.items;
    expect(items[0]).toEqual({
      sourceId: "src-1",
      documentId: "doc-1",
      chunkId: "c1",
      title: "doc um",
      content: "passagem um",
      orderOriginal: 0,
      score: 0.95,
      distance: 0.05,
      citation: "Cite A",
    });
    expect(items[0].citation).toBe("Cite A");
    expect(items[0].score).toBe(0.95);
    expect(items[0].distance).toBe(0.05);
    expect(out.externalRag!.sourceType).toBe("external");
  });

  it("H) ordem dos items preservada exatamente (sem re-rank/sort/reverse)", () => {
    const out = assembleContextWithExternalRag(mkAssembled(), RAG);
    expect(out.externalRag!.items.map((i) => i.chunkId)).toEqual(["c1", "c2", "c3"]);
  });

  it("Y) NÃO deduplica: dois items iguais são preservados", () => {
    const dup = mkRag([mkItem({ chunkId: "same" }), mkItem({ chunkId: "same" })]);
    const out = assembleContextWithExternalRag(mkAssembled(), dup);
    expect(out.externalRag!.items).toHaveLength(2);
    expect(out.externalRag!.items[0].chunkId).toBe("same");
    expect(out.externalRag!.items[1].chunkId).toBe("same");
  });

  it("F) todos os metadados do contrato preservados", () => {
    const out = assembleContextWithExternalRag(mkAssembled(), RAG);
    expect(out.externalRag!.provider).toBe("cohere");
    expect(out.externalRag!.model).toBe("embed-multilingual-v3.0");
    expect(out.externalRag!.version).toBe("v3.0");
    expect(out.externalRag!.dimensions).toBe(1024);
    expect(out.externalRag!.ruleApplied).toMatch(/^external-retrieval\.v1/);
  });
});

describe("STEP 13 - empty RAG (válido, preservado)", () => {
  it("E/O) empty-RAG PRESERVADO (não convertido para undefined; nenhum dado inventado)", () => {
    const empty = mkRag([]);
    const out = assembleContextWithExternalRag(mkAssembled(), empty);
    expect(out.externalRag).toBeDefined();
    expect(out.externalRag!.items).toEqual([]);
    expect("externalRag" in out).toBe(true);
  });
});

describe("STEP 13 - FAIL-FAST de contrato (C NUNCA vira A)", () => {
  it("C) sourceType inválido -> lança ExternalRagContractError (não vira ausência)", () => {
    const bad = { sourceType: "foo", items: [] } as unknown as ExternalRagContext;
    expect(() => assembleContextWithExternalRag(mkAssembled(), bad)).toThrow(ExternalRagContractError);
  });

  it("items não-array -> lança ExternalRagContractError", () => {
    const bad = { sourceType: "external", items: "not-array" } as unknown as ExternalRagContext;
    expect(() => assembleContextWithExternalRag(mkAssembled(), bad)).toThrow(ExternalRagContractError);
  });

  it("objeto nulo (null) -> tratado como AUSÊNCIA (regra definitiva), não lança", () => {
    const base = mkAssembled();
    const out = assembleContextWithExternalRag(base, null);
    expect("externalRag" in out).toBe(false);
    expect(out).toEqual(base);
  });

  it("erro lançado é determinístico (mesma mensagem para mesma entrada)", () => {
    const bad = { sourceType: "external", items: {} } as unknown as ExternalRagContext;
    let a = "";
    let b = "";
    try {
      assembleContextWithExternalRag(mkAssembled(), bad);
    } catch (e) {
      a = (e as Error).message;
    }
    try {
      assembleContextWithExternalRag(mkAssembled(), bad);
    } catch (e) {
      b = (e as Error).message;
    }
    expect(a).toBe(b);
    expect(a).toContain("external");
    expect(a).toContain("items");
  });
});

describe("STEP 13 - isValidRagBoundary (validação estrutural mínima)", () => {
  it("objeto válido -> true", () => {
    expect(isValidRagBoundary(mkRag())).toBe(true);
  });
  it("empty-RAG válido -> true", () => {
    expect(isValidRagBoundary(mkRag([]))).toBe(true);
  });
  it("sourceType inválido -> false", () => {
    expect(isValidRagBoundary({ sourceType: "foo", items: [] })).toBe(false);
  });
  it("items não-array -> false", () => {
    expect(isValidRagBoundary({ sourceType: "external", items: 42 })).toBe(false);
  });
  it("undefined/null/não-objeto -> false", () => {
    expect(isValidRagBoundary(undefined)).toBe(false);
    expect(isValidRagBoundary(null)).toBe(false);
    expect(isValidRagBoundary("external")).toBe(false);
  });
});

describe("STEP 13 - imutabilidade, determinismo e firewall", () => {
  it("N) entrada NUNCA mutada", () => {
    const base = mkAssembled();
    const before = JSON.stringify(base);
    assembleContextWithExternalRag(base, mkRag([mkItem()]));
    expect(JSON.stringify(base)).toBe(before);
  });

  it("O) saída é um NOVO objeto (não o mesmo)", () => {
    const base = mkAssembled();
    const out = assembleContextWithExternalRag(base, mkRag([mkItem()]));
    expect(out).not.toBe(base);
    const noRag = assembleContextWithExternalRag(base, undefined);
    expect(noRag).not.toBe(base);
  });

  it("P/Q) determinismo: mesma entrada -> mesma saída serializada (com e sem RAG)", () => {
    const rag = mkRag([mkItem({ chunkId: "x" })]);
    expect(JSON.stringify(assembleContextWithExternalRag(mkAssembled(), rag))).toBe(
      JSON.stringify(assembleContextWithExternalRag(mkAssembled(), rag)),
    );
    expect(JSON.stringify(assembleContextWithExternalRag(mkAssembled(), undefined))).toBe(
      JSON.stringify(assembleContextWithExternalRag(mkAssembled(), undefined)),
    );
  });

  it("R/S) contrato neutro NÃO introduz vector/embedding/secrets no contexto de saída", () => {
    const rag = mkRag([mkItem({ chunkId: "x" })]);
    const out = assembleContextWithExternalRag(mkAssembled(), rag);
    const keys = Object.keys(out.externalRag!);
    expect(keys).not.toContain("vector");
    expect(keys).not.toContain("embedding");
    expect(keys).not.toContain("apiKey");
    expect(keys).not.toContain("bearerToken");
    expect(keys).not.toContain("headers");
    expect(keys).not.toContain("secret");
    // itens também não expõem vector/secret
    const itemKeys = Object.keys(out.externalRag!.items[0]);
    expect(itemKeys).not.toContain("vector");
    expect(itemKeys).not.toContain("embedding");
    expect(itemKeys).not.toContain("secret");
  });

  it("semântica verbatim: out.externalRag === rag (mesma referência, sem transformação)", () => {
    const rag = mkRag([mkItem({ chunkId: "x" })]);
    const out = assembleContextWithExternalRag(mkAssembled(), rag);
    expect(out.externalRag).toBe(rag);
  });
});
