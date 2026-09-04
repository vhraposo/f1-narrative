import { describe, expect, it } from "vitest";
import type { ExternalRagContext, ExternalRagItem } from "../external-research/external-rag-adapter.js";
import type { AssembledContext } from "../context/context.assembly.js";
import {
  assertGenerationContract,
  composeExternalContextSection,
  composeSystemPrompt,
  computeGenerationKey,
  countEmittedSections,
  EXTERNAL_CONTEXT_MARKER,
  GENERATION_RULE,
} from "./generation.assembly.js";

// ---------------------------------------------------------------------------
// Testes da seção NEUTRA e OPT-IN `EXTERNAL_CONTEXT` (Fase 13 STEP 12).
//
// TUDO puro e determinístico: nenhum prisma, nenhum provider, nenhum retrieval,
// nenhuma rede. O foco é a camada de composição do systemPrompt sobre o
// `AssembledContext.externalRag` já materializado pelo STEP 11 (adapter).
//
// REGRA CRÍTICA: sem `externalRag`, o systemPrompt é byte-a-byte igual ao
// baseline (12 seções, terminando em `<END 12:BEHAVIORAL_INVARIANTS>`).
// ---------------------------------------------------------------------------

function mkItem(over: Partial<ExternalRagItem> & { chunkId?: string } = {}): ExternalRagItem {
  return {
    sourceId: "src-1",
    documentId: "doc-1",
    chunkId: "c1",
    title: "título do documento",
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
      conversationId: "00000000-0000-4000-8000-000000000010",
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

function mkMeta(systemPrompt: string, contextBlocks: number) {
  return {
    provider: "null",
    mode: "assembly-only" as const,
    tokens: { systemPromptChars: systemPrompt.length, contextBlocks },
    ruleApplied: GENERATION_RULE,
  };
}

function mkResult(ctx: AssembledContext) {
  const systemPrompt = composeSystemPrompt(ctx);
  const meta = mkMeta(systemPrompt, countEmittedSections(systemPrompt));
  return {
    context: ctx,
    systemPrompt,
    meta,
    generationKey: computeGenerationKey(ctx, systemPrompt, meta),
  };
}

const WITH_RAG: ExternalRagContext = mkRag([
  mkItem({
    chunkId: "c1",
    title: "Primeiro documento",
    content: "Primeira passagem sobre Interlagos",
    orderOriginal: 0,
    score: 0.95,
    distance: 0.05,
    citation: "Fonte — Interlagos 2026 [chunk 0]",
  }),
  mkItem({
    chunkId: "c2",
    title: "Segundo documento",
    content: "Segunda passagem sobre Spa",
    orderOriginal: 3,
    score: 0.8,
    distance: 0.2,
    citation: "Fonte — Spa 2026 [chunk 3]",
  }),
]);

describe("ExternalContext - sem RAG (baseline intacto)", () => {
  it("A) sem externalRag -> sem seção EXTERNAL_CONTEXT; baseline byte-a-byte (12 seções)", () => {
    const base = mkAssembled();
    expect("externalRag" in base).toBe(false);
    const prompt = composeSystemPrompt(base);
    expect(prompt).not.toContain("EXTERNAL_CONTEXT");
    expect(prompt).not.toContain(EXTERNAL_CONTEXT_MARKER);
    // terminando como o baseline
    expect(prompt).toContain("<BEGIN 1:GLOBAL_RULES>");
    expect(prompt).toContain("<END 12:BEHAVIORAL_INVARIANTS>");
    // e NENHUM marcador de contexto externo entre MOTORSPORT e OMITTED
    const motorsport = prompt.indexOf("<END 10:MOTORSPORT>");
    const omitted = prompt.indexOf("<BEGIN 11:OMITTED_CONTEXT>");
    expect(motorsport).toBeGreaterThan(-1);
    expect(omitted).toBeGreaterThan(motorsport);
    expect(prompt.slice(motorsport + "<END 10:MOTORSPORT>".length, omitted)).not.toContain("EXTERNAL");
  });

  it("B) baseline igual entre duas execuções sem RAG (determinismo byte-a-byte)", () => {
    expect(composeSystemPrompt(mkAssembled())).toBe(composeSystemPrompt(mkAssembled()));
  });

  it("C) sem RAG -> contextBlocks 12 e contrato válido; generationKey estável", () => {
    const r = mkResult(mkAssembled());
    expect(r.meta.tokens.contextBlocks).toBe(12);
    expect(assertGenerationContract(r)).toBe(true);
    expect(computeGenerationKey(r.context, r.systemPrompt, r.meta)).toBe(r.generationKey);
  });
});

describe("ExternalContext - com RAG (seção opt-in emitida)", () => {
  it("D) com RAG -> seção EXTERNAL_CONTEXT emitida na posição fixa 11", () => {
    const prompt = composeSystemPrompt(mkAssembled({ externalRag: WITH_RAG }));
    expect(prompt).toContain("<BEGIN 11:EXTERNAL_CONTEXT>");
    expect(prompt).toContain("<END 11:EXTERNAL_CONTEXT>");
    // ordem: ... MOTORSPORT(10) -> EXTERNAL_CONTEXT(11) -> OMITTED(12) -> BEHAVIORAL(13)
    const ext = prompt.indexOf("<BEGIN 11:EXTERNAL_CONTEXT>");
    const omitted = prompt.indexOf("<BEGIN 12:OMITTED_CONTEXT>");
    const behavioral = prompt.indexOf("<BEGIN 13:BEHAVIORAL_INVARIANTS>");
    expect(ext).toBeGreaterThan(prompt.indexOf("<END 10:MOTORSPORT>"));
    expect(omitted).toBeGreaterThan(ext);
    expect(behavioral).toBeGreaterThan(omitted);
    expect(prompt).toContain("<END 13:BEHAVIORAL_INVARIANTS>");
  });

  it("E) com RAG -> contextBlocks 13 e contrato válido", () => {
    const r = mkResult(mkAssembled({ externalRag: WITH_RAG }));
    expect(r.meta.tokens.contextBlocks).toBe(13);
    expect(assertGenerationContract(r)).toBe(true);
  });

  it("F) ordem dos itens preservada exatamente como fornecida", () => {
    const section = composeExternalContextSection(WITH_RAG);
    const i1 = section.indexOf("Primeira passagem sobre Interlagos");
    const i2 = section.indexOf("Segunda passagem sobre Spa");
    expect(i1).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(i1);
  });

  it("G) provenance/citation/score/distance preservados no texto", () => {
    const section = composeExternalContextSection(WITH_RAG);
    expect(section).toContain("source=src-1 doc=doc-1 chunk=c1");
    expect(section).toContain("chunk=c2");
    expect(section).toContain("score: 0.95");
    expect(section).toContain("distância: 0.2");
    expect(section).toContain("Fonte — Interlagos 2026 [chunk 0]");
    expect(section).toContain("ordem original: 3");
  });

  it("H) boundary marker presente no texto da seção", () => {
    const section = composeExternalContextSection(WITH_RAG);
    expect(section).toContain(EXTERNAL_CONTEXT_MARKER);
  });

  it("I) NÃO vaza secrets/provider/model/dimensions/query no prompt", () => {
    const prompt = composeSystemPrompt(mkAssembled({ externalRag: WITH_RAG }));
    expect(prompt).not.toContain("embed-multilingual-v3.0");
    expect(prompt).not.toContain("cohere");
    expect(prompt).not.toContain("1024");
  });

  it("J) mesmas 10 primeiras seções permanecem byte-a-byte (não afetadas pelo RAG)", () => {
    const without = composeSystemPrompt(mkAssembled());
    const withRag = composeSystemPrompt(mkAssembled({ externalRag: WITH_RAG }));
    const headWithout = without.slice(0, without.indexOf("<BEGIN 11:OMITTED_CONTEXT>"));
    expect(withRag).toContain(headWithout);
    expect(withRag.slice(0, withRag.indexOf("<BEGIN 11:EXTERNAL_CONTEXT>"))).toBe(headWithout);
  });
});

describe("ExternalContext - determinismo e generationKey", () => {
  it("K) dois frames com RAG idênticos -> mesmo prompt, mesma generationKey", () => {
    const a = mkResult(mkAssembled({ externalRag: WITH_RAG }));
    const b = mkResult(mkAssembled({ externalRag: WITH_RAG }));
    expect(a.systemPrompt).toBe(b.systemPrompt);
    expect(a.generationKey).toBe(b.generationKey);
  });

  it("L) sem RAG vs com RAG -> generationKey deterministicamente diferentes", () => {
    const noRag = mkResult(mkAssembled());
    const withRag = mkResult(mkAssembled({ externalRag: WITH_RAG }));
    expect(noRag.generationKey).not.toBe(withRag.generationKey);
  });

  it("M) item a mais altera generationKey (sensibilidade à seleção)", () => {
    const one = mkResult(mkAssembled({ externalRag: mkRag([mkItem({ chunkId: "c1" })]) }));
    const two = mkResult(mkAssembled({ externalRag: mkRag([mkItem({ chunkId: "c1" }), mkItem({ chunkId: "c2" })]) }));
    expect(one.generationKey).not.toBe(two.generationKey);
  });

  it("N) countEmittedSections diferencia 12 (sem RAG) e 13 (com RAG)", () => {
    expect(countEmittedSections(composeSystemPrompt(mkAssembled()))).toBe(12);
    expect(countEmittedSections(composeSystemPrompt(mkAssembled({ externalRag: WITH_RAG })))).toBe(13);
  });
});

describe("ExternalContext - empty-RAG e pureza", () => {
  it("O) empty-RAG (items vazios) -> seção emitida com aviso neutro, contextBlocks 13, contrato válido", () => {
    const empty = mkAssembled({ externalRag: mkRag([]) });
    const prompt = composeSystemPrompt(empty);
    expect(prompt).toContain("<BEGIN 11:EXTERNAL_CONTEXT>");
    expect(prompt).toContain("Nenhum contexto externo (RAG) está disponível");
    const r = mkResult(empty);
    expect(r.meta.tokens.contextBlocks).toBe(13);
    expect(assertGenerationContract(r)).toBe(true);
  });

  it("P) composeSystemPrompt NÃO muta o contexto fornecido", () => {
    const ctx = mkAssembled({ externalRag: WITH_RAG });
    const snapshot = JSON.stringify(ctx);
    composeSystemPrompt(ctx);
    expect(JSON.stringify(ctx)).toBe(snapshot);
  });

  it("Q) composeExternalContextSection é puro e determinístico", () => {
    expect(composeExternalContextSection(WITH_RAG)).toBe(composeExternalContextSection(WITH_RAG));
  });

  it("R) composeExternalContextSection(undefined) retorna string vazia", () => {
    expect(composeExternalContextSection(undefined)).toBe("");
  });
});

describe("ExternalContext - contrato negativo (corrupção)", () => {
  it("S) frame com RAG com contextBlocks incorreto -> false", () => {
    const r = mkResult(mkAssembled({ externalRag: WITH_RAG }));
    r.meta.tokens.contextBlocks = 12;
    expect(assertGenerationContract(r)).toBe(false);
  });

  it("T) remover END 13:BEHAVIORAL_INVARIANTS -> false", () => {
    const r = mkResult(mkAssembled({ externalRag: WITH_RAG }));
    r.systemPrompt = r.systemPrompt.replace(/<END 13:BEHAVIORAL_INVARIANTS>/, "");
    expect(assertGenerationContract(r)).toBe(false);
  });

  it("U) remover BEGIN da seção OMITTED em frame com RAG -> false (numeração quebra)", () => {
    const r = mkResult(mkAssembled({ externalRag: WITH_RAG }));
    r.systemPrompt = r.systemPrompt.replace(/<BEGIN 12:OMITTED_CONTEXT>\n/, "");
    expect(assertGenerationContract(r)).toBe(false);
  });

  it("V) ordem das seções embaralhada com RAG -> false", () => {
    const r = mkResult(mkAssembled({ externalRag: WITH_RAG }));
    const blocks = r.systemPrompt.split("\n\n");
    [blocks[1], blocks[2]] = [blocks[2], blocks[1]];
    r.systemPrompt = blocks.join("\n\n");
    expect(assertGenerationContract(r)).toBe(false);
  });
});
