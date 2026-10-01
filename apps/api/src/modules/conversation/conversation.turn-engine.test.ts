import { describe, expect, it } from "vitest";

import {
  planConversationTurn,
  summarizeConversation,
  type ConversationTurnMessage,
  type ConversationTurnParticipant,
} from "./conversation.turn-engine.js";
import { conversationTurnLimits } from "./conversation.policy.js";

const LIMITS = {
  maxAiTurnsPerRound: 2,
  maxTotalAiMessages: 4,
  maxConsecutiveSameSpeaker: 2,
  inactivityTimeoutMs: 60 * 60 * 1000,
  maxSummaryChars: 120,
  recentMessageWindow: 12,
};

const WORLD_DATE = new Date("2026-10-01T12:00:00.000Z");

function participant(
  characterId: string,
  controller: "AI" | "USER",
  name: string,
  available = true,
): ConversationTurnParticipant {
  return { characterId, name, controller, universeId: "u1", available };
}

function message(
  senderType: "AI_CHARACTER" | "USER_CHARACTER",
  characterId: string | null,
  content: string,
  minutesAgo: number,
): ConversationTurnMessage {
  return {
    senderType,
    characterId,
    content,
    createdAt: new Date(WORLD_DATE.getTime() - minutesAgo * 60 * 1000),
  };
}

const PARTICIPANTS = [
  participant("c1", "AI", "Alicya"),
  participant("c2", "AI", "Max"),
  participant("c3", "USER", "Usuário"),
];

describe("conversation turn engine (pure)", () => {
  it("1) seleciona participante mencionado diretamente", () => {
    const plan = planConversationTurn({
      status: "ACTIVE",
      participants: PARTICIPANTS,
      messages: [message("AI_CHARACTER", "c1", "O que acha, Max?", 1)],
      worldDate: WORLD_DATE,
      limits: LIMITS,
    });
    expect(plan.canContinue).toBe(true);
    expect(plan.speakerCharacterId).toBe("c2");
    expect(plan.speakerReasonCode).toBe("DIRECT_MENTION");
  });

  it("2) alterna para o próximo participante após o último speaker", () => {
    const plan = planConversationTurn({
      status: "ACTIVE",
      participants: PARTICIPANTS,
      messages: [message("AI_CHARACTER", "c1", "Mensagem neutra.", 1)],
      worldDate: WORLD_DATE,
      limits: LIMITS,
    });
    expect(plan.speakerCharacterId).toBe("c2");
    expect(plan.speakerReasonCode).toBe("NEXT_PARTICIPANT");
  });

  it("3) respeita o limite de turnos por rodada", () => {
    const plan = planConversationTurn({
      status: "ACTIVE",
      participants: PARTICIPANTS,
      messages: [
        message("USER_CHARACTER", "c3", "Pergunta.", 10),
        message("AI_CHARACTER", "c1", "Resposta 1.", 9),
        message("AI_CHARACTER", "c2", "Resposta 2.", 8),
      ],
      worldDate: WORLD_DATE,
      limits: LIMITS,
    });
    expect(plan.canContinue).toBe(false);
    expect(plan.reasonCode).toBe("TURN_BUDGET_EXHAUSTED");
  });

  it("4) respeita o limite total de mensagens de IA", () => {
    const plan = planConversationTurn({
      status: "ACTIVE",
      participants: PARTICIPANTS,
      messages: [
        message("AI_CHARACTER", "c1", "a", 20),
        message("USER_CHARACTER", "c3", "b", 19),
        message("AI_CHARACTER", "c2", "c", 18),
        message("USER_CHARACTER", "c3", "d", 17),
        message("AI_CHARACTER", "c1", "e", 16),
        message("USER_CHARACTER", "c3", "f", 15),
        message("AI_CHARACTER", "c2", "g", 14),
      ],
      worldDate: WORLD_DATE,
      limits: LIMITS,
    });
    expect(plan.canContinue).toBe(false);
    expect(plan.reasonCode).toBe("CONVERSATION_BUDGET_EXHAUSTED");
  });

  it("5) bloqueia quando o mesmo speaker estourou o limite consecutivo", () => {
    const plan = planConversationTurn({
      status: "ACTIVE",
      participants: [participant("c1", "AI", "Solo")],
      messages: [
        message("AI_CHARACTER", "c1", "a", 3),
        message("AI_CHARACTER", "c1", "b", 2),
        message("AI_CHARACTER", "c1", "c", 1),
      ],
      worldDate: WORLD_DATE,
      limits: { ...LIMITS, maxAiTurnsPerRound: 10, maxTotalAiMessages: 10 },
    });
    expect(plan.canContinue).toBe(false);
    expect(plan.reasonCode).toBe("SAME_SPEAKER_LIMIT");
    expect(plan.budget.consecutiveSameSpeaker).toBe(3);
  });

  it("6) conversa inativa não continua", () => {
    const plan = planConversationTurn({
      status: "ACTIVE",
      participants: PARTICIPANTS,
      messages: [message("AI_CHARACTER", "c1", "Antiga.", 120)],
      worldDate: WORLD_DATE,
      limits: LIMITS,
    });
    expect(plan.canContinue).toBe(false);
    expect(plan.reasonCode).toBe("CONVERSATION_INACTIVE");
  });

  it("7) conversa pausada não continua", () => {
    const plan = planConversationTurn({
      status: "PAUSED",
      participants: PARTICIPANTS,
      messages: [message("AI_CHARACTER", "c1", "Oi.", 1)],
      worldDate: WORLD_DATE,
      limits: LIMITS,
    });
    expect(plan.reasonCode).toBe("CONVERSATION_NOT_ACTIVE");
  });

  it("8) sem participante de IA não há turno autônomo", () => {
    const plan = planConversationTurn({
      status: "ACTIVE",
      participants: [participant("c3", "USER", "Usuário")],
      messages: [message("USER_CHARACTER", "c3", "Oi.", 1)],
      worldDate: WORLD_DATE,
      limits: LIMITS,
    });
    expect(plan.reasonCode).toBe("NO_AI_PARTICIPANT");
  });

  it("9) participante indisponível é excluído da seleção", () => {
    const plan = planConversationTurn({
      status: "ACTIVE",
      participants: [
        participant("c1", "AI", "Alicya", false),
        participant("c2", "AI", "Max", true),
      ],
      messages: [message("AI_CHARACTER", "c1", "Oi.", 1)],
      worldDate: WORLD_DATE,
      limits: LIMITS,
    });
    expect(plan.speakerCharacterId).toBe("c2");
  });

  it("10) sumário é determinístico e limitado", () => {
    const messages = [
      message("USER_CHARACTER", "c3", "Primeira mensagem.", 5),
      message("AI_CHARACTER", "c1", "Resposta curta.", 4),
    ];
    const first = summarizeConversation(messages, 120);
    const second = summarizeConversation(messages, 120);
    expect(first).toBe(second);
    expect(first.length).toBeLessThanOrEqual(120);
    expect(first).toContain("Resposta curta.");

    const long = summarizeConversation(
      [message("USER_CHARACTER", "c3", "Texto muito longo ".repeat(30), 1)],
      60,
    );
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith("…")).toBe(true);
  });

  it("11) limites padrão são positivos e configuráveis", () => {
    const defaults = conversationTurnLimits();
    expect(defaults.maxAiTurnsPerRound).toBeGreaterThan(0);
    expect(defaults.maxConsecutiveSameSpeaker).toBeGreaterThan(0);
    process.env.CONVERSATION_MAX_AI_TURNS_PER_ROUND = "7";
    try {
      expect(conversationTurnLimits().maxAiTurnsPerRound).toBe(7);
    } finally {
      delete process.env.CONVERSATION_MAX_AI_TURNS_PER_ROUND;
    }
  });
});
