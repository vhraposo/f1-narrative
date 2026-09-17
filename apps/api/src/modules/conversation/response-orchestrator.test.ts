import { describe, expect, it } from "vitest";
import {
  RESPONSE_ORCHESTRATOR_REASON_ORDER,
  RESPONSE_ORCHESTRATOR_VERSION,
  responseOrchestrator,
  selectSpeakers,
  type ResponseOrchestratorInput,
} from "./response-orchestrator.js";

// STEP 109A — testes da camada PURA de seleção de responders. Não acessam
// banco, não registram app Fastify, não tocam provider: provam apenas o
// contrato determinístico do ResponseOrchestrator (0..N AI responders).

const USER_ID = "u-alicya";
const MAX_ID = "c-max";
const CHARLES_ID = "c-charles";
const LEWIS_ID = "c-lewis";

function ai(characterId: string, name: string, available?: boolean) {
  return { characterId, name, controlledBy: "AI" as const, ...(available !== undefined ? { available } : {}) };
}

function user(characterId: string, name: string) {
  return { characterId, name, controlledBy: "USER" as const };
}

function baseInput(overrides: Partial<ResponseOrchestratorInput> = {}): ResponseOrchestratorInput {
  return {
    userMessage: { content: "Bom dia a todos" },
    participants: [ai(MAX_ID, "Max Verstappen"), user(USER_ID, "Alicya")],
    ...overrides,
  };
}

describe("STEP 109A - ResponseOrchestrator seleção básica", () => {
  it("1) zero candidatos AI → candidates vazio, selected vazio e reasons vazio", () => {
    const selection = selectSpeakers(baseInput({ participants: [user(USER_ID, "Alicya")] }));
    expect(selection.candidates).toEqual([]);
    expect(selection.selected).toEqual([]);
    expect(selection.reasons).toEqual({});
  });

  it("2) um candidato AI mencionado pelo nome completo → selecionado", () => {
    const selection = selectSpeakers(
      baseInput({ userMessage: { content: "Max Verstappen, o que você achou da corrida?" } }),
    );
    expect(selection.candidates).toHaveLength(1);
    expect(selection.candidates[0].score).toBe(110); // 100 menção + 10 pergunta
    expect(selection.candidates[0].selected).toBe(true);
    expect(selection.selected).toEqual([MAX_ID]);
  });

  it("3) múltiplos candidatos relevantes dentro do cap → todos selecionados", () => {
    const selection = selectSpeakers(
      baseInput({
        participants: [ai(MAX_ID, "Max Verstappen"), ai(CHARLES_ID, "Charles Leclerc"), user(USER_ID, "Alicya")],
        userMessage: { content: "Max e Charles, quem vence a próxima corrida?" },
      }),
    );
    expect(selection.selected).toHaveLength(2);
    expect(selection.selected.sort()).toEqual([CHARLES_ID, MAX_ID]);
    const selectedCandidates = selection.candidates.filter((c) => c.selected);
    expect(selectedCandidates).toHaveLength(2);
    expect(selectedCandidates.every((c) => c.reasons.includes("DIRECT_MENTION"))).toBe(true);
  });

  it("4) nenhum candidato com sinal relevante → nenhum selecionado", () => {
    const selection = selectSpeakers(
      baseInput({
        participants: [ai(MAX_ID, "Max Verstappen"), ai(LEWIS_ID, "Lewis Hamilton"), user(USER_ID, "Alicya")],
        userMessage: { content: "Bom dia a todos" },
        recentMessages: [],
        memories: [],
        events: [],
        relationships: [],
      }),
    );
    expect(selection.selected).toEqual([]);
    expect(selection.candidates.map((c) => c.excludedReason)).toEqual(["NO_SIGNALS", "NO_SIGNALS"]);
  });

  it("5) menção direta supera o threshold (25) → selecionado", () => {
    const selection = selectSpeakers(
      baseInput({ userMessage: { content: "Max Verstappen está de volta?" } }),
    );
    expect(selection.candidates[0].score).toBeGreaterThanOrEqual(25);
    expect(selection.selected).toEqual([MAX_ID]);
  });

  it("6) pergunta sozinha fica abaixo do threshold; pergunta + relação seleciona", () => {
    const onlyQuestion = selectSpeakers(
      baseInput({
        participants: [ai(MAX_ID, "Max Verstappen"), user(USER_ID, "Alicya")],
        userMessage: { content: "Vocês viram o que aconteceu na volta 1?" },
        recentMessages: [],
        memories: [],
        events: [],
        relationships: [],
      }),
    );
    expect(onlyQuestion.candidates[0].score).toBe(10);
    expect(onlyQuestion.selected).toEqual([]);
    expect(onlyQuestion.candidates[0].excludedReason).toBe("BELOW_THRESHOLD");

    const withRelation = selectSpeakers({
      userMessage: { content: "Vocês viram o que aconteceu na volta 1?", senderCharacterId: USER_ID },
      participants: [ai(MAX_ID, "Max Verstappen"), user(USER_ID, "Alicya")],
      relationships: [{ characterAId: USER_ID, characterBId: MAX_ID }],
    });
    expect(withRelation.candidates[0].score).toBe(30); // 10 pergunta + 20 relação
    expect(withRelation.selected).toEqual([MAX_ID]);
  });

  it("7) candidato sem sinal algum → NÃO selecionado (NO_SIGNALS)", () => {
    const selection = selectSpeakers(baseInput({ userMessage: { content: "ok" } }));
    expect(selection.candidates).toHaveLength(1);
    expect(selection.candidates[0].score).toBe(-100);
    expect(selection.candidates[0].selected).toBe(false);
    expect(selection.candidates[0].excludedReason).toBe("NO_SIGNALS");
    expect(selection.candidates[0].reasons).toEqual(["NO_SIGNALS_PENALTY"]);
  });

  it("8) USER jamais é candidato", () => {
    const selection = selectSpeakers(
      baseInput({
        participants: [user(USER_ID, "Alicya"), ai(MAX_ID, "Max Verstappen")],
        userMessage: { content: "Alicya, Max, respondam!" },
      }),
    );
    expect(selection.candidates).toHaveLength(1);
    expect(selection.candidates[0].characterId).toBe(MAX_ID);
    expect(selection.candidates.some((c) => c.characterId === USER_ID)).toBe(false);
  });

  it("9) AI fora da Conversation (ausente da lista de participantes) jamais é candidato", () => {
    const selection = selectSpeakers(
      baseInput({ userMessage: { content: "Lewis Hamilton, opine aqui!" } }),
    );
    expect(selection.candidates.map((c) => c.characterId)).not.toContain(LEWIS_ID);
    expect(selection.selected).toEqual([]);
  });
});

describe("STEP 109A - ResponseOrchestrator normalização e robuteza", () => {
  it("10) menção case-insensitive", () => {
    const selection = selectSpeakers(
      baseInput({ userMessage: { content: "max verstappen venceu mesmo em Mônaco?" } }),
    );
    expect(selection.selected).toEqual([MAX_ID]);
  });

  it("11) pontuação e diacríticos não quebram a menção", () => {
    const withPunctuation = selectSpeakers(
      baseInput({ userMessage: { content: "Ei… Max — você viu aquilo?!" } }),
    );
    expect(withPunctuation.selected).toEqual([MAX_ID]);

    const withDiacritics = selectSpeakers({
      userMessage: { content: "José, qual é seu palpite?" },
      participants: [ai("c-jose", "José Carlos"), user(USER_ID, "Alicya")],
    });
    expect(withDiacritics.selected).toEqual(["c-jose"]);
  });

  it("12) empate de score → desempate determinístico por characterId asc", () => {
    const selection = selectSpeakers(
      baseInput({
        participants: [ai("c-zzz", "Lewis Hamilton"), ai("c-aaa", "Max Verstappen"), user(USER_ID, "Alicya")],
        userMessage: { content: "Max e Lewis, o que acharam?" },
      }),
    );
    // ambos com 70 (primeiro nome 60 + pergunta 10); empate → id lexicográfico
    // ascendente
    expect(selection.candidates.map((c) => c.score)).toEqual([70, 70]);
    expect(selection.selected).toEqual(["c-aaa", "c-zzz"]);
  });

  it("13) cap (maxResponders) respeitado; excedente recebe CAP_REACHED", () => {
    const selection = selectSpeakers(
      baseInput({
        participants: [ai(MAX_ID, "Max Verstappen"), ai(CHARLES_ID, "Charles Leclerc"), ai(LEWIS_ID, "Lewis Hamilton"), user(USER_ID, "Alicya")],
        userMessage: { content: "Max, Charles e Lewis, respondam!" },
        config: { maxResponders: 2 },
      }),
    );
    expect(selection.selected).toHaveLength(2);
    const capped = selection.candidates.filter((c) => c.excludedReason === "CAP_REACHED");
    expect(capped).toHaveLength(1);
    expect(capped[0].score).toBeGreaterThanOrEqual(25);
    expect(selection.candidates[selection.candidates.length - 1].excludedReason).toBe("CAP_REACHED");
  });

  it("14) reasons explicáveis, ordenadas pelo registro canônico", () => {
    const selection = selectSpeakers({
      userMessage: { content: "Max, você viu o que aconteceu?", senderCharacterId: USER_ID },
      participants: [ai(MAX_ID, "Max Verstappen", false), user(USER_ID, "Alicya")],
      recentMessages: [
        { characterId: USER_ID, senderType: "USER_CHARACTER" },
        { characterId: MAX_ID, senderType: "AI_CHARACTER" },
      ],
      memories: [{ participantCharacterIds: [MAX_ID, USER_ID] }],
      events: [{ participantCharacterIds: [MAX_ID] }],
      relationships: [{ characterAId: USER_ID, characterBId: MAX_ID }],
    });
    const max = selection.candidates.find((c) => c.characterId === MAX_ID)!;
    expect(max.selected).toBe(true);
    expect(max.reasons).toEqual([
      "DIRECT_MENTION",
      "QUESTION_RELEVANCE",
      "RELATION_RELEVANCE",
      "MEMORY_RELEVANCE",
      "EVENT_RELEVANCE",
      "RECENCY",
      "UNAVAILABLE_PENALTY",
    ]);
    // reasons estão na ordem canônica do registro
    const canonical = RESPONSE_ORCHESTRATOR_REASON_ORDER.filter((code) =>
      max.reasons.includes(code),
    );
    expect(max.reasons).toEqual(canonical);
    expect(selection.reasons[MAX_ID]).toEqual(max.reasons);
  });

  it("15) mesma entrada → mesma saída (determinismo, inclusive com participantes embaralhados)", () => {
    const input = (participants: ResponseOrchestratorInput["participants"]): ResponseOrchestratorInput => ({
      userMessage: { content: "Quem ganhará a próxima corrida, Max ou Charles?" },
      participants,
      recentMessages: [{ characterId: MAX_ID, senderType: "AI_CHARACTER" }],
      memories: [{ participantCharacterIds: [CHARLES_ID] }],
    });

    const ordered = input([ai(MAX_ID, "Max Verstappen"), ai(CHARLES_ID, "Charles Leclerc"), user(USER_ID, "Alicya")]);
    const shuffled = input([user(USER_ID, "Alicya"), ai(CHARLES_ID, "Charles Leclerc"), ai(MAX_ID, "Max Verstappen")]);

    const first = selectSpeakers(ordered);
    const second = selectSpeakers(ordered);
    expect(second).toStrictEqual(first);

    const reordered = selectSpeakers(shuffled);
    expect(reordered).toStrictEqual(first);
  });

  it("16) ausência de memoria/event/relationship/recency não quebra a seleção", () => {
    const sparse = selectSpeakers(
      baseInput({ userMessage: { content: "Max Verstappen conte a história dessa volta." } }),
    );
    expect(sparse.selected).toEqual([MAX_ID]);

    const explicitEmpty = selectSpeakers(
      baseInput({
        userMessage: { content: "Max Verstappen conte a história dessa volta." },
        recentMessages: [],
        memories: [],
        events: [],
        relationships: [],
      }),
    );
    expect(explicitEmpty).toStrictEqual(sparse);
  });

  it("17) relação com o remetente aumenta a relevância e habilita a seleção", () => {
    const questionOnly = selectSpeakers({
      userMessage: { content: "Tem algo a dizer?", senderCharacterId: USER_ID },
      participants: [ai(MAX_ID, "Max Verstappen"), user(USER_ID, "Alicya")],
    });
    expect(questionOnly.selected).toEqual([]);

    const withRelation = selectSpeakers({
      userMessage: { content: "Tem algo a dizer?", senderCharacterId: USER_ID },
      participants: [ai(MAX_ID, "Max Verstappen"), user(USER_ID, "Alicya")],
      relationships: [{ characterAId: MAX_ID, characterBId: USER_ID }],
    });
    expect(withRelation.candidates[0].score).toBe(30);
    expect(withRelation.candidates[0].reasons).toContain("RELATION_RELEVANCE");
    expect(withRelation.selected).toEqual([MAX_ID]);
  });

  it("fronteira: responseOrchestrator exporta versão e função", () => {
    expect(responseOrchestrator.name).toBe(RESPONSE_ORCHESTRATOR_VERSION);
    expect(responseOrchestrator.selectSpeakers).toBe(selectSpeakers);
  });
});

describe("STEP 109E - ResponseOrchestrator memória/evento por relevância", () => {
  const duo = [ai(MAX_ID, "Max Verstappen"), user(USER_ID, "Alicya")];
  const questionOnly = (content: string, extra: Partial<ResponseOrchestratorInput> = {}) =>
    selectSpeakers({
      userMessage: { content },
      participants: extra.participants ?? duo,
      recentMessages: extra.recentMessages ?? [],
      relationships: extra.relationships ?? [],
      memories: extra.memories,
      events: extra.events,
    });

  it("1) memória direta eleva e, com pergunta, cruza o threshold", () => {
    const plain = selectSpeakers({
      userMessage: { content: "Vocês lembram daquele fim de semana?" },
      participants: duo,
      recentMessages: [],
      relationships: [],
    });
    expect(plain.candidates[0].score).toBe(10);
    expect(plain.selected).toEqual([]);

    const withMemory = questionOnly("Vocês lembram daquele fim de semana?", {
      memories: [{ participantCharacterIds: [MAX_ID] }],
    });
    const max = withMemory.candidates.find((c) => c.characterId === MAX_ID)!;
    expect(max.score).toBe(28); // 18 memória + 10 pergunta
    expect(max.selected).toBe(true);
    expect(max.reasons).toContain("MEMORY_RELEVANCE");
    expect(withMemory.selected).toEqual([MAX_ID]);
  });

  it("2) memória irrelevante (outro personagem) não eleva", () => {
    const result = questionOnly("Vocês lembram daquele fim de semana?", {
      memories: [{ participantCharacterIds: [LEWIS_ID] }],
    });
    expect(result.candidates[0].score).toBe(10);
    expect(result.selected).toEqual([]);
    expect(result.candidates[0].reasons).not.toContain("MEMORY_RELEVANCE");
  });

  it("3) memória da Alicya (USER) não eleva Max", () => {
    const result = questionOnly("Vocês lembram daquele fim de semana?", {
      memories: [{ participantCharacterIds: [USER_ID] }],
    });
    expect(result.candidates[0].score).toBe(10);
    expect(result.selected).toEqual([]);
  });

  it("4) evento direto eleva e, com pergunta, cruza o threshold", () => {
    const result = questionOnly("Vocês lembram daquele fim de semana?", {
      events: [{ participantCharacterIds: [MAX_ID] }],
    });
    expect(result.candidates[0].score).toBe(28); // 18 evento + 10 pergunta
    expect(result.selected).toEqual([MAX_ID]);
    expect(result.candidates[0].reasons).toContain("EVENT_RELEVANCE");
  });

  it("5) evento irrelevante (outro personagem) não eleva", () => {
    const result = questionOnly("Vocês lembram daquele fim de semana?", {
      events: [{ participantCharacterIds: [LEWIS_ID] }],
    });
    expect(result.candidates[0].score).toBe(10);
    expect(result.selected).toEqual([]);
    expect(result.candidates[0].reasons).not.toContain("EVENT_RELEVANCE");
  });

  it("6) tópico case-insensitive soma bônus dentro do cap", () => {
    const upper = questionOnly("Alguém lembra de MONZA?", {
      memories: [{ participantCharacterIds: [MAX_ID], content: "vitória inesquecível em Monza" }],
    });
    const control = questionOnly("Alguém lembra de MONZA?", {
      memories: [{ participantCharacterIds: [MAX_ID], content: "vitória inesquecível em Interlagos" }],
    });
    expect(upper.candidates[0].score).toBe(30); // 18+10 tópico = 28 → cap 20 → +10 pergunta
    expect(control.candidates[0].score).toBe(28);
  });

  it("7) tópico ignora diacríticos (Mônaco/monaco)", () => {
    const accented = questionOnly("Falam de Mônaco?", {
      memories: [{ participantCharacterIds: [MAX_ID], content: "vitória épica em monaco" }],
    });
    expect(accented.candidates[0].score).toBe(30);
  });

  it("8) conteúdo só de conectivos (stopwords) não gera bônus de tópico", () => {
    const result = questionOnly("O que houve ontem?", {
      memories: [{ participantCharacterIds: [MAX_ID], content: "o que de em a para" }],
    });
    expect(result.candidates[0].score).toBe(28); // 18 memória + 10 pergunta, sem tópico
  });

  it("9) importância (HIGH) pesa mais que recência", () => {
    const result = selectSpeakers({
      userMessage: { content: "Quem lembra de Monza?" },
      participants: [ai(MAX_ID, "Max Verstappen"), ai(CHARLES_ID, "Charles Leclerc"), user(USER_ID, "Alicya")],
      recentMessages: [{ characterId: CHARLES_ID, senderType: "AI_CHARACTER" }],
      memories: [{ participantCharacterIds: [MAX_ID], importance: "HIGH", content: "pista antiga" }],
      relationships: [],
    });
    const max = result.candidates.find((c) => c.characterId === MAX_ID)!;
    const charles = result.candidates.find((c) => c.characterId === CHARLES_ID)!;
    expect(max.score).toBe(30); // 10 pergunta + 18 memória + 4 HIGH = 22 → cap 20
    expect(max.selected).toBe(true);
    expect(charles.score).toBe(20); // 10 pergunta + 10 recência
    expect(charles.excludedReason).toBe("BELOW_THRESHOLD");
  });

  it("10) memória antiga continua relevante (createdAt não altera o escore)", () => {
    const old = questionOnly("Vocês lembram daquele fim de semana?", {
      memories: [{ participantCharacterIds: [MAX_ID], importance: "MEDIUM", createdAt: "2001-01-01T00:00:00.000Z" }],
    });
    const new1 = questionOnly("Vocês lembram daquele fim de semana?", {
      memories: [{ participantCharacterIds: [MAX_ID], importance: "MEDIUM", createdAt: "2026-09-17T00:00:00.000Z" }],
    });
    expect(new1).toStrictEqual(old);
    expect(old.candidates[0].score).toBe(28);
  });

  it("11) ausência de memória/evento não quebra a seleção", () => {
    const result = selectSpeakers({
      userMessage: { content: "Max Verstappen conte a história dessa volta" },
      participants: duo,
    });
    expect(result.candidates[0].score).toBe(100);
    expect(result.selected).toEqual([MAX_ID]);
    expect(result.candidates[0].reasons).toEqual(["DIRECT_MENTION"]);
  });

  it("12) MEMORY_RELEVANCE/EVENT_RELEVANCE surgem uma única vez cada", () => {
    const result = questionOnly("Vocês lembram e viram?", {
      memories: [
        { participantCharacterIds: [MAX_ID] },
        { participantCharacterIds: [MAX_ID, USER_ID], importance: "HIGH" },
      ],
      events: [{ participantCharacterIds: [MAX_ID] }],
    });
    const max = result.candidates.find((c) => c.characterId === MAX_ID)!;
    expect(max.reasons.filter((r) => r === "MEMORY_RELEVANCE")).toHaveLength(1);
    expect(max.reasons.filter((r) => r === "EVENT_RELEVANCE")).toHaveLength(1);
    expect(max.reasons.filter((r) => r === "QUESTION_RELEVANCE")).toHaveLength(1);
    expect(max.score).toBe(48); // 10 pergunta + 20 memória (teto) + 18 evento
  });

  it("13) determinismo com memória/evento, participantes embaralhados", () => {
    const build = (participants: ResponseOrchestratorInput["participants"]): ResponseOrchestratorInput => ({
      userMessage: { content: "Quem lembra de Monza?" },
      participants,
      recentMessages: [{ characterId: MAX_ID, senderType: "AI_CHARACTER" }],
      memories: [{ participantCharacterIds: [MAX_ID], importance: "HIGH", content: "pista antiga" }],
      events: [{ participantCharacterIds: [CHARLES_ID], title: "GP passado" }],
      relationships: [],
    });
    const ordered = build([ai(MAX_ID, "Max Verstappen"), ai(CHARLES_ID, "Charles Leclerc"), user(USER_ID, "Alicya")]);
    const shuffled = build([user(USER_ID, "Alicya"), ai(CHARLES_ID, "Charles Leclerc"), ai(MAX_ID, "Max Verstappen")]);
    expect(selectSpeakers(shuffled)).toStrictEqual(selectSpeakers(ordered));
  });

  it("14) contribuição de memória respeita o cap (20) e maxResponders", () => {
    const result = selectSpeakers({
      userMessage: { content: "Vocês lembram da vitória em Monza?" },
      participants: [ai(MAX_ID, "Max Verstappen"), ai(CHARLES_ID, "Charles Leclerc"), user(USER_ID, "Alicya")],
      recentMessages: [],
      relationships: [],
      memories: [
        { participantCharacterIds: [MAX_ID], importance: "HIGH", content: "vitória inesquecível em Monza" },
        { participantCharacterIds: [CHARLES_ID], content: "outra noite chuvosa" },
      ],
      config: { maxResponders: 1 },
    });
    const max = result.candidates.find((c) => c.characterId === MAX_ID)!;
    const charles = result.candidates.find((c) => c.characterId === CHARLES_ID)!;
    expect(max.score).toBe(30); // 18+10 tópico+4 HIGH = 32 → cap 20 → +10 pergunta
    expect(max.selected).toBe(true);
    expect(charles.score).toBe(28); // 18 + 10
    expect(charles.excludedReason).toBe("CAP_REACHED");
  });

  it("15) menção direta tem prioridade sobre memória", () => {
    const result = selectSpeakers({
      userMessage: { content: "Max Verstappen, conte!" },
      participants: [ai(MAX_ID, "Max Verstappen"), ai(CHARLES_ID, "Charles Leclerc")],
      memories: [
        { participantCharacterIds: [MAX_ID] },
        { participantCharacterIds: [CHARLES_ID] },
      ],
    });
    expect(result.candidates.map((c) => c.score)).toEqual([118, 18]); // 100 + 18 vs 18
    expect(result.selected).toEqual([MAX_ID]);
    expect(result.candidates[0].reasons).toContain("DIRECT_MENTION");
  });

  it("16) relação + memória combinam (10 + 20 + 18 = 48)", () => {
    const result = selectSpeakers({
      userMessage: { content: "Vocês têm algo a dizer?", senderCharacterId: USER_ID },
      participants: [ai(MAX_ID, "Max Verstappen"), user(USER_ID, "Alicya")],
      relationships: [{ characterAId: USER_ID, characterBId: MAX_ID }],
      memories: [{ participantCharacterIds: [MAX_ID] }],
    });
    expect(result.candidates[0].score).toBe(48);
    expect(result.selected).toEqual([MAX_ID]);
    expect(result.candidates[0].reasons).toEqual([
      "QUESTION_RELEVANCE",
      "RELATION_RELEVANCE",
      "MEMORY_RELEVANCE",
    ]);
  });

  it("17) memória não substitui menção direta (é aditiva)", () => {
    const result = selectSpeakers({
      userMessage: { content: "Max Verstappen, você lembra?" },
      participants: duo,
      memories: [{ participantCharacterIds: [MAX_ID] }],
    });
    const max = result.candidates[0];
    expect(max.score).toBe(128); // 100 + 10 + 18
    expect(max.reasons).toEqual([
      "DIRECT_MENTION",
      "QUESTION_RELEVANCE",
      "MEMORY_RELEVANCE",
    ]);
  });

  it("18) mesma entrada → mesma saída (strict, com campos ricos)", () => {
    const input: ResponseOrchestratorInput = {
      userMessage: { content: "Quem lembrou de Monza?" },
      participants: [ai(MAX_ID, "Max Verstappen"), ai(CHARLES_ID, "Charles Leclerc"), user(USER_ID, "Alicya")],
      recentMessages: [{ characterId: MAX_ID, senderType: "AI_CHARACTER" }],
      memories: [{ participantCharacterIds: [MAX_ID], importance: "HIGH", content: "vitória em Monza", createdAt: "2020-01-01T00:00:00.000Z" }],
      events: [{ participantCharacterIds: [CHARLES_ID], title: "GP antigo", description: "pista" }],
      relationships: [],
    };
    expect(selectSpeakers(input)).toStrictEqual(selectSpeakers(input));
  });
});