import { describe, expect, it } from "vitest";

import {
  selectConversationOpportunities,
  type OpportunityCandidate,
} from "../autonomy/autonomy.opportunities.js";
import {
  buildOpportunitySignals,
  canonicalEvidenceId,
  type OpportunityEvidence,
} from "./conversation.opportunity-bridge.js";
import {
  buildConversationOpportunity,
  ConversationOpportunitySchema,
  type ConversationOpportunitySignal,
} from "./conversation.opportunity.js";

const WINDOW = new Date("2026-10-01T12:00:00.000Z");
const UNIVERSE = "uni-1";
const CONVERSATION = "conv-1";
const PARTICIPANTS = ["ai-a", "ai-b", "user-u"];
const CHARACTERS = ["ai-a", "ai-b"];

function signalsFor(evidence: OpportunityEvidence) {
  return buildOpportunitySignals({
    universeId: UNIVERSE,
    conversationId: CONVERSATION,
    participantIds: PARTICIPANTS,
    characterIds: CHARACTERS,
    evidence,
  });
}

function toCandidates(
  signals: readonly ConversationOpportunitySignal[],
): OpportunityCandidate[] {
  const candidates: OpportunityCandidate[] = [];
  for (const signal of signals) {
    const opportunity = buildConversationOpportunity({
      universeId: UNIVERSE,
      conversationId: CONVERSATION,
      participantIds: PARTICIPANTS,
      windowStart: WINDOW,
      signal,
    });
    if (!opportunity) continue;
    candidates.push({ opportunity, evidenceId: signal.evidenceId, fairnessRank: 0 });
  }
  return candidates;
}

describe("F6.4 — ponte evidência → sinal → oportunidade", () => {
  it("evento válido gera sinais WORLD_EVENT com target determinístico", () => {
    const signals = signalsFor({
      kind: "EVENT",
      id: "evt-1",
      importance: "HIGH",
      participantIds: ["ai-a", "ai-b"],
    });
    expect(signals).toHaveLength(2);
    const fromA = signals.find((signal) => signal.characterId === "ai-a")!;
    expect(fromA.reason).toBe("WORLD_EVENT");
    expect(fromA.universeId).toBe(UNIVERSE);
    expect(fromA.targetCharacterId).toBe("ai-b");
    expect(fromA.evidenceId).toBe("event:evt-1");
  });

  it("sinal gera oportunidade válida pelo contrato F6.1", () => {
    const [signal] = signalsFor({
      kind: "EVENT",
      id: "evt-1",
      importance: "MEDIUM",
      participantIds: ["ai-a", "ai-b"],
    });
    const opportunity = buildConversationOpportunity({
      universeId: UNIVERSE,
      conversationId: CONVERSATION,
      participantIds: PARTICIPANTS,
      windowStart: WINDOW,
      signal: signal!,
    });
    expect(opportunity).not.toBeNull();
    expect(ConversationOpportunitySchema.safeParse(opportunity).success).toBe(true);
  });

  it("evidenceId é estável e canônico por raiz de evento", () => {
    expect(
      canonicalEvidenceId({
        kind: "EVENT",
        id: "evt-1",
        importance: "HIGH",
        participantIds: [],
      }),
    ).toBe("event:evt-1");
    expect(
      canonicalEvidenceId({
        kind: "MEMORY",
        id: "mem-1",
        eventId: "evt-1",
        importance: "HIGH",
        participantIds: [],
      }),
    ).toBe("event:evt-1");
    expect(
      canonicalEvidenceId({
        kind: "RELATIONSHIP_CHANGE",
        id: "rc-1",
        sourceType: "EVENT",
        sourceId: "evt-1",
        characterAId: "ai-a",
        characterBId: "ai-b",
        delta: 5,
      }),
    ).toBe("event:evt-1");
    expect(
      canonicalEvidenceId({
        kind: "MEMORY",
        id: "mem-2",
        eventId: null,
        importance: "MEDIUM",
        participantIds: [],
      }),
    ).toBe("memory:mem-2");
    expect(
      canonicalEvidenceId({
        kind: "RELATIONSHIP_CHANGE",
        id: "rc-2",
        sourceType: "BEHAVIOR_DECISION",
        sourceId: "fp",
        characterAId: "ai-a",
        characterBId: "ai-b",
        delta: 2,
      }),
    ).toBe("relationship-change:rc-2");
    expect(
      canonicalEvidenceId({
        kind: "GOAL",
        id: "goal-1",
        characterId: "ai-a",
        priority: 50,
        targetCharacterId: null,
      }),
    ).toBe("goal:goal-1");
    expect(
      canonicalEvidenceId({
        kind: "INACTIVITY",
        conversationId: "conv-1",
        lastMessageId: "msg-9",
        idleMs: 0,
        windowMs: 1,
      }),
    ).toBe("inactivity:conv-1:msg-9");
  });

  it("fingerprint é estável em replay do mesmo evento", () => {
    const evidence: OpportunityEvidence = {
      kind: "EVENT",
      id: "evt-1",
      importance: "HIGH",
      participantIds: ["ai-a", "ai-b"],
    };
    const first = toCandidates(signalsFor(evidence));
    const second = toCandidates(signalsFor(evidence));
    expect(second.map((entry) => entry.opportunity.fingerprint)).toEqual(
      first.map((entry) => entry.opportunity.fingerprint),
    );
  });

  it("evento de Universe A não cria oportunidade em Universe B", () => {
    const [signal] = signalsFor({
      kind: "EVENT",
      id: "evt-1",
      importance: "HIGH",
      participantIds: ["ai-a", "ai-b"],
    });
    const opportunity = buildConversationOpportunity({
      universeId: "uni-2",
      conversationId: CONVERSATION,
      participantIds: PARTICIPANTS,
      windowStart: WINDOW,
      signal: signal!,
    });
    expect(opportunity).toBeNull();
  });

  it("evento sem personagem elegível não gera sinal", () => {
    const signals = buildOpportunitySignals({
      universeId: UNIVERSE,
      conversationId: CONVERSATION,
      participantIds: PARTICIPANTS,
      characterIds: ["ai-fora"],
      evidence: {
        kind: "EVENT",
        id: "evt-1",
        importance: "HIGH",
        participantIds: ["ai-a", "ai-b"],
      },
    });
    expect(signals).toHaveLength(0);
  });

  it("evento sem conversa elegível não gera sinal", () => {
    const signals = buildOpportunitySignals({
      universeId: UNIVERSE,
      conversationId: CONVERSATION,
      participantIds: ["user-u"],
      characterIds: CHARACTERS,
      evidence: {
        kind: "EVENT",
        id: "evt-1",
        importance: "HIGH",
        participantIds: ["ai-a", "ai-b"],
      },
    });
    expect(signals).toHaveLength(0);
  });

  it("relationship change é mapeado com evidência canônica do evento", () => {
    const signals = signalsFor({
      kind: "RELATIONSHIP_CHANGE",
      id: "rc-1",
      sourceType: "EVENT",
      sourceId: "evt-7",
      characterAId: "ai-a",
      characterBId: "ai-b",
      delta: 20,
    });
    expect(signals).toHaveLength(2);
    for (const signal of signals) {
      expect(signal.reason).toBe("RELATIONSHIP_CHANGE");
      expect(signal.evidenceId).toBe("event:evt-7");
      expect(signal.strength).toBeGreaterThan(0.2);
    }
    expect(signals.find((s) => s.characterId === "ai-a")?.targetCharacterId).toBe("ai-b");
  });

  it("memory trigger é mapeado com e sem raiz de evento", () => {
    const standalone = signalsFor({
      kind: "MEMORY",
      id: "mem-1",
      eventId: null,
      importance: "HIGH",
      participantIds: ["ai-a"],
    });
    expect(standalone).toHaveLength(1);
    expect(standalone[0]!.reason).toBe("MEMORY_TRIGGER");
    expect(standalone[0]!.evidenceId).toBe("memory:mem-1");

    const derived = signalsFor({
      kind: "MEMORY",
      id: "mem-2",
      eventId: "evt-1",
      importance: "HIGH",
      participantIds: ["ai-a"],
    });
    expect(derived).toHaveLength(1);
    expect(derived[0]!.evidenceId).toBe("event:evt-1");
  });

  it("race/event trigger usa a raiz estável do evento", () => {
    const signals = signalsFor({
      kind: "EVENT",
      id: "race-incident-1",
      importance: "CRITICAL",
      participantIds: ["ai-a", "ai-b"],
    });
    expect(signals).toHaveLength(2);
    expect(signals[0]!.reason).toBe("WORLD_EVENT");
    expect(signals[0]!.strength).toBe(1);
    expect(signals[0]!.evidenceId).toBe("event:race-incident-1");
  });

  it("evento + derivações não duplicam oportunidade (dedupe por evidenceId)", () => {
    const event = toCandidates(
      signalsFor({
        kind: "EVENT",
        id: "evt-1",
        importance: "HIGH",
        participantIds: ["ai-a", "ai-b"],
      }),
    );
    const memory = toCandidates(
      signalsFor({
        kind: "MEMORY",
        id: "mem-1",
        eventId: "evt-1",
        importance: "HIGH",
        participantIds: ["ai-a", "ai-b"],
      }),
    );
    const change = toCandidates(
      signalsFor({
        kind: "RELATIONSHIP_CHANGE",
        id: "rc-1",
        sourceType: "EVENT",
        sourceId: "evt-1",
        characterAId: "ai-a",
        characterBId: "ai-b",
        delta: 10,
      }),
    );
    const selection = selectConversationOpportunities({
      universeId: UNIVERSE,
      maxConversations: 2,
      candidates: [...event, ...memory, ...change],
    });
    expect(selection.selected).toHaveLength(1);
    expect(selection.selected[0]!.opportunity.reason).toBe("WORLD_EVENT");
    expect(selection.selected[0]!.evidenceId).toBe("event:evt-1");
    expect(
      selection.rejected.some((entry) => entry.reasonCode === "DUPLICATE_EVIDENCE"),
    ).toBe(true);
  });

  it("goal e inactivity continuam mapeados pela ponte", () => {
    const goal = signalsFor({
      kind: "GOAL",
      id: "goal-1",
      characterId: "ai-a",
      priority: 80,
      targetCharacterId: "ai-b",
    });
    expect(goal).toHaveLength(1);
    expect(goal[0]!.reason).toBe("GOAL_PRESSURE");
    expect(goal[0]!.targetCharacterId).toBe("ai-b");
    expect(goal[0]!.strength).toBeCloseTo(0.8);

    const inactive = signalsFor({
      kind: "INACTIVITY",
      conversationId: CONVERSATION,
      lastMessageId: "msg-1",
      idleMs: 72 * 60 * 60 * 1000,
      windowMs: 24 * 60 * 60 * 1000,
    });
    expect(inactive).toHaveLength(2);
    expect(inactive[0]!.reason).toBe("INACTIVITY");
    expect(inactive[0]!.evidenceId).toBe("inactivity:conv-1:msg-1");

    const active = signalsFor({
      kind: "INACTIVITY",
      conversationId: CONVERSATION,
      lastMessageId: "msg-1",
      idleMs: 60 * 60 * 1000,
      windowMs: 24 * 60 * 60 * 1000,
    });
    expect(active).toHaveLength(0);
  });
});
