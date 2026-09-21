import { describe, expect, it } from "vitest";
import type { AssembledContext } from "../context/context.assembly.js";
import {
  appendTurnReply,
  createTurnContext,
} from "../conversation/turn-context.js";
import {
  HIGH_OVERLAP_THRESHOLD,
  isHighLexicalOverlap,
  lexicalOverlap,
  RESPONSE_OVERLAP_VERSION,
} from "../conversation/response-overlap.js";
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

  it("uma resposta por speaker, na ordem, com atribuição em linguagem natural", () => {
    const section = composeCurrentTurnSection(turnWithReplies());
    const kimiLine = '- Kimi disse anteriormente: "Eu vi a corrida."';
    const alicyaLine = '- Alicya disse anteriormente: "Eu também vi a corrida."';
    expect(section).toContain(kimiLine);
    expect(section).toContain(alicyaLine);
    expect(section.indexOf(kimiLine)).toBeLessThan(section.indexOf(alicyaLine));
  });

  it("não usa a gramática de prompt antiga [AI_CHARACTER] Nome: \"...\"", () => {
    const section = composeCurrentTurnSection(turnWithReplies());
    expect(section).not.toContain("[AI_CHARACTER]");
    expect(section).not.toMatch(/\[AI_CHARACTER\][^\n]*: "/);
    expect(section).not.toContain('Kimi: "');
    expect(section).not.toContain('Alicya: "');
  });

  it("contém instrução local de fronteira de saída", () => {
    const section = composeCurrentTurnSection(turnWithReplies());
    expect(section).toContain("não as reproduza literalmente");
    expect(section).toContain("Não reproduza marcadores BEGIN/END");
    expect(section).toContain("rótulos de seção");
    expect(section).toContain("rótulos de speaker");
    expect(section).toContain("fala natural do personagem atual");
  });

  it("contexto B-depois-de-A distingue cada personagem", () => {
    const section = composeCurrentTurnSection(turnWithReplies());
    expect(section).toContain("Kimi disse anteriormente");
    expect(section).toContain("Alicya disse anteriormente");
    expect(section).not.toContain("Kimi disse anteriormente: \"Eu também");
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

  it("resposta anterior permanece presente e atribuída no prompt", () => {
    const prompt = composeSystemPrompt(
      fixturePureContext(),
      "char-kimi",
      turnWithReplies(),
    );
    expect(prompt).toContain('- Kimi disse anteriormente: "Eu vi a corrida."');
    expect(prompt).toContain('- Alicya disse anteriormente: "Eu também vi a corrida."');
    expect(prompt).not.toContain("[AI_CHARACTER]");
  });

  it("marcadores BEGIN/END da seção permanecem inalterados", () => {
    const prompt = composeSystemPrompt(
      fixturePureContext(),
      "char-kimi",
      turnWithReplies(),
    );
    expect(prompt).toContain("<BEGIN 5:CURRENT_TURN>");
    expect(prompt).toContain("<END 5:CURRENT_TURN>");
    expect(prompt).toContain("<BEGIN 4:ACTIVE_SPEAKER>");
    expect(prompt).toContain("<END 4:ACTIVE_SPEAKER>");
  });

  it("ACTIVE_SPEAKER explicita iniciador do turno, não o AI speaker gerado", () => {
    const prompt = composeSystemPrompt(
      fixturePureContext(),
      "char-kimi",
      turnWithReplies(),
    );
    expect(prompt).toContain("Speaker ativo (iniciador do turno/usuário):");
    expect(prompt).toContain("não o AI speaker gerado neste frame");
    expect(prompt).toContain("anchor de identidade do speaker");
  });

  it("identidade sem DNA permanece intacta (sem CHARACTER_DNA) com CURRENT_TURN", () => {
    const prompt = composeSystemPrompt(
      fixturePureContext(),
      "char-kimi",
      turnWithReplies(),
    );
    expect(prompt).not.toContain("CHARACTER_DNA");
    expect(prompt).toContain("<BEGIN 5:CURRENT_TURN>");
    expect(assertGenerationContract(resultFrom(prompt))).toBe(true);
  });
});

describe("CURRENT_TURN — anti-eco / contribuição independente (STEP 109P-1)", () => {
  it("instrução de contribuição independente existe", () => {
    const section = composeCurrentTurnSection(turnWithReplies());
    expect(section).toContain("Contribuição independente");
    expect(section).toContain("contribuição própria");
  });

  it("declara que a fala anterior é contexto, não instrução", () => {
    const section = composeCurrentTurnSection(turnWithReplies());
    expect(section).toContain("contexto de continuidade, não instruções");
    expect(section).toContain("nem conteúdo a reproduzir");
  });

  it("proíbe repetição literal/paráfrase como substituto de contribuição", () => {
    const section = composeCurrentTurnSection(turnWithReplies());
    expect(section).toContain(
      "Não repita nem parafraseie uma fala anterior como substituto de contribuição",
    );
    expect(section).toContain("plenamente em personagem");
    expect(section).toContain("sem discordar artificialmente");
  });

  it("mantém a fala anterior verbatim e atribuída ao speaker original", () => {
    const section = composeCurrentTurnSection(turnWithReplies());
    expect(section).toContain('- Kimi disse anteriormente: "Eu vi a corrida."');
    expect(section).toContain('- Alicya disse anteriormente: "Eu também vi a corrida."');
  });

  it("marcadores e ordenação da seção permanecem inalterados", () => {
    const prompt = composeSystemPrompt(
      fixturePureContext(),
      "char-kimi",
      turnWithReplies(),
    );
    expect(prompt).toContain("<BEGIN 4:ACTIVE_SPEAKER>");
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

  it("identidade B-depois-de-A permanece correta com a nova instrução", () => {
    const section = composeCurrentTurnSection(turnWithReplies());
    expect(section).not.toContain('Kimi disse anteriormente: "Eu também');
    expect(section).toContain("- previousSpeaker: Alicya");
    expect(section).toContain("- directReplyOpportunity: sim");
  });

  it("identidade sem DNA permanece intacta com a nova instrução", () => {
    const prompt = composeSystemPrompt(
      fixturePureContext(),
      "char-kimi",
      turnWithReplies(),
    );
    expect(prompt).not.toContain("CHARACTER_DNA");
    expect(prompt).toContain("Contribuição independente");
    expect(assertGenerationContract(resultFrom(prompt))).toBe(true);
  });

  it("prompt não contém o formato antigo [AI_CHARACTER] Nome: \"...\"", () => {
    const prompt = composeSystemPrompt(
      fixturePureContext(),
      "char-kimi",
      turnWithReplies(),
    );
    expect(prompt).not.toContain("[AI_CHARACTER]");
    expect(prompt).not.toMatch(/\[AI_CHARACTER\][^\n]*: "/);
  });

  it("helper de overlap permanece intacto (threshold 0.7, jaccard)", () => {
    expect(RESPONSE_OVERLAP_VERSION).toBe("response-overlap.v1");
    expect(HIGH_OVERLAP_THRESHOLD).toBe(0.7);
    expect(
      lexicalOverlap("Eu vi a corrida.", "Eu também vi a corrida."),
    ).toBeGreaterThanOrEqual(HIGH_OVERLAP_THRESHOLD);
    expect(isHighLexicalOverlap(lexicalOverlap("a", "b"))).toBe(false);
  });
});

describe("CURRENT_TURN — anti-eco / concordância natural (STEP 109P-1B)", () => {
  const section = () => composeCurrentTurnSection(turnWithReplies());

  it("orienta explicitamente a concordância natural", () => {
    expect(section()).toContain("Concordância natural");
    expect(section()).toContain("é permitido concordar com a fala anterior");
    expect(section()).toContain("sem discordar artificialmente");
  });

  it("exige motivo/observação/contribuição original ao concordar", () => {
    expect(section()).toContain(
      "mesmo ao concordar, apresente um motivo, exemplo, observação, consequência, qualificação ou ângulo próprio",
    );
  });

  it("proíbe reutilizar a formulação anterior como corpo da resposta", () => {
    expect(section()).toContain(
      "não reutilize a formulação anterior como corpo da sua resposta",
    );
    expect(section()).toContain("use as suas próprias palavras");
  });

  it("preserva o nome exato do speaker anterior", () => {
    expect(section()).toContain(
      "use exatamente o nome do speaker tal como aparece no contexto",
    );
  });

  it("proíbe inventar/renomear/alterar o nome ou identidade do speaker", () => {
    expect(section()).toContain(
      "não invente, renomeie nem altere o nome ou a identidade do speaker",
    );
  });

  it("mantém a instrução anti-eco existente do STEP 109P-1", () => {
    expect(section()).toContain("Contribuição independente");
    expect(section()).toContain(
      "Não repita nem parafraseie uma fala anterior como substituto de contribuição",
    );
    expect(section()).toContain("contribuição própria");
  });

  it("mantém a fala anterior verbatim e atribuída ao speaker original", () => {
    expect(section()).toContain('- Kimi disse anteriormente: "Eu vi a corrida."');
    expect(section()).toContain('- Alicya disse anteriormente: "Eu também vi a corrida."');
  });

  it("representação da fala anterior não usa BEGIN/END nem [AI_CHARACTER]", () => {
    const replyLines = section()
      .split("\n")
      .filter((line) => line.startsWith("- ") && line.includes("disse anteriormente"));
    expect(replyLines.length).toBe(2);
    for (const line of replyLines) {
      expect(line).not.toContain("<BEGIN");
      expect(line).not.toContain("<END");
      expect(line).not.toContain("[BEGIN");
      expect(line).not.toContain("[AI_CHARACTER]");
    }
  });

  it("marcadores/ordenação e contrato permanecem inalterados", () => {
    const prompt = composeSystemPrompt(
      fixturePureContext(),
      "char-kimi",
      turnWithReplies(),
    );
    expect(prompt).toContain("<BEGIN 4:ACTIVE_SPEAKER>");
    expect(prompt).toContain("<BEGIN 5:CURRENT_TURN>");
    expect(prompt).toContain("<END 5:CURRENT_TURN>");
    expect(prompt).toContain("<BEGIN 6:WORLD_STATE>");
    expect(assertGenerationContract(resultFrom(prompt))).toBe(true);
  });
});