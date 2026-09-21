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
      memories: [{ participantCharacterIds: [MAX_ID, USER_ID], content: "você viu o que aconteceu no treino" }],
      events: [{ participantCharacterIds: [MAX_ID], title: "viu o que aconteceu com os carros" }],
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

  it("1) memória direta eleva e, com pergunta, cruza o threshold (Modelo 1a: exige tópico)", () => {
    const plain = selectSpeakers({
      userMessage: { content: "Vocês lembram daquele fim de semana?" },
      participants: duo,
      recentMessages: [],
      relationships: [],
    });
    expect(plain.candidates[0].score).toBe(10);
    expect(plain.selected).toEqual([]);

    const noTopic = questionOnly("Vocês lembram daquele fim de semana?", {
      memories: [{ participantCharacterIds: [MAX_ID] }],
    });
    const maxZero = noTopic.candidates.find((c) => c.characterId === MAX_ID)!;
    expect(maxZero.score).toBe(10); // só pergunta; memória sem tópico = 0
    expect(maxZero.reasons).not.toContain("MEMORY_RELEVANCE");
    expect(noTopic.selected).toEqual([]);

    const withMemory = questionOnly("O que vocês acharam do treino de pit stop?", {
      memories: [{ participantCharacterIds: [MAX_ID], content: "treino de pit stop conjunto na sexta" }],
    });
    const max = withMemory.candidates.find((c) => c.characterId === MAX_ID)!;
    expect(max.score).toBe(30); // 10 pergunta + 20 memória (18+10 tópico → cap 20)
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

  it("4) evento direto eleva e, com pergunta, cruza o threshold (Modelo 1a: exige tópico)", () => {
    const noTopic = questionOnly("Vocês lembram daquele fim de semana?", {
      events: [{ participantCharacterIds: [MAX_ID] }],
    });
    const maxZero = noTopic.candidates.find((c) => c.characterId === MAX_ID)!;
    expect(maxZero.score).toBe(10); // só pergunta; evento sem tópico = 0
    expect(maxZero.reasons).not.toContain("EVENT_RELEVANCE");
    expect(noTopic.selected).toEqual([]);

    const withEvent = questionOnly("O que vocês acharam do treino de pit stop?", {
      events: [{ participantCharacterIds: [MAX_ID], title: "treino de pit stop conjunto" }],
    });
    const max = withEvent.candidates.find((c) => c.characterId === MAX_ID)!;
    expect(max.score).toBe(30); // 10 pergunta + 20 evento (18+10 tópico → cap 20)
    expect(max.selected).toBe(true);
    expect(max.reasons).toContain("EVENT_RELEVANCE");
    expect(withEvent.selected).toEqual([MAX_ID]);
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
    expect(control.candidates[0].score).toBe(10); // tópico não casa → memória = 0, só pergunta
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
    expect(result.candidates[0].score).toBe(10); // só pergunta; conteúdo só de stopwords → sem tópico
  });

  it("9) importância (HIGH) pesa mais que recência", () => {
    const result = selectSpeakers({
      userMessage: { content: "Quem lembra de Monza?" },
      participants: [ai(MAX_ID, "Max Verstappen"), ai(CHARLES_ID, "Charles Leclerc"), user(USER_ID, "Alicya")],
      recentMessages: [{ characterId: CHARLES_ID, senderType: "AI_CHARACTER" }],
      memories: [{ participantCharacterIds: [MAX_ID], importance: "HIGH", content: "pista antiga de Monza" }],
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
      memories: [{ participantCharacterIds: [MAX_ID], importance: "MEDIUM", content: "retiro no fim de semana", createdAt: "2001-01-01T00:00:00.000Z" }],
    });
    const new1 = questionOnly("Vocês lembram daquele fim de semana?", {
      memories: [{ participantCharacterIds: [MAX_ID], importance: "MEDIUM", content: "retiro no fim de semana", createdAt: "2026-09-17T00:00:00.000Z" }],
    });
    expect(new1).toStrictEqual(old);
    expect(old.candidates[0].score).toBe(30); // 10 pergunta + 20 memória (18+10 tópico → cap 20)
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
    const result = questionOnly("O que vocês acharam do treino de pit stop?", {
      memories: [
        { participantCharacterIds: [MAX_ID], content: "treino de pit stop conjunto" },
        { participantCharacterIds: [MAX_ID, USER_ID], importance: "HIGH", content: "treino de pit stop na sexta" },
      ],
      events: [{ participantCharacterIds: [MAX_ID], title: "treino de pit stop", description: "pista" }],
    });
    const max = result.candidates.find((c) => c.characterId === MAX_ID)!;
    expect(max.reasons.filter((r) => r === "MEMORY_RELEVANCE")).toHaveLength(1);
    expect(max.reasons.filter((r) => r === "EVENT_RELEVANCE")).toHaveLength(1);
    expect(max.reasons.filter((r) => r === "QUESTION_RELEVANCE")).toHaveLength(1);
    expect(max.score).toBe(50); // 10 pergunta + 20 memória (teto) + 20 evento (teto)
  });

  it("13) determinismo com memória/evento, participantes embaralhados", () => {
    const build = (participants: ResponseOrchestratorInput["participants"]): ResponseOrchestratorInput => ({
      userMessage: { content: "Quem lembra de Monza?" },
      participants,
      recentMessages: [{ characterId: MAX_ID, senderType: "AI_CHARACTER" }],
      memories: [{ participantCharacterIds: [MAX_ID], importance: "HIGH", content: "pista antiga de Monza" }],
      events: [{ participantCharacterIds: [CHARLES_ID], title: "GP passado" }],
      relationships: [],
    });
    const ordered = build([ai(MAX_ID, "Max Verstappen"), ai(CHARLES_ID, "Charles Leclerc"), user(USER_ID, "Alicya")]);
    const shuffled = build([user(USER_ID, "Alicya"), ai(CHARLES_ID, "Charles Leclerc"), ai(MAX_ID, "Max Verstappen")]);
    expect(selectSpeakers(shuffled)).toStrictEqual(selectSpeakers(ordered));
  });

  it("14) contribuição de memória respeita o cap (20) e maxResponders", () => {
    const result = selectSpeakers({
      userMessage: { content: "Max, você lembra da vitória em Monza?" },
      participants: [ai(MAX_ID, "Max Verstappen"), ai(CHARLES_ID, "Charles Leclerc"), user(USER_ID, "Alicya")],
      recentMessages: [],
      relationships: [],
      memories: [
        { participantCharacterIds: [MAX_ID], importance: "HIGH", content: "vitória inesquecível em Monza" },
        { participantCharacterIds: [CHARLES_ID], content: "noite em Monza" },
      ],
      config: { maxResponders: 1 },
    });
    const max = result.candidates.find((c) => c.characterId === MAX_ID)!;
    const charles = result.candidates.find((c) => c.characterId === CHARLES_ID)!;
    expect(max.score).toBe(90); // 60 menção + 10 pergunta + 20 memória (32 → cap 20)
    expect(max.selected).toBe(true);
    expect(charles.score).toBe(30); // 10 pergunta + 20 memória (28 → cap 20)
    expect(charles.excludedReason).toBe("CAP_REACHED");
  });

  it("15) menção direta tem prioridade sobre memória (sem tópico a memória não compete)", () => {
    const result = selectSpeakers({
      userMessage: { content: "Max Verstappen, conte!" },
      participants: [ai(MAX_ID, "Max Verstappen"), ai(CHARLES_ID, "Charles Leclerc")],
      memories: [
        { participantCharacterIds: [MAX_ID] },
        { participantCharacterIds: [CHARLES_ID] },
      ],
    });
    expect(result.candidates.map((c) => c.score)).toEqual([100, -100]); // menção 100 vs sem sinal
    expect(result.selected).toEqual([MAX_ID]);
    expect(result.candidates[0].reasons).toContain("DIRECT_MENTION");
    expect(result.candidates[1].excludedReason).toBe("NO_SIGNALS");
  });

  it("16) relação + memória topical combinam (10 + 20 + 20 = 50)", () => {
    const result = selectSpeakers({
      userMessage: { content: "Vocês têm algo a dizer sobre o treino de pit stop?", senderCharacterId: USER_ID },
      participants: [ai(MAX_ID, "Max Verstappen"), user(USER_ID, "Alicya")],
      relationships: [{ characterAId: USER_ID, characterBId: MAX_ID }],
      memories: [{ participantCharacterIds: [MAX_ID], content: "treino de pit stop conjunto na sexta" }],
    });
    expect(result.candidates[0].score).toBe(50);
    expect(result.selected).toEqual([MAX_ID]);
    expect(result.candidates[0].reasons).toEqual([
      "QUESTION_RELEVANCE",
      "RELATION_RELEVANCE",
      "MEMORY_RELEVANCE",
    ]);
  });

  it("17) memória não substitui menção direta (é aditiva, com tópico)", () => {
    const result = selectSpeakers({
      userMessage: { content: "Max Verstappen, você lembra do treino de pit stop?" },
      participants: duo,
      memories: [{ participantCharacterIds: [MAX_ID], content: "treino de pit stop conjunto na sexta" }],
    });
    const max = result.candidates[0];
    expect(max.score).toBe(130); // 100 + 10 + 20
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

describe("STEP 109I-B - ResponseOrchestrator zero-responder / response-opportunity", () => {
  const duo = [ai(MAX_ID, "Max Verstappen"), user(USER_ID, "Alicya")];
  const farewellText = "Boa noite pessoal, até amanhã.";
  const greetingText = "Bom dia, gente.";

  it("1) despedida sem sinal de resposta → 0 responders, mesmo com memória/evento (sem tópico = 0)", () => {
    const selection = selectSpeakers({
      userMessage: { content: farewellText },
      participants: duo,
      recentMessages: [],
      relationships: [],
      memories: [{ participantCharacterIds: [MAX_ID] }],
      events: [{ participantCharacterIds: [MAX_ID] }],
    });
    expect(selection.selected).toEqual([]);
    const max = selection.candidates[0];
    expect(max.score).toBe(-100);
    expect(max.excludedReason).toBe("NO_SIGNALS");
    expect(max.reasons).toEqual(["NO_SIGNALS_PENALTY"]);
  });

  it("2) saudação genérica → memória/evento sem tópico não selecionam (NO_SIGNALS possível)", () => {
    const selection = selectSpeakers({
      userMessage: { content: greetingText },
      participants: duo,
      recentMessages: [],
      relationships: [],
      memories: [{ participantCharacterIds: [MAX_ID] }],
      events: [{ participantCharacterIds: [MAX_ID] }],
    });
    const max = selection.candidates[0];
    expect(max.score).toBe(-100);
    expect(max.excludedReason).toBe("NO_SIGNALS");
    expect(max.reasons).toEqual(["NO_SIGNALS_PENALTY"]);
    expect(selection.selected).toEqual([]);
  });

  it("3) despedida com menção direta → o mencionado permanece selecionável", () => {
    const selection = selectSpeakers({
      userMessage: { content: "Tchau, Max! Até amanhã." },
      participants: [ai(MAX_ID, "Max Verstappen"), ai(CHARLES_ID, "Charles Leclerc"), user(USER_ID, "Alicya")],
      recentMessages: [],
      relationships: [],
      memories: [{ participantCharacterIds: [MAX_ID] }, { participantCharacterIds: [CHARLES_ID] }],
      events: [{ participantCharacterIds: [MAX_ID] }, { participantCharacterIds: [CHARLES_ID] }],
    });
    const max = selection.candidates.find((c) => c.characterId === MAX_ID)!;
    const charles = selection.candidates.find((c) => c.characterId === CHARLES_ID)!;
    expect(max.reasons).toContain("DIRECT_MENTION");
    expect(max.score).toBe(60); // menção 60; memória/evento sem tópico = 0
    expect(max.selected).toBe(true);
    expect(charles.score).toBe(-100);
    expect(charles.excludedReason).toBe("NO_SIGNALS");
    expect(selection.selected).toEqual([MAX_ID]);
  });

  it("4) despedida com pergunta sobre tópico lembrado → responder permanece", () => {
    const selection = selectSpeakers({
      userMessage: { content: "Boa noite pessoal, alguém lembra do treino de pit stop?" },
      participants: duo,
      recentMessages: [],
      relationships: [],
      memories: [{ participantCharacterIds: [MAX_ID], content: "treino de pit stop conjunto na sexta" }],
      events: [],
    });
    const max = selection.candidates[0];
    expect(max.reasons).toContain("QUESTION_RELEVANCE");
    expect(max.reasons).toContain("MEMORY_RELEVANCE");
    expect(max.score).toBe(30); // 10 pergunta + 20 memória (tema casa)
    expect(max.excludedReason).toBeUndefined();
    expect(selection.selected).toEqual([MAX_ID]);
  });

  it("5) memória/evento sem tópico não criam oportunidade; saudação também não", () => {
    const participants = [ai(MAX_ID, "Max Verstappen"), ai(CHARLES_ID, "Charles Leclerc"), user(USER_ID, "Alicya")];
    const signals = {
      recentMessages: [],
      relationships: [],
      memories: [{ participantCharacterIds: [MAX_ID, CHARLES_ID] }],
      events: [{ participantCharacterIds: [MAX_ID, CHARLES_ID] }],
    };

    const noOpportunity = selectSpeakers({
      userMessage: { content: farewellText },
      participants,
      ...signals,
    });
    expect(noOpportunity.selected).toEqual([]);
    expect(
      noOpportunity.candidates.every((c) => c.excludedReason === "NO_SIGNALS"),
    ).toBe(true);

    const greeting = selectSpeakers({
      userMessage: { content: greetingText },
      participants,
      ...signals,
    });
    expect(greeting.selected).toEqual([]);
    expect(
      greeting.candidates.every((c) => c.excludedReason === "NO_SIGNALS"),
    ).toBe(true);
  });
});

describe("STEP 109L - gating contextual de memória/evento (Modelo 1a)", () => {
  const LUCA_ID = "c-luca";
  const MIA_ID = "c-mia";
  const RAVI_ID = "c-ravi";

  const trio = () => [
    ai(LUCA_ID, "Luca Astori"),
    ai(MIA_ID, "Mia Ferraz"),
    ai(RAVI_ID, "Ravi Mehta"),
    user(USER_ID, "Alicya"),
  ];

  const M_TREINO = {
    participantCharacterIds: [LUCA_ID, MIA_ID],
    content: "Treino de pit stop conjunto na sexta com troca de pneus.",
  };
  const M_JANELA = {
    participantCharacterIds: [LUCA_ID, MIA_ID],
    importance: "LOW" as const,
    content: "Janela de oportunidade no pit stop durante o GP de Mônaco na curva inicial.",
  };
  const EV_MONACO = {
    participantCharacterIds: [LUCA_ID],
    importance: "HIGH" as const,
    title: "Curva inicial movimentada no GP de Mônaco",
    description: "toque entre os carros",
  };

  it("1) saudação genérica com só participação em memória/evento → 0 responders (NO_SIGNALS)", () => {
    const selection = selectSpeakers({
      userMessage: { content: "Bom dia, gente.", senderCharacterId: USER_ID },
      participants: trio(),
      recentMessages: [],
      relationships: [],
      memories: [M_TREINO, M_JANELA],
      events: [EV_MONACO],
    });
    expect(selection.selected).toEqual([]);
    const luca = selection.candidates.find((c) => c.characterId === LUCA_ID)!;
    const mia = selection.candidates.find((c) => c.characterId === MIA_ID)!;
    expect(luca.score).toBe(-100);
    expect(luca.excludedReason).toBe("NO_SIGNALS");
    expect(mia.score).toBe(-100);
    expect(mia.excludedReason).toBe("NO_SIGNALS");
    expect(mia.reasons).not.toContain("MEMORY_RELEVANCE");
    expect(mia.reasons).not.toContain("EVENT_RELEVANCE");
  });

  it("2) saudação com menção direta → o mencionado permanece selecionável", () => {
    const selection = selectSpeakers({
      userMessage: { content: "Bom dia, Luca!", senderCharacterId: USER_ID },
      participants: trio(),
      recentMessages: [],
      relationships: [],
      memories: [M_TREINO, M_JANELA],
      events: [EV_MONACO],
    });
    const luca = selection.candidates.find((c) => c.characterId === LUCA_ID)!;
    expect(luca.reasons).toContain("DIRECT_MENTION");
    expect(luca.score).toBe(60); // menção; memória/evento sem tópico = 0
    expect(luca.selected).toBe(true);
    expect(selection.selected).toEqual([LUCA_ID]);
  });

  it("3) saudação + relação/recência do remetente preserva comportamento não-membresia", () => {
    const selection = selectSpeakers({
      userMessage: { content: "Bom dia, gente.", senderCharacterId: USER_ID },
      participants: trio(),
      recentMessages: [
        { characterId: LUCA_ID, senderType: "AI_CHARACTER" },
        { characterId: MIA_ID, senderType: "AI_CHARACTER" },
      ],
      relationships: [{ characterAId: USER_ID, characterBId: LUCA_ID }],
      memories: [],
      events: [],
    });
    const luca = selection.candidates.find((c) => c.characterId === LUCA_ID)!;
    expect(luca.score).toBe(30); // 20 relação + 10 recência
    expect(luca.reasons).toContain("RELATION_RELEVANCE");
    expect(luca.reasons).toContain("RECENCY");
    expect(selection.selected).toEqual([LUCA_ID]);
  });

  it("4) menção direta → Luca selecionado; co-participante não selecionado só por membresia", () => {
    const selection = selectSpeakers({
      userMessage: { content: "Luca, me conta essa história de novo." },
      participants: trio(),
      recentMessages: [],
      relationships: [],
      memories: [M_TREINO, M_JANELA],
      events: [EV_MONACO],
    });
    const luca = selection.candidates.find((c) => c.characterId === LUCA_ID)!;
    const mia = selection.candidates.find((c) => c.characterId === MIA_ID)!;
    const ravi = selection.candidates.find((c) => c.characterId === RAVI_ID)!;
    expect(luca.score).toBe(60);
    expect(luca.selected).toBe(true);
    expect(mia.score).toBe(-100); // membresia sem tópico não cruza o threshold
    expect(mia.excludedReason).toBe("NO_SIGNALS");
    expect(ravi.excludedReason).toBe("NO_SIGNALS");
    expect(selection.selected).toEqual([LUCA_ID]);
  });

  it("5) pergunta sobre Mônaco → participantes com conexão topical continuam elegíveis (não singleton)", () => {
    const selection = selectSpeakers({
      userMessage: {
        content: "Luca, o que você acha que aconteceu na curva inicial do GP de Mônaco?",
        senderCharacterId: USER_ID,
      },
      participants: trio(),
      recentMessages: [],
      relationships: [{ characterAId: LUCA_ID, characterBId: MIA_ID }],
      memories: [M_TREINO, M_JANELA],
      events: [EV_MONACO],
    });
    const luca = selection.candidates.find((c) => c.characterId === LUCA_ID)!;
    const mia = selection.candidates.find((c) => c.characterId === MIA_ID)!;
    const ravi = selection.candidates.find((c) => c.characterId === RAVI_ID)!;
    expect(luca.score).toBe(110); // 60 menção + 10 pergunta + 20 memória + 20 evento
    expect(mia.score).toBe(50); // 10 pergunta + 20 memória + 20 evento (relacionada, topical)
    expect(mia.selected).toBe(true);
    expect(mia.reasons).toContain("EVENT_RELEVANCE");
    expect(mia.reasons).toContain("MEMORY_RELEVANCE");
    expect(ravi.score).toBe(10);
    expect(ravi.excludedReason).toBe("BELOW_THRESHOLD");
    expect([...selection.selected].sort()).toEqual([LUCA_ID, MIA_ID]);
  });

  it("6) pergunta topical compartilhada → múltiplos participantes com memória topical", () => {
    const selection = selectSpeakers({
      userMessage: { content: "O que vocês acharam do treino de pit stop?" },
      participants: trio(),
      recentMessages: [],
      relationships: [],
      memories: [M_TREINO, M_JANELA],
      events: [EV_MONACO],
    });
    const luca = selection.candidates.find((c) => c.characterId === LUCA_ID)!;
    const mia = selection.candidates.find((c) => c.characterId === MIA_ID)!;
    expect(luca.score).toBe(30); // 10 pergunta + 20 memória
    expect(mia.score).toBe(30);
    expect(luca.reasons).toContain("MEMORY_RELEVANCE");
    expect(mia.reasons).toContain("MEMORY_RELEVANCE");
    expect(mia.reasons).not.toContain("EVENT_RELEVANCE");
    expect([...selection.selected].sort()).toEqual([LUCA_ID, MIA_ID]);
  });

  it("7) afirmação topical sem pergunta/menção → membros não cruzam o threshold", () => {
    const selection = selectSpeakers({
      userMessage: { content: "O treino de pit stop foi bom." },
      participants: trio(),
      recentMessages: [],
      relationships: [],
      memories: [M_TREINO, M_JANELA],
      events: [EV_MONACO],
    });
    const luca = selection.candidates.find((c) => c.characterId === LUCA_ID)!;
    const mia = selection.candidates.find((c) => c.characterId === MIA_ID)!;
    expect(luca.score).toBe(20); // 20 memória < 25
    expect(luca.excludedReason).toBe("BELOW_THRESHOLD");
    expect(luca.reasons).toContain("MEMORY_RELEVANCE");
    expect(mia.score).toBe(20);
    expect(mia.excludedReason).toBe("BELOW_THRESHOLD");
    expect(selection.selected).toEqual([]);
  });

  it("8) um único token forte ainda ativa relevância de memória/evento (Mônaco)", () => {
    const selection = selectSpeakers({
      userMessage: { content: "Falam de Mônaco?" },
      participants: [ai(LUCA_ID, "Luca Astori"), ai(RAVI_ID, "Ravi Mehta"), user(USER_ID, "Alicya")],
      recentMessages: [],
      relationships: [],
      memories: [],
      events: [EV_MONACO],
    });
    const luca = selection.candidates.find((c) => c.characterId === LUCA_ID)!;
    expect(luca.reasons).toContain("EVENT_RELEVANCE");
    expect(luca.score).toBe(30); // 10 pergunta + 20 evento (monaco forte)
    expect(selection.selected).toEqual([LUCA_ID]);
  });

  it("9) caminho de participante relacionado atua somente com tópico", () => {
    const comTopico = selectSpeakers({
      userMessage: { content: "O que vocês lembram da curva inicial do GP de Mônaco?" },
      participants: trio(),
      recentMessages: [],
      relationships: [{ characterAId: LUCA_ID, characterBId: MIA_ID }],
      memories: [],
      events: [EV_MONACO],
    });
    const miaTop = comTopico.candidates.find((c) => c.characterId === MIA_ID)!;
    expect(miaTop.reasons).toContain("EVENT_RELEVANCE");
    expect(miaTop.score).toBe(30); // 10 pergunta + 20 evento (relacionada topical)
    expect([...comTopico.selected].sort()).toEqual([LUCA_ID, MIA_ID]);

    const semTopico = selectSpeakers({
      userMessage: { content: "A corrida foi boa." },
      participants: trio(),
      recentMessages: [],
      relationships: [{ characterAId: LUCA_ID, characterBId: MIA_ID }],
      memories: [],
      events: [EV_MONACO],
    });
    const miaSem = semTopico.candidates.find((c) => c.characterId === MIA_ID)!;
    expect(miaSem.reasons).not.toContain("EVENT_RELEVANCE");
    expect(miaSem.excludedReason).toBe("NO_SIGNALS");
    expect(semTopico.selected).toEqual([]);
  });

  it("10) despedida com recência preserva o gate de oportunidade (NO_RESPONSE_OPPORTUNITY)", () => {
    const selection = selectSpeakers({
      userMessage: { content: "Boa noite pessoal, até amanhã." },
      participants: trio(),
      recentMessages: [{ characterId: LUCA_ID, senderType: "AI_CHARACTER" }],
      relationships: [],
      memories: [],
      events: [],
    });
    const luca = selection.candidates.find((c) => c.characterId === LUCA_ID)!;
    expect(luca.reasons).toContain("RECENCY");
    expect(luca.reasons).not.toContain("NO_SIGNALS_PENALTY");
    expect(luca.excludedReason).toBe("NO_RESPONSE_OPPORTUNITY");
    expect(selection.selected).toEqual([]);
  });
});

describe("STEP 109N-2 - relevância topical não pode ser só nome de personagem (Modelo C)", () => {
  const LUCA_ID = "c-luca";
  const MIA_ID = "c-mia";
  const RAVI_ID = "c-ravi";

  const trio = () => [
    ai(LUCA_ID, "Luca Astori"),
    ai(MIA_ID, "Mia Ferraz"),
    ai(RAVI_ID, "Ravi Mehta"),
    user(USER_ID, "Alicya"),
  ];

  const M_TREINO_NAMED = {
    participantCharacterIds: [LUCA_ID, MIA_ID],
    content: "Mia e Luca fizeram treino de pit stop na sexta com troca de pneus.",
  };
  const M_JANELA_NAMED = {
    participantCharacterIds: [LUCA_ID, MIA_ID],
    content: "Luca e Mia discutiram a janela de oportunidade na curva inicial do GP de Mônaco.",
  };
  const EV_COLETIVA_NAMED = {
    participantCharacterIds: [LUCA_ID, MIA_ID],
    title: "Luca e Mia na coletiva",
    description: "entrevista sobre a temporada",
  };
  const EV_MONACO_NAMED = {
    participantCharacterIds: [LUCA_ID, MIA_ID],
    importance: "HIGH" as const,
    title: "Luca e Mia na curva inicial do GP de Mônaco",
    description: "toque entre os carros",
  };

  it("11) pergunta a Luca com memória/evento nomeados → Mia não recebe relevância só pelo nome", () => {
    const selection = selectSpeakers({
      userMessage: { content: "Luca, o que você acha disso?" },
      participants: trio(),
      recentMessages: [],
      relationships: [],
      memories: [M_TREINO_NAMED],
      events: [EV_COLETIVA_NAMED],
    });
    const luca = selection.candidates.find((c) => c.characterId === LUCA_ID)!;
    const mia = selection.candidates.find((c) => c.characterId === MIA_ID)!;
    expect(luca.reasons).toContain("DIRECT_MENTION");
    expect(luca.selected).toBe(true);
    expect(mia.reasons).not.toContain("MEMORY_RELEVANCE");
    expect(mia.reasons).not.toContain("EVENT_RELEVANCE");
    expect(mia.score).toBe(10);
    expect(mia.excludedReason).toBe("BELOW_THRESHOLD");
    expect(selection.selected).toEqual([LUCA_ID]);
  });

  it("12) nome apenas em memória compartilhada → co-participante sem sinal", () => {
    const selection = selectSpeakers({
      userMessage: { content: "Luca, me conta essa história de novo." },
      participants: trio(),
      recentMessages: [],
      relationships: [],
      memories: [M_TREINO_NAMED],
      events: [],
    });
    const mia = selection.candidates.find((c) => c.characterId === MIA_ID)!;
    expect(mia.score).toBe(-100);
    expect(mia.excludedReason).toBe("NO_SIGNALS");
    expect(mia.reasons).not.toContain("MEMORY_RELEVANCE");
  });

  it("13) tópico real com nomes no texto → co-participante relacionado continua elegível", () => {
    const selection = selectSpeakers({
      userMessage: { content: "Luca, o que aconteceu na curva inicial do GP de Mônaco?" },
      participants: trio(),
      recentMessages: [],
      relationships: [{ characterAId: LUCA_ID, characterBId: MIA_ID }],
      memories: [M_JANELA_NAMED],
      events: [],
    });
    const luca = selection.candidates.find((c) => c.characterId === LUCA_ID)!;
    const mia = selection.candidates.find((c) => c.characterId === MIA_ID)!;
    expect(luca.selected).toBe(true);
    expect(mia.reasons).toContain("MEMORY_RELEVANCE");
    expect(mia.selected).toBe(true);
    expect([...selection.selected].sort()).toEqual([LUCA_ID, MIA_ID]);
  });

  it("14) pergunta topical compartilhada com memória nomeada → múltiplos elegíveis", () => {
    const selection = selectSpeakers({
      userMessage: { content: "O que vocês acharam do treino de pit stop?" },
      participants: trio(),
      recentMessages: [],
      relationships: [],
      memories: [M_TREINO_NAMED],
      events: [],
    });
    const luca = selection.candidates.find((c) => c.characterId === LUCA_ID)!;
    const mia = selection.candidates.find((c) => c.characterId === MIA_ID)!;
    expect(luca.reasons).toContain("MEMORY_RELEVANCE");
    expect(mia.reasons).toContain("MEMORY_RELEVANCE");
    expect([...selection.selected].sort()).toEqual([LUCA_ID, MIA_ID]);
  });

  it("15) token forte não-nome ainda ativa evento nomeado", () => {
    const selection = selectSpeakers({
      userMessage: { content: "Falam de Mônaco?" },
      participants: trio(),
      recentMessages: [],
      relationships: [],
      memories: [],
      events: [EV_MONACO_NAMED],
    });
    const luca = selection.candidates.find((c) => c.characterId === LUCA_ID)!;
    const mia = selection.candidates.find((c) => c.characterId === MIA_ID)!;
    expect(luca.reasons).toContain("EVENT_RELEVANCE");
    expect(mia.reasons).toContain("EVENT_RELEVANCE");
    expect([...selection.selected].sort()).toEqual([LUCA_ID, MIA_ID]);
  });

  it("16) despedida: nome em memória não cria sinal topical (gate coerente)", () => {
    const selection = selectSpeakers({
      userMessage: { content: "Boa noite, Astori." },
      participants: trio(),
      recentMessages: [],
      relationships: [],
      memories: [{ participantCharacterIds: [LUCA_ID], content: "Luca Astori lidera o campeonato." }],
      events: [],
    });
    const luca = selection.candidates.find((c) => c.characterId === LUCA_ID)!;
    expect(luca.reasons).not.toContain("MEMORY_RELEVANCE");
    expect(luca.reasons).toContain("NO_SIGNALS_PENALTY");
    expect(luca.excludedReason).toBe("NO_SIGNALS");
    expect(selection.selected).toEqual([]);
  });

  it("17) despedida: tópico forte não-nome mantém o gate coerente", () => {
    const selection = selectSpeakers({
      userMessage: { content: "Boa noite, vamos falar de Mônaco." },
      participants: trio(),
      recentMessages: [],
      relationships: [],
      memories: [],
      events: [EV_MONACO_NAMED],
    });
    const luca = selection.candidates.find((c) => c.characterId === LUCA_ID)!;
    expect(luca.reasons).toContain("EVENT_RELEVANCE");
    expect(luca.excludedReason).toBe("BELOW_THRESHOLD");
    expect(selection.selected).toEqual([]);
  });
});