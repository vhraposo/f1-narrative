import { describe, expect, it } from "vitest";

import { evaluateBehaviorPolicy } from "./behavior.policy.js";
import type {
  BehaviorContextView,
  BehaviorDecisionRequest,
  BehaviorTrigger,
} from "./behavior.types.js";

function makeContext(overrides: Partial<BehaviorContextView> = {}): BehaviorContextView {
  return {
    version: "behavior-context.v1:test",
    fingerprint: "fingerprint",
    assembledAt: new Date("2026-10-01T00:00:00.000Z"),
    worldDate: new Date("2026-10-01T00:00:00.000Z"),
    universeId: "u1",
    characterId: "c1",
    identity: {
      name: "Piloto AI",
      nationality: "BR",
      controller: "AI",
      biography: null,
    },
    personality: { traits: [] },
    currentState: {
      trigger: "MESSAGE_RECEIVED",
      userInitiated: true,
      event: null,
      race: null,
      session: null,
    },
    goals: [],
    memory: { recent: [] },
    experience: { recent: [] },
    relationships: { entries: [] },
    world: {
      currentDate: new Date("2026-10-01T00:00:00.000Z"),
      currentSeasonId: "s1",
      currentRaceId: null,
      currentSession: null,
    },
    motorsport: { teamName: null, number: null, standing: null, teammate: null, recentResults: [] },
    conversation: null,
    availability: null,
    schedule: { due: [], upcoming: [] },
    news: { recent: [] },
    omitted: [],
    ...overrides,
  };
}

function makeRequest(overrides: Partial<BehaviorDecisionRequest> = {}): BehaviorDecisionRequest {
  return {
    universeId: "u1",
    characterId: "c1",
    trigger: "MESSAGE_RECEIVED" as BehaviorTrigger,
    worldDate: new Date("2026-10-01T00:00:00.000Z"),
    conversationId: "conv1",
    userInitiated: true,
    ...overrides,
  };
}

function withConversation(context: BehaviorContextView, isParticipant: boolean): BehaviorContextView {
  return {
    ...context,
    conversation: {
      id: "conv1",
      type: "DM",
      participantIds: isParticipant ? ["c1", "c2"] : ["c2"],
      isParticipant,
      recentMessages: [],
    },
  };
}

describe("behavior policy (deterministic)", () => {
  it("1) mesma entrada produz exatamente a mesma saída em 5 execuções", () => {
    const context = withConversation(
      makeContext({ availability: { status: "AVAILABLE", reason: null, until: null } }),
      true,
    );
    const request = makeRequest();
    const outputs = Array.from({ length: 5 }, () =>
      JSON.stringify(evaluateBehaviorPolicy(context, request)),
    );
    expect(new Set(outputs).size).toBe(1);
    expect(outputs[0]).toContain("POLICY_RESPOND_TO_DIRECT_MESSAGE");
  });

  it("2) RESPOND tem prioridade sobre as demais ações", () => {
    const context = withConversation(
      makeContext({ availability: { status: "AVAILABLE", reason: null, until: null } }),
      true,
    );
    const result = evaluateBehaviorPolicy(context, makeRequest());
    expect(result.selected.actionType).toBe("RESPOND");
    expect(result.selected.priority).toBe(90);
  });

  it("3) character USER não age autonomamente", () => {
    const context = withConversation(
      {
        ...makeContext({
          availability: { status: "AVAILABLE", reason: null, until: null },
        }),
        identity: { name: "User Pilot", nationality: "BR", controller: "USER", biography: null },
      },
      true,
    );
    const result = evaluateBehaviorPolicy(
      context,
      makeRequest({ trigger: "MESSAGE_RECEIVED", userInitiated: false }),
    );
    expect(result.selected.actionType).toBe("NO_ACTION");
    const respond = result.candidates.find((candidate) => candidate.actionType === "RESPOND");
    expect(respond?.failedPreconditions).toContain("CONTROLLER_IS_AI");
  });

  it("4) character USER responde quando a ação é iniciada pelo usuário", () => {
    const context = withConversation(
      {
        ...makeContext({
          availability: { status: "AVAILABLE", reason: null, until: null },
        }),
        identity: { name: "User Pilot", nationality: "BR", controller: "USER", biography: null },
      },
      true,
    );
    const result = evaluateBehaviorPolicy(context, makeRequest({ userInitiated: true }));
    expect(result.selected.actionType).toBe("RESPOND");
  });

  it("5) conversa sem participação rejeita RESPOND", () => {
    const context = withConversation(
      makeContext({ availability: { status: "AVAILABLE", reason: null, until: null } }),
      false,
    );
    const result = evaluateBehaviorPolicy(context, makeRequest());
    const respond = result.candidates.find((candidate) => candidate.actionType === "RESPOND");
    expect(respond?.failedPreconditions).toContain("CHARACTER_IS_PARTICIPANT");
    expect(result.selected.actionType).toBe("NO_ACTION");
  });

  it("6) ausência de relacionamento rejeita SEND_MESSAGE e a política explica o motivo", () => {
    const context = makeContext({
      currentState: {
        trigger: "EVENT_CREATED",
        userInitiated: false,
        event: null,
        race: null,
        session: null,
      },
      availability: { status: "AVAILABLE", reason: null, until: null },
    });
    const result = evaluateBehaviorPolicy(
      context,
      makeRequest({
        trigger: "EVENT_CREATED",
        conversationId: null,
        userInitiated: false,
        metadata: { targetCharacterId: "c9" },
      }),
    );
    const send = result.candidates.find((candidate) => candidate.actionType === "SEND_MESSAGE");
    expect(send?.failedPreconditions).toContain("RELATIONSHIP_TARGET_PRESENT");
    expect(result.selected.actionType).toBe("NO_ACTION");
    expect(result.rejected.length).toBeGreaterThanOrEqual(1);
  });

  it("7) experiência significativa habilita CREATE_MEMORY", () => {
    const context = makeContext({
      availability: { status: "AVAILABLE", reason: null, until: null },
      experience: {
        recent: [
          {
            id: "x1",
            title: "Vitória",
            experienceType: "SPORTING_VICTORY",
            salience: "HIGH",
            occurredAt: new Date("2026-09-30T00:00:00.000Z"),
          },
        ],
      },
    });
    const result = evaluateBehaviorPolicy(
      context,
      makeRequest({ trigger: "RACE_FINISHED", conversationId: null, userInitiated: false }),
    );
    const memory = result.candidates.find(
      (candidate) => candidate.actionType === "CREATE_MEMORY",
    );
    expect(memory?.failedPreconditions).toEqual([]);
  });

  it("8) sem temporada ativa CREATE_EVENT é rejeitado", () => {
    const context = makeContext({
      world: {
        currentDate: new Date("2026-10-01T00:00:00.000Z"),
        currentSeasonId: null,
        currentRaceId: null,
        currentSession: null,
      },
    });
    const result = evaluateBehaviorPolicy(
      context,
      makeRequest({ trigger: "SCHEDULE_DUE", conversationId: null, userInitiated: false }),
    );
    const event = result.candidates.find((candidate) => candidate.actionType === "CREATE_EVENT");
    expect(event?.failedPreconditions).toContain("ACTIVE_SEASON_PRESENT");
    expect(result.selected.actionType).toBe("NO_ACTION");
  });

  it("9) NO_ACTION está sempre presente e nunca falha", () => {
    const result = evaluateBehaviorPolicy(
      makeContext(),
      makeRequest({ trigger: "AUTONOMOUS_TICK", userInitiated: false }),
    );
    const noAction = result.candidates.find((candidate) => candidate.actionType === "NO_ACTION");
    expect(noAction?.failedPreconditions).toEqual([]);
    expect(noAction?.priority).toBe(0);
  });

  it("10) candidatos possuem id, reasonCode, requiredContext e consequencesPreview", () => {
    const context = withConversation(
      makeContext({ availability: { status: "AVAILABLE", reason: null, until: null } }),
      true,
    );
    const result = evaluateBehaviorPolicy(context, makeRequest());
    for (const candidate of result.candidates) {
      expect(candidate.id.startsWith("cand:")).toBe(true);
      expect(candidate.reasonCode.length).toBeGreaterThan(0);
      expect(Array.isArray(candidate.requiredContext)).toBe(true);
      expect(Array.isArray(candidate.consequencesPreview)).toBe(true);
    }
  });
});
