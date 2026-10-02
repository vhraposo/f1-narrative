import { describe, expect, it } from "vitest";

import {
  buildConversationOpportunity,
  type ConversationOpportunityReason,
} from "../conversation/conversation.opportunity.js";
import {
  selectConversationOpportunities,
  toConversationOpportunityAudit,
  toConversationOpportunitySelectionAudit,
  type ConversationOpportunityCooldown,
  type OpportunityCandidate,
} from "./autonomy.opportunities.js";
import { autonomyBudgets } from "./autonomy.policy.js";

const WINDOW = new Date("2026-10-01T00:00:00.000Z");

function candidate(
  overrides: {
    universeId?: string;
    conversationId?: string;
    characterId?: string;
    targetCharacterId?: string;
    reason?: ConversationOpportunityReason;
    strength?: number;
    evidenceId?: string;
    fairnessRank?: number;
    windowStart?: Date;
  } = {},
): OpportunityCandidate {
  const universeId = overrides.universeId ?? "uni-1";
  const evidenceId = overrides.evidenceId ?? "event:1";
  const opportunity = buildConversationOpportunity({
    universeId,
    conversationId: overrides.conversationId ?? "conv-1",
    participantIds: ["ai-a", "ai-b", "user-a"],
    windowStart: overrides.windowStart ?? WINDOW,
    signal: {
      universeId,
      characterId: overrides.characterId ?? "ai-a",
      reason: overrides.reason ?? "WORLD_EVENT",
      strength: overrides.strength ?? 0.5,
      evidenceId,
      ...(overrides.targetCharacterId ? { targetCharacterId: overrides.targetCharacterId } : {}),
    },
  });
  if (!opportunity) throw new Error(`fixture inválida: ${JSON.stringify(overrides)}`);
  return { opportunity, evidenceId, fairnessRank: overrides.fairnessRank ?? 0 };
}

function select(
  candidates: readonly OpportunityCandidate[],
  overrides: {
    maxConversations?: number;
    cooldown?: Partial<ConversationOpportunityCooldown>;
  } = {},
) {
  return selectConversationOpportunities({
    universeId: "uni-1",
    maxConversations: overrides.maxConversations ?? 2,
    candidates,
    ...(overrides.cooldown
      ? {
          cooldown: {
            characterIds: overrides.cooldown.characterIds ?? new Set<string>(),
            conversationIds: overrides.cooldown.conversationIds ?? new Set<string>(),
            fingerprints: overrides.cooldown.fingerprints ?? new Set<string>(),
            evidenceIds: overrides.cooldown.evidenceIds ?? new Set<string>(),
          },
        }
      : {}),
  });
}

function reasons(selection: ReturnType<typeof select>) {
  return selection.selected.map((entry) => entry.opportunity.reason);
}

describe("F6.2 — seleção de oportunidades (pura)", () => {
  it("prioridade estável decide entre fontes diferentes", () => {
    const selection = select([
      candidate({ reason: "GOAL_PRESSURE", strength: 0.6, evidenceId: "goal:1" }),
      candidate({
        reason: "WORLD_EVENT",
        strength: 0.5,
        evidenceId: "event:1",
        conversationId: "conv-2",
      }),
    ]);
    expect(reasons(selection)[0]).toBe("WORLD_EVENT");
  });

  it("fingerprint é determinístico e reprodutível", () => {
    const a = candidate({ evidenceId: "event:1" });
    const b = candidate({ evidenceId: "event:1" });
    expect(a.opportunity.fingerprint).toBe(b.opportunity.fingerprint);
    expect(a.opportunity.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("desempate determinístico independente da ordem de entrada", () => {
    const first = candidate({
      characterId: "ai-a",
      conversationId: "conv-2",
      evidenceId: "event:2",
      fairnessRank: 0,
    });
    const second = candidate({
      characterId: "ai-b",
      conversationId: "conv-1",
      evidenceId: "event:1",
      fairnessRank: 0,
    });
    const ordered = select([second, first]);
    const reversed = select([first, second]);
    expect(ordered.selected.map((entry) => entry.opportunity.conversationId)).toEqual([
      "conv-1",
      "conv-2",
    ]);
    expect(reversed.selected.map((entry) => entry.opportunity.fingerprint)).toEqual(
      ordered.selected.map((entry) => entry.opportunity.fingerprint),
    );
  });

  it("fairness existente desempata personagens de mesma prioridade", () => {
    const later = candidate({
      characterId: "ai-b",
      conversationId: "conv-2",
      evidenceId: "goal:2",
      reason: "GOAL_PRESSURE",
      strength: 0.5,
      fairnessRank: 1,
    });
    const earlier = candidate({
      characterId: "ai-a",
      conversationId: "conv-1",
      evidenceId: "goal:1",
      reason: "GOAL_PRESSURE",
      strength: 0.5,
      fairnessRank: 0,
    });
    const selection = select([later, earlier]);
    expect(selection.selected[0]?.opportunity.characterId).toBe("ai-a");
  });

  it("dedupe por fingerprint", () => {
    const duplicated = candidate({ evidenceId: "event:1" });
    const selection = select([duplicated, duplicated]);
    expect(selection.selected).toHaveLength(1);
    expect(selection.rejected.some((entry) => entry.reasonCode === "DUPLICATE_FINGERPRINT")).toBe(
      true,
    );
  });

  it("dedupe por evidenceId", () => {
    const first = candidate({ conversationId: "conv-1", evidenceId: "event:1", fairnessRank: 0 });
    const second = candidate({ conversationId: "conv-2", evidenceId: "event:1", fairnessRank: 1 });
    const selection = select([first, second]);
    expect(selection.selected).toHaveLength(1);
    expect(selection.rejected.some((entry) => entry.reasonCode === "DUPLICATE_EVIDENCE")).toBe(
      true,
    );
  });

  it("cooldown por personagem", () => {
    const selection = select([candidate()], {
      cooldown: { characterIds: new Set(["ai-a"]) },
    });
    expect(selection.selected).toHaveLength(0);
    expect(selection.rejected[0]?.reasonCode).toBe("CHARACTER_COOLDOWN");
  });

  it("cooldown por conversa", () => {
    const selection = select([candidate()], {
      cooldown: { conversationIds: new Set(["conv-1"]) },
    });
    expect(selection.selected).toHaveLength(0);
    expect(selection.rejected[0]?.reasonCode).toBe("CONVERSATION_COOLDOWN");
  });

  it("cooldown por fingerprint", () => {
    const entry = candidate();
    const selection = select([entry], {
      cooldown: { fingerprints: new Set([entry.opportunity.fingerprint]) },
    });
    expect(selection.selected).toHaveLength(0);
    expect(selection.rejected[0]?.reasonCode).toBe("DUPLICATE_FINGERPRINT");
  });

  it("no máximo uma oportunidade por conversa por tick", () => {
    const selection = select([
      candidate({ characterId: "ai-a", conversationId: "conv-1", evidenceId: "goal:1" }),
      candidate({ characterId: "ai-b", conversationId: "conv-1", evidenceId: "goal:2" }),
    ]);
    expect(selection.selected).toHaveLength(1);
    expect(
      selection.rejected.some((entry) => entry.reasonCode === "CONVERSATION_ALREADY_SELECTED"),
    ).toBe(true);
  });

  it("no máximo uma oportunidade por personagem por tick", () => {
    const selection = select([
      candidate({ characterId: "ai-a", conversationId: "conv-1", evidenceId: "goal:1" }),
      candidate({ characterId: "ai-a", conversationId: "conv-2", evidenceId: "goal:2" }),
    ]);
    expect(selection.selected).toHaveLength(1);
    expect(
      selection.rejected.some((entry) => entry.reasonCode === "CHARACTER_ALREADY_SELECTED"),
    ).toBe(true);
  });

  it("budget máximo de 2 oportunidades por tick", () => {
    const selection = select([
      candidate({ characterId: "ai-a", conversationId: "conv-1", evidenceId: "goal:1" }),
      candidate({ characterId: "ai-b", conversationId: "conv-2", evidenceId: "goal:2" }),
      candidate({ characterId: "user-a", conversationId: "conv-3", evidenceId: "goal:3" }),
    ]);
    expect(selection.selected).toHaveLength(2);
    expect(selection.budgetExhausted).toBe(true);
    expect(selection.rejected.some((entry) => entry.reasonCode === "BUDGET_EXHAUSTED")).toBe(true);
  });

  it("isolamento por universeId", () => {
    const selection = select([candidate({ universeId: "uni-2" })]);
    expect(selection.selected).toHaveLength(0);
    expect(selection.rejected[0]?.reasonCode).toBe("UNIVERSE_MISMATCH");
  });

  it("replay determinístico: mesmas entradas, mesma seleção", () => {
    const candidates = [
      candidate({ characterId: "ai-a", conversationId: "conv-1", evidenceId: "goal:1" }),
      candidate({
        characterId: "ai-b",
        conversationId: "conv-2",
        evidenceId: "event:2",
        reason: "WORLD_EVENT",
        fairnessRank: 1,
      }),
    ];
    expect(select(candidates)).toEqual(select(candidates));
  });

  it("audit é bounded: somente IDs, códigos e escalares", () => {
    const entry = candidate({ characterId: "ai-a", targetCharacterId: "ai-b" });
    const selection = select([entry]);
    const audit = toConversationOpportunityAudit(selection.selected[0]!);
    expect(Object.keys(audit).sort()).toEqual([
      "characterId",
      "conversationId",
      "evidenceId",
      "fingerprint",
      "priority",
      "rank",
      "reason",
      "targetCharacterId",
      "windowStart",
    ]);
    const summary = toConversationOpportunitySelectionAudit(selection, 2);
    expect(Object.keys(summary).sort()).toEqual([
      "budget",
      "budgetExhausted",
      "candidateCount",
      "selectedCount",
    ]);
    expect(JSON.stringify(audit).length).toBeLessThan(600);
  });

  it("budget default é 2 e configurável por env", () => {
    expect(autonomyBudgets().maxConversationsPerTick).toBe(2);
    process.env.AUTONOMY_MAX_CONVERSATIONS_PER_TICK = "3";
    try {
      expect(autonomyBudgets().maxConversationsPerTick).toBe(3);
    } finally {
      delete process.env.AUTONOMY_MAX_CONVERSATIONS_PER_TICK;
    }
  });
});
