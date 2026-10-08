import { describe, expect, it } from "vitest";

import {
  detectExplicitTargets,
  selectResponseCandidates,
  type ResponseEngineMessage,
  type ResponseEngineParticipant,
} from "./conversation.response-engine.js";

const WORLD_DATE = new Date("2026-10-01T12:00:00.000Z");

function participant(
  id: string,
  name: string,
  controller: "AI" | "USER" = "AI",
  available = true,
): ResponseEngineParticipant {
  return { characterId: id, name, controller, available };
}

function message(
  id: string,
  characterId: string | null,
  content: string,
  senderType: "AI_CHARACTER" | "USER_CHARACTER" = "USER_CHARACTER",
  replyToMessageId: string | null = null,
): ResponseEngineMessage {
  return {
    id,
    senderType,
    characterId,
    content,
    createdAt: WORLD_DATE,
    replyToMessageId,
  };
}

const SEED = {
  universeId: "u1",
  conversationId: "c1",
  lastMessageId: "m1",
  worldDate: WORLD_DATE,
};

const LIMITS = { maxResponders: 2, minScore: 18 };

const GROUP = [
  participant("kimi", "Andrea Kimi Antonelli"),
  participant("max", "Max Verstappen"),
  participant("charles", "Charles Leclerc"),
  participant("albon", "Alexander Albon"),
  participant("arvid", "Arvid Lindblad"),
];

describe("F22 — prioridade de speaker em conversa de grupo", () => {
  it("1) menção direta no início prioriza o personagem citado", () => {
    const result = selectResponseCandidates({
      participants: GROUP,
      messages: [message("m1", "alicya", "Kimi, você viu isso?")],
      depth: 0,
      alreadyResponded: [],
      seed: SEED,
      limits: LIMITS,
    });
    expect(result.selected[0]?.characterId).toBe("kimi");
    expect(result.selected[0]?.reasons).toContain("DIRECT_MENTION");
    expect(result.selected.map((candidate) => candidate.characterId)).toEqual(["kimi"]);
  });

  it("2) nome no final com pergunta também é endereçamento direto", () => {
    const result = selectResponseCandidates({
      participants: GROUP,
      messages: [message("m1", "alicya", "mds o que Kimi?")],
      depth: 0,
      alreadyResponded: [],
      seed: SEED,
      limits: LIMITS,
    });
    expect(result.selected[0]?.characterId).toBe("kimi");
    expect(result.selected[0]?.reasons).toContain("DIRECT_MENTION");
  });

  it("3) reply direto a uma mensagem de IA prioriza o autor respondido", () => {
    const result = selectResponseCandidates({
      participants: GROUP,
      messages: [
        message("m0", "kimi", "Você não vai fazer isso.", "AI_CHARACTER"),
        message("m1", "alicya", "Vou sim.", "USER_CHARACTER", "m0"),
      ],
      depth: 0,
      alreadyResponded: [],
      seed: SEED,
      limits: LIMITS,
    });
    expect(result.selected[0]?.characterId).toBe("kimi");
    expect(result.selected[0]?.reasons).toContain("REPLY_TARGET");
  });

  it("4) outro piloto chamado tem prioridade (Max, não Kimi)", () => {
    const result = selectResponseCandidates({
      participants: GROUP,
      messages: [message("m1", "alicya", "Max, você faria isso?")],
      depth: 0,
      alreadyResponded: [],
      seed: SEED,
      limits: LIMITS,
    });
    expect(result.selected[0]?.characterId).toBe("max");
    expect(result.selected[0]?.reasons).toContain("DIRECT_MENTION");
    expect(result.selected[0]?.characterId).not.toBe("kimi");
  });

  it("5) sem target não força ninguém específico", () => {
    const result = selectResponseCandidates({
      participants: GROUP,
      messages: [message("m1", "alicya", "bom dia")],
      depth: 0,
      alreadyResponded: [],
      seed: SEED,
      limits: LIMITS,
    });
    expect(result.selected.length).toBeLessThanOrEqual(LIMITS.maxResponders);
    expect(
      result.selected.every((candidate) => !candidate.reasons.includes("DIRECT_MENTION")),
    ).toBe(true);
  });

  it("6) depois do alvo responder, o turno pode terminar sem avalanche", () => {
    const result = selectResponseCandidates({
      participants: GROUP,
      messages: [
        message("m0", "alicya", "Kimi, o que foi isso?"),
        message("m1", "kimi", "Nada.", "AI_CHARACTER"),
      ],
      depth: 1,
      alreadyResponded: ["kimi"],
      seed: SEED,
      limits: { maxResponders: 1, minScore: 26 },
    });
    expect(result.selected).toHaveLength(0);
    expect(result.stopReason).toBe("NO_RESPONSE_OPPORTUNITY");
  });

  it("7) intervenção contextual é permitida com engajamento no tópico", () => {
    const result = selectResponseCandidates({
      participants: GROUP,
      messages: [
        message("m0", "alicya", "Kimi, você fez isso?"),
        message("m1", "kimi", "Não fui eu.", "AI_CHARACTER"),
      ],
      depth: 1,
      alreadyResponded: ["kimi"],
      recentAiMessages: [{ characterId: "max", content: "eu não fui, mas vi tudo" }],
      seed: SEED,
      limits: { maxResponders: 1, minScore: 26 },
    });
    expect(result.selected[0]?.characterId).toBe("max");
    expect(result.selected[0]?.reasons).toContain("TOPIC_ENGAGEMENT");
  });

  it("8) menção indireta é assunto, não endereçamento direto", () => {
    const result = selectResponseCandidates({
      participants: GROUP,
      messages: [message("m1", "alicya", "Eu acho que o Kimi vai reclamar disso.")],
      depth: 0,
      alreadyResponded: [],
      seed: SEED,
      limits: LIMITS,
    });
    const kimi = result.candidates.find((candidate) => candidate.characterId === "kimi");
    expect(kimi?.reasons).toContain("SUBJECT_MENTION");
    expect(kimi?.reasons).not.toContain("DIRECT_MENTION");
  });

  it("detecta nome do meio e sobrenome dos pilotos", () => {
    const matches = detectExplicitTargets("Kimi e Albon, vocês viram?", GROUP);
    expect(matches.map((match) => match.characterId).sort()).toEqual(["albon", "kimi"]);
  });
});
