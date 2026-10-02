import { describe, expect, it } from "vitest";

import {
  buildConversationOpportunity,
  CONVERSATION_OPPORTUNITY_REASONS,
  ConversationOpportunitySchema,
  ConversationOpportunitySignalSchema,
  type ConversationOpportunitySignal,
} from "./conversation.opportunity.js";

const WINDOW_START = new Date("2026-10-01T12:00:00.000Z");

function signal(overrides: Partial<ConversationOpportunitySignal> = {}): ConversationOpportunitySignal {
  return {
    universeId: "uni-1",
    characterId: "ai-kimi",
    reason: "WORLD_EVENT",
    strength: 0.5,
    evidenceId: "event-1",
    ...overrides,
  };
}

function build(overrides: {
  participantIds?: string[];
  windowStart?: Date;
  signal?: ConversationOpportunitySignal;
} = {}) {
  return buildConversationOpportunity({
    universeId: "uni-1",
    conversationId: "conv-1",
    participantIds: overrides.participantIds ?? ["ai-kimi", "ai-max", "user-a"],
    windowStart: overrides.windowStart ?? WINDOW_START,
    signal: overrides.signal ?? signal(),
  });
}

describe("F6.1 — ConversationOpportunity", () => {
  it("cria oportunidade a partir de sinal válido", () => {
    const opportunity = build();
    expect(opportunity).not.toBeNull();
    expect(opportunity!.characterId).toBe("ai-kimi");
    expect(opportunity!.reason).toBe("WORLD_EVENT");
    expect(opportunity!.targetCharacterId).toBeNull();
    expect(ConversationOpportunitySchema.safeParse(opportunity).success).toBe(true);
  });

  it("personagem que não participa da conversa não gera oportunidade", () => {
    expect(build({ signal: signal({ characterId: "ai-fora" }) })).toBeNull();
  });

  it("target é opcional e validado contra a conversa", () => {
    const withTarget = build({ signal: signal({ targetCharacterId: "ai-max" }) });
    expect(withTarget?.targetCharacterId).toBe("ai-max");
    expect(build({ signal: signal({ targetCharacterId: "ai-fora" }) })).toBeNull();
  });

  it("prioridade é determinística e segue a base da taxonomia", () => {
    const event = build({ signal: signal({ reason: "WORLD_EVENT", strength: 0.5 }) });
    const inactivity = build({ signal: signal({ reason: "INACTIVITY", strength: 0.5 }) });
    expect(event?.priority).toBe(0.9);
    expect(inactivity?.priority).toBe(0.4);
    expect(event!.priority).toBeGreaterThan(inactivity!.priority);
  });

  it("fingerprint é determinístico e reproduzível", () => {
    const a = build();
    const b = build();
    expect(a!.fingerprint).toBe(b!.fingerprint);
    expect(a!.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("mesma entrada produz exatamente a mesma oportunidade", () => {
    expect(build()).toEqual(build());
  });

  it("não depende de Date.now: janela vem do domínio", () => {
    const earlier = build({ windowStart: new Date("2026-10-01T11:00:00.000Z") });
    const later = build({ windowStart: new Date("2026-10-01T13:00:00.000Z") });
    expect(earlier!.windowStart).toBe("2026-10-01T11:00:00.000Z");
    expect(later!.windowStart).toBe("2026-10-01T13:00:00.000Z");
    expect(earlier!.fingerprint).not.toBe(later!.fingerprint);
  });

  it("inputs vazios ou sem força não produzem oportunidade", () => {
    expect(build({ signal: signal({ strength: 0 }) })).toBeNull();
    expect(build({ participantIds: [] })).toBeNull();
  });

  it("estrutura é bounded: apenas IDs, códigos e escalares", () => {
    const opportunity = build()!;
    expect(Object.keys(opportunity).sort()).toEqual([
      "characterId",
      "conversationId",
      "fingerprint",
      "priority",
      "reason",
      "targetCharacterId",
      "universeId",
      "windowStart",
    ]);
    expect(JSON.stringify(opportunity).length).toBeLessThan(600);
  });

  it("isolamento por universeId rejeita sinal de outro universo", () => {
    expect(build({ signal: signal({ universeId: "uni-2" }) })).toBeNull();
  });

  it("razões fora da taxonomia são rejeitadas pelo schema", () => {
    expect(ConversationOpportunitySignalSchema.safeParse(signal()).success).toBe(true);
    expect(
      ConversationOpportunitySignalSchema.safeParse({ ...signal(), reason: "ARBITRARY" }).success,
    ).toBe(false);
    expect(CONVERSATION_OPPORTUNITY_REASONS).toEqual([
      "WORLD_EVENT",
      "RELATIONSHIP_CHANGE",
      "MEMORY_TRIGGER",
      "GOAL_PRESSURE",
      "INACTIVITY",
    ]);
  });

  it("evidência diferente muda o fingerprint (dedupe futura por evidência)", () => {
    const a = build({ signal: signal({ evidenceId: "event-1" }) });
    const b = build({ signal: signal({ evidenceId: "event-2" }) });
    expect(a!.fingerprint).not.toBe(b!.fingerprint);
  });
});
