import { describe, expect, it } from "vitest";
import type { AssembledContext } from "../context/context.assembly.js";
import {
  appendTurnReply,
  createTurnContext,
} from "../conversation/turn-context.js";
import {
  assertGenerationContract,
  composeCurrentTurnSection,
  composeSystemPrompt,
  countEmittedSections,
  type GenerationResult,
} from "./generation.assembly.js";

// STEP 109F — CURRENT_TURN no systemPrompt:
//   - seção opcional, aparece SOMENTE quando há respostas anteriores do turno;
//   - posicionada após ACTIVE_SPEAKER (ordem fixa de SECTION_IDS);
//   - conteúdo só com actor/senderType/content (USER message NÃO é duplicada);
//   - sinais de continuidade descritivos (previousSpeaker/directReply/
//     repeatedTopic);
//   - determinística e compatível com assertGenerationContract.

function fixturePureContext(): AssembledContext {
  return {
    meta: {
      version: "context.v1",
      conversationId: "00000000-0000-4000-8000-000000000002",
      conversationType: "GROUP",
      participantCharacterIds: ["user-1", "char-kimi", "char-alicya"],
      assembledAt: "2026-01-01T00:00:00.000Z",
      ruleApplied: "context.v1-policy:msgs=50#mem=15#evt=10#rel=10#news=8",
    },
    participants: [],
    activeSpeaker: { characterId: "char-kimi", senderType: "AI_CHARACTER" },
    temporal: { worldDate: null, currentSeasonId: null, currentRaceId: null, currentSession: null, phaseMarker: null },
    recentMessages: [],
    memories: [],
    events: [],
    relationships: [],
    motorsport: null,
    news: [],
    omitted: { oldestMessagesTruncated: 0, memoriesOmitted: 0, reasons: [] },
  };
}

function resultFrom(systemPrompt: string): GenerationResult {
  return {
    context: fixturePureContext(),
    systemPrompt,
    meta: {
      provider: "spy",
      mode: "generated",
      tokens: {
        systemPromptChars: systemPrompt.length,
        contextBlocks: countEmittedSections(systemPrompt),
      },
      ruleApplied: "generation.v1-policy:mode=generated",
    },
    text: "x",
    speakerCharacterId: "char-kimi",
    generationKey: "sha256:test",
  };
}

function turnWithReplies() {
  let turn = createTurnContext({
    userMessage: "O que acharam da corrida?",
    userCharacterId: "user-1",
    userCharacterName: "Alicya",
  });
  turn = appendTurnReply(turn, {
    speakerCharacterId: "char-kimi",
    speakerName: "Kimi",
    senderType: "AI_CHARACTER",
    content: "Eu vi a corrida.",
  });
  turn = appendTurnReply(turn, {
    speakerCharacterId: "char-alicya",
    speakerName: "Alicya",
    senderType: "AI_CHARACTER",
    content: "Eu também vi a corrida.",
  });
  return turn;
}

describe("CURRENT_TURN — composição pura (STEP 109F)", () => {
  it("sem turnContext ou sem respostas → seção vazia", () => {
    expect(composeCurrentTurnSection(undefined)).toBe("");
    const turn = createTurnContext({
      userMessage: "x",
      userCharacterId: "user-1",
      userCharacterName: "Alicya",
    });
    expect(composeCurrentTurnSection(turn)).toBe("");
  });

  it("uma resposta por speaker, na ordem, com actor/senderType/content", () => {
    const section = composeCurrentTurnSection(turnWithReplies());
    const kimiLine = '- [AI_CHARACTER] Kimi: "Eu vi a corrida."';
    const alicyaLine = '- [AI_CHARACTER] Alicya: "Eu também vi a corrida."';
    expect(section).toContain(kimiLine);
    expect(section).toContain(alicyaLine);
    expect(section.indexOf(kimiLine)).toBeLessThan(section.indexOf(alicyaLine));
  });

  it("sinais de continuidade descritivos entram no contexto", () => {
    const section = composeCurrentTurnSection(turnWithReplies());
    expect(section).toContain("- previousSpeaker: Alicya");
    expect(section).toContain("- directReplyOpportunity: sim");
    expect(section).toContain("- repeatedTopic:");
    expect(section).toContain("apresentam alta sobreposição lexical");
  });

  it("USER message NÃO é duplicada dentro da seção", () => {
    const section = composeCurrentTurnSection(turnWithReplies());
    expect(section).not.toContain("O que acharam da corrida?");
  });

  it("baixa sobreposição entre respostas anteriores → repeatedTopic descarta alta", () => {
    let turn = createTurnContext({
      userMessage: "x",
      userCharacterId: "user-1",
      userCharacterName: "Alicya",
    });
    turn = appendTurnReply(turn, {
      speakerCharacterId: "char-kimi",
      speakerName: "Kimi",
      senderType: "AI_CHARACTER",
      content: "A estratégia de DRS definiu a prova.",
    });
    turn = appendTurnReply(turn, {
      speakerCharacterId: "char-alicya",
      speakerName: "Alicya",
      senderType: "AI_CHARACTER",
      content: "A estratégia do pit stop foi arriscada.",
    });
    const section = composeCurrentTurnSection(turn);
    expect(section).toContain("- repeatedTopic: nenhuma sobreposição alta entre as respostas anteriores");
  });

  it("determinismo: mesmas entradas → mesmo texto da seção", () => {
    expect(composeCurrentTurnSection(turnWithReplies())).toBe(
      composeCurrentTurnSection(turnWithReplies()),
    );
  });
});

describe("CURRENT_TURN — composeSystemPrompt + contrato (STEP 109F)", () => {
  it("sem turnContext → sem seção; WORLD_STATE continua na posição 5", () => {
    const prompt = composeSystemPrompt(fixturePureContext(), "char-kimi");
    expect(prompt).not.toContain("CURRENT_TURN");
    expect(prompt).toContain("<BEGIN 5:WORLD_STATE>");
  });

  it("com turnContext → CURRENT_TURN na posição 5, contígua ao WORLD_STATE", () => {
    const prompt = composeSystemPrompt(
      fixturePureContext(),
      "char-kimi",
      turnWithReplies(),
    );
    expect(prompt).toContain("<BEGIN 5:CURRENT_TURN>");
    expect(prompt).toContain("<END 5:CURRENT_TURN>");
    expect(prompt).toContain("<BEGIN 6:WORLD_STATE>");
    const active = prompt.indexOf("<BEGIN 4:ACTIVE_SPEAKER>");
    const current = prompt.indexOf("<BEGIN 5:CURRENT_TURN>");
    const world = prompt.indexOf("<BEGIN 6:WORLD_STATE>");
    expect(active).toBeGreaterThan(-1);
    expect(active).toBeLessThan(current);
    expect(current).toBeLessThan(world);
  });

  it("providers sem turnContext (NullProvider/baseline) não mudam o contrato", () => {
    expect(assertGenerationContract(resultFrom(composeSystemPrompt(fixturePureContext())))).toBe(true);
  });

  it("prompt com CURRENT_TURN é validado por assertGenerationContract", () => {
    const prompt = composeSystemPrompt(
      fixturePureContext(),
      "char-kimi",
      turnWithReplies(),
    );
    expect(assertGenerationContract(resultFrom(prompt))).toBe(true);
  });
});