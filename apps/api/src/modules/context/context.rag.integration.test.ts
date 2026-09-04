import { describe, expect, it } from "vitest";
import {
  type ExternalRagContext,
  type ExternalRagItem,
} from "../external-research/external-rag-adapter.js";
import { withExternalRag, type AssembledContext } from "./context.assembly.js";

// ---------------------------------------------------------------------------
// Testes da INTEGRAÇÃO NEUTRA RAG → Context Assembly (Fase 13 STEP 11).
//
// A "parte pura" do STEP 11 (`withExternalRag`) é TESTADA SEM CONEXÃO DE BANCO:
// nenhum prisma é instanciado e nenhuma rede/HTTP é acionada. O assembly em si
// (leitura de Conversation/etc.) já é coberto por context.test.ts; aqui focamos
// no contrato neutro e determinístico de anexar o RAG ao `AssembledContext`.
// ---------------------------------------------------------------------------

function mkItem(over: Partial<ExternalRagItem> & { chunkId?: string }): ExternalRagItem {
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

// Base mínima de um AssembledContext (estrutura exigida pelo tipo). Como o
// helper `withExternalRag` apenas anexa/remove `externalRag`, os demais campos
// podem ser rascunhos estáveis para fins de teste puro.
function mkAssembled(over: Partial<AssembledContext> = {}): AssembledContext {
  return {
    meta: {
      version: "context.v1",
      conversationId: "00000000-0000-4000-8000-00000000000a",
      conversationType: "GROUP",
      participantCharacterIds: [],
      assembledAt: "2026-08-02T00:00:00.000Z",
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
  };
}

describe("withExternalRag — contrato neutro (puro, sem DB)", () => {
  it("A) sem RAG → a chave externalRag fica AUSENTE (objeto intacto)", () => {
    const base = mkAssembled();
    const out = withExternalRag(base);
    expect("externalRag" in out).toBe(false);
  });

  it("B) com RAG → externalRag populado, preservando todos os campos verbatim", () => {
    const rag = mkRag([
      mkItem({ chunkId: "c1", score: 0.9 }),
      mkItem({ chunkId: "c2", score: 0.5 }),
    ]);
    const out = withExternalRag(mkAssembled(), rag);
    expect(out.externalRag).toBeDefined();
    expect(out.externalRag!.sourceType).toBe("external");
    expect(out.externalRag!.provider).toBe("cohere");
    expect(out.externalRag!.model).toBe("embed-multilingual-v3.0");
    expect(out.externalRag!.version).toBe("v3.0");
    expect(out.externalRag!.dimensions).toBe(1024);
    expect(out.externalRag!.ruleApplied).toMatch(/^external-retrieval\.v1/);
    // ordem é preservada (não re-rank)
    expect(out.externalRag!.items.map((i) => i.chunkId)).toEqual(["c1", "c2"]);
    // provenance completa de cada item
    expect(out.externalRag!.items[0].sourceId).toBe("src-1");
    expect(out.externalRag!.items[0].documentId).toBe("doc-1");
    expect(out.externalRag!.items[0].citation).toContain("Fonte");
  });

  it("F) RAG vazio (items=[]) ainda é anexado ao contexto", () => {
    const rag = mkRag([]);
    const out = withExternalRag(mkAssembled(), rag);
    expect(out.externalRag).toBeDefined();
    expect(out.externalRag!.items).toEqual([]);
    expect(out.externalRag!.provider).toBe("cohere");
  });

  it("C) determinismo: mesma entrada → saída serializada idêntica", () => {
    const rag = mkRag([mkItem({ chunkId: "a", score: 0.9 })]);
    const a = withExternalRag(mkAssembled(), rag);
    const b = withExternalRag(mkAssembled(), rag);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("D) imutabilidade: a entrada assemblada NÃO é mutada pelo attach", () => {
    const base = mkAssembled();
    const snapshot = JSON.stringify(base);
    withExternalRag(base, mkRag([mkItem({ chunkId: "c1" })]));
    withExternalRag(base, null);
    expect(JSON.stringify(base)).toBe(snapshot);
    expect("externalRag" in base).toBe(false);
  });

  it("E) com RAG já presente + null → a chave é removida (objeto novo)", () => {
    const present = withExternalRag(mkAssembled(), mkRag([mkItem({ chunkId: "c1" })]));
    expect("externalRag" in present).toBe(true);
    const cleared = withExternalRag(present, null);
    expect("externalRag" in cleared).toBe(false);
  });

  it("G) isolação preservada: attach não filtra/reordena/recria os itens (sem vetor vazado)", () => {
    const rag = mkRag([mkItem({ chunkId: "z", score: 0.1 }), mkItem({ chunkId: "a", score: 0.9 })]);
    const out = withExternalRag(mkAssembled(), rag);
    const json = JSON.stringify(out);
    // não vaza embedding/vector
    expect(json).not.toContain('"embedding"');
    expect(json).not.toContain('"vector"');
    // não vaza credencial/rede
    expect(json.toLowerCase()).not.toContain("api.cohere.com");
    expect(json.toLowerCase()).not.toContain("sk-");
    // isolação: nenhum campo de ownership/scope é injetado pelo attach
    expect(out.externalRag).toEqual(rag);
  });

  it("externalRag null também deixa a chave ausente", () => {
    const out = withExternalRag(mkAssembled(), null);
    expect("externalRag" in out).toBe(false);
  });
});
