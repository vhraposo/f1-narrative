import { describe, expect, it } from "vitest";

import {
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
  minutesAgo = 1,
): ResponseEngineMessage {
  return {
    id,
    senderType,
    characterId,
    content,
    createdAt: new Date(WORLD_DATE.getTime() - minutesAgo * 60 * 1000),
  };
}

const SEED = {
  universeId: "u1",
  conversationId: "c1",
  lastMessageId: "m1",
  worldDate: WORLD_DATE,
};

const LIMITS = { maxResponders: 1, minScore: 18 };

describe("conversation response engine (determinístico)", () => {
  it("1) menção direta prioriza o personagem citado", () => {
    const result = selectResponseCandidates({
      participants: [participant("a1", "Kimi Antonelli"), participant("m1", "Max Verstappen")],
      messages: [message("m1", "user", "Kimi preciso de ajuda")],
      depth: 0,
      alreadyResponded: [],
      seed: SEED,
      limits: LIMITS,
    });
    expect(result.selected[0]?.characterId).toBe("a1");
    expect(result.selected[0]?.reasons).toContain("DIRECT_MENTION");
  });

  it("2) USER nunca é candidato", () => {
    const result = selectResponseCandidates({
      participants: [
        participant("u1", "Alicya", "USER"),
        participant("a1", "Kimi Antonelli", "AI"),
      ],
      messages: [message("m1", "u1", "Bom dia")],
      depth: 0,
      alreadyResponded: [],
      seed: SEED,
      limits: LIMITS,
    });
    expect(result.candidates.every((candidate) => candidate.characterId !== "u1")).toBe(true);
    expect(result.rejected.some((candidate) => candidate.characterId === "u1")).toBe(false);
  });

  it("3) personagem indisponível é rejeitado", () => {
    const result = selectResponseCandidates({
      participants: [participant("a1", "Kimi", "AI", false), participant("b1", "Max")],
      messages: [message("m1", "user", "Oi")],
      depth: 0,
      alreadyResponded: [],
      seed: SEED,
      limits: LIMITS,
    });
    expect(result.rejected.find((candidate) => candidate.characterId === "a1")?.reasons).toContain(
      "UNAVAILABLE",
    );
  });

  it("4) quem falou por último recebe penalidade", () => {
    const result = selectResponseCandidates({
      participants: [participant("a1", "Kimi"), participant("b1", "Max")],
      messages: [message("m1", "a1", "Oi pessoal", "AI_CHARACTER")],
      depth: 0,
      alreadyResponded: [],
      seed: SEED,
      limits: LIMITS,
    });
    const kimi = result.candidates.find((candidate) => candidate.characterId === "a1");
    expect(kimi?.reasons).toContain("RECENTLY_SPOKE");
    const max = result.candidates.find((candidate) => candidate.characterId === "b1");
    expect((max?.score ?? 0) > (kimi?.score ?? 0)).toBe(true);
  });

  it("5) mesma entrada + mesma seed produz a mesma seleção", () => {
    const input = {
      participants: [participant("a1", "Kimi"), participant("b1", "Max"), participant("c1", "Lando")],
      messages: [message("m1", "user", "Bom dia")],
      depth: 0,
      alreadyResponded: [] as string[],
      seed: SEED,
      limits: LIMITS,
    };
    const first = selectResponseCandidates(input);
    const second = selectResponseCandidates(input);
    expect(second.selected.map((c) => c.characterId)).toEqual(
      first.selected.map((c) => c.characterId),
    );
    expect(second.selected[0]?.score).toBe(first.selected[0]?.score);
  });

  it("6) profundidade maior aumenta o custo de entrar", () => {
    const base = {
      participants: [participant("a1", "Kimi"), participant("b1", "Max")],
      messages: [message("m1", "user", "Oi")],
      alreadyResponded: [] as string[],
      seed: SEED,
      limits: LIMITS,
    };
    const shallow = selectResponseCandidates({ ...base, depth: 0 });
    const deep = selectResponseCandidates({ ...base, depth: 3 });
    expect((deep.selected[0]?.score ?? 0) < (shallow.selected[0]?.score ?? 0)).toBe(true);
  });

  it("7) sem oportunidade suficiente a seleção pode ser vazia (silêncio)", () => {
    const result = selectResponseCandidates({
      participants: [participant("a1", "Kimi")],
      messages: [message("m1", "a1", "Já falei", "AI_CHARACTER")],
      depth: 3,
      alreadyResponded: ["a1"],
      seed: SEED,
      limits: LIMITS,
    });
    expect(result.selected).toHaveLength(0);
    expect(["NO_RESPONSE_OPPORTUNITY", "NO_ELIGIBLE_SPEAKER"]).toContain(result.stopReason);
  });
});
