import { describe, expect, it } from "vitest";

import {
  buildDialogueCandidateSet,
  buildFallbackPlan,
  DeterministicDialoguePlanner,
  DialoguePlanSchema,
  DialogueUtteranceSchema,
  MessageDialogueMetadataSchema,
  validateDialoguePlan,
  type DialogueCandidateSet,
} from "./conversation.dialogue.js";
import { evaluateConversationEnergy, planResponseWindow } from "./conversation.energy.js";
import {
  selectResponseCandidates,
  type ResponseEngineParticipant,
  type ResponseSelectionInput,
} from "./conversation.response-engine.js";

const WORLD_DATE = new Date("2026-10-01T12:00:00.000Z");

const PARTICIPANTS: ResponseEngineParticipant[] = [
  { characterId: "ai-kimi", name: "Kimi Antonelli", controller: "AI", available: true },
  { characterId: "ai-max", name: "Max Verstappen", controller: "AI", available: true },
  { characterId: "ai-lando", name: "Lando Norris", controller: "AI", available: true },
  { characterId: "user-alicya", name: "Alicya", controller: "USER", available: true },
];

type Scenario = {
  readonly content: string;
  readonly participants?: ResponseEngineParticipant[];
  readonly recentAiMessages?: { characterId: string; content: string }[];
  readonly relationshipAffinity?: Record<string, number>;
  readonly budgetRemaining?: number;
  readonly messageId?: string;
};

async function runScenario(scenario: Scenario) {
  const participants = scenario.participants ?? PARTICIPANTS;
  const messageId = scenario.messageId ?? "msg-1";
  const input: ResponseSelectionInput = {
    participants,
    messages: [
      {
        id: messageId,
        senderType: "USER_CHARACTER",
        characterId: "user-alicya",
        content: scenario.content,
        createdAt: WORLD_DATE,
      },
    ],
    ...(scenario.relationshipAffinity ? { relationshipAffinity: scenario.relationshipAffinity } : {}),
    depth: 0,
    alreadyResponded: [],
    ...(scenario.recentAiMessages ? { recentAiMessages: scenario.recentAiMessages } : {}),
    seed: {
      universeId: "universe-1",
      conversationId: "conversation-1",
      lastMessageId: messageId,
      worldDate: WORLD_DATE,
    },
    limits: { maxResponders: 0, minScore: 0 },
  };
  const energy = evaluateConversationEnergy({
    message: scenario.content,
    participantCount: participants.length,
    recentAiMessages: scenario.recentAiMessages?.length ?? 0,
  });
  const window = planResponseWindow(energy, { budgetRemaining: scenario.budgetRemaining ?? 6 });
  const selection = selectResponseCandidates({
    ...input,
    limits: { maxResponders: window.maxInitialResponders, minScore: window.stopThresholds.initial },
  });
  const candidateSet = buildDialogueCandidateSet({
    conversationId: "conversation-1",
    universeId: "universe-1",
    lastMessageId: messageId,
    lastMessageContent: scenario.content,
    depth: 0,
    energy,
    window,
    selection,
  });
  const planner = new DeterministicDialoguePlanner();
  const plan = await planner.plan({ candidateSet });
  const validation = validateDialoguePlan(plan, {
    participantIds: new Set(participants.map((p) => p.characterId)),
    aiParticipantIds: new Set(
      participants.filter((p) => p.controller === "AI").map((p) => p.characterId),
    ),
    eligibleCandidateIds: new Set(selection.selected.map((c) => c.characterId)),
    availablePutativeIds: new Set(
      participants.filter((p) => p.available).map((p) => p.characterId),
    ),
    messageIds: new Set([messageId, "msg-0"]),
    maxTurns: window.maxInitialResponders + window.maxReactions,
    remainingBudget: scenario.budgetRemaining ?? 6,
  });
  return { plan, validation, candidateSet, selection, window, energy };
}

function safePlan(candidateSet: DialogueCandidateSet) {
  return buildFallbackPlan(candidateSet);
}

describe("F0 — dialogue engine evals (determinístico, sem LLM)", () => {
  it("S01 greeting: há candidatos, ninguém obrigatório, plano válido e determinístico", async () => {
    const first = await runScenario({ content: "bom dia amigos" });
    const second = await runScenario({ content: "bom dia amigos" });
    expect(first.plan.turns.length).toBeGreaterThanOrEqual(0);
    expect(first.plan.turns.length).toBeLessThanOrEqual(2);
    expect(first.plan.turns.every((turn) => turn.speakerCharacterId !== "user-alicya")).toBe(true);
    expect(first.plan.turns.length).toBeLessThan(PARTICIPANTS.length - 1);
    expect(first.validation.valid).toBe(true);
    expect(second.plan).toEqual(first.plan);
    expect(first.plan.turns.every((turn) => turn.replyToMessageId === "msg-1")).toBe(true);
  });

  it("S02 direct mention: Kimi priorizado com replyTo válido e no assunto", async () => {
    const { plan, validation } = await runScenario({
      content: "Kimi, você acha que ganha hoje?",
    });
    expect(plan.turns[0]?.speakerCharacterId).toBe("ai-kimi");
    expect(["ANSWER", "FOLLOW_UP"]).toContain(plan.turns[0]?.intent);
    expect(plan.turns[0]?.replyToMessageId).toBe("msg-1");
    expect(validation.valid).toBe(true);
  });

  it("S03 group question: múltiplos candidatos possíveis sem duplicar speaker", async () => {
    const { plan, candidateSet, validation } = await runScenario({
      content: "vocês viram a corrida?",
    });
    expect(candidateSet.selected.length).toBeGreaterThanOrEqual(1);
    const ids = plan.turns.map((turn) => turn.speakerCharacterId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(plan.topic).toBe("race");
    expect(validation.valid).toBe(true);
  });

  it("S04 emotional: proximidade gera oportunidade de suporte", async () => {
    const { plan, candidateSet } = await runScenario({
      content: "gente, eu tô muito nervosa",
      relationshipAffinity: { "ai-maxi": 0.9 },
    } as Scenario);
    expect(candidateSet.selected.length).toBeGreaterThanOrEqual(1);
    expect(plan.emotionalTone).toBe("TENSE");
    expect(plan.turns.every((turn) => turn.speakerCharacterId !== "user-alicya")).toBe(true);
  });

  it("S05 joke: reação curta e sem monólogo por contrato", async () => {
    const { plan } = await runScenario({ content: "KKKK vocês são impossíveis" });
    for (const turn of plan.turns) {
      expect(turn.maxMessages).toBeGreaterThanOrEqual(1);
      expect(turn.maxMessages).toBeLessThanOrEqual(2);
      expect(["REACTION", "JOKE", "FOLLOW_UP"]).toContain(turn.intent);
    }
  });

  it("S06 callback: menção prioriza personagem com memória relevante", async () => {
    const { plan } = await runScenario({
      content: "George, e a bomba?",
      participants: [
        ...PARTICIPANTS,
        { characterId: "ai-george", name: "George Russell", controller: "AI", available: true },
      ],
      recentAiMessages: [
        { characterId: "ai-george", content: "comprei uma coisa pra você" },
      ],
    });
    const first = plan.turns[0];
    if (first) {
      expect(first.speakerCharacterId).toBe("ai-george");
      expect(first.replyToMessageId).toBe("msg-1");
    }
  });

  it("S07 topic shift: assunto novo não força tópico anterior", async () => {
    const { plan } = await runScenario({ content: "aliás, alguém viu minha chave?" });
    expect(plan.topic).toBeNull();
  });

  it("S08 private knowledge: plano não pode incluir speaker fora do candidate set", async () => {
    const { validation } = await runScenario({ content: "bom dia" });
    expect(validation.valid).toBe(true);
    const forged = {
      conversationIntent: "CONTINUE" as const,
      topic: null,
      emotionalTone: "NEUTRAL" as const,
      turns: [
        {
          speakerCharacterId: "ai-secret",
          replyToMessageId: "msg-1",
          intent: "ANSWER" as const,
          maxMessages: 1 as const,
          priority: 1,
        },
      ],
      continuation: "RE_EVALUATE" as const,
      stopReason: "SELECTED" as const,
    };
    const rejected = validateDialoguePlan(forged, {
      participantIds: new Set(["ai-secret"]),
      aiParticipantIds: new Set(["ai-secret"]),
      eligibleCandidateIds: new Set(["ai-kimi"]),
      availablePutativeIds: new Set(["ai-kimi"]),
      messageIds: new Set(["msg-1"]),
      maxTurns: 2,
      remainingBudget: 2,
    });
    expect(rejected.valid).toBe(false);
    expect(rejected.errors).toContain("SPEAKER_NOT_CANDIDATE");
  });
});

describe("F1 — invariantes do planner e validator", () => {
  it("USER nunca é speaker; indisponível e fora da conversa são rejeitados", async () => {
    const base = {
      conversationIntent: "CONTINUE" as const,
      topic: null,
      emotionalTone: "NEUTRAL" as const,
      turns: [
        {
          speakerCharacterId: "user-alicya",
          replyToMessageId: "msg-1",
          intent: "ANSWER" as const,
          maxMessages: 1 as const,
          priority: 1,
        },
      ],
      continuation: "RE_EVALUATE" as const,
      stopReason: "SELECTED" as const,
    };
    const userRejected = validateDialoguePlan(base, {
      participantIds: new Set(["user-alicya"]),
      aiParticipantIds: new Set(["ai-kimi"]),
      eligibleCandidateIds: new Set(["user-alicya"]),
      availablePutativeIds: new Set(["user-alicya"]),
      messageIds: new Set(["msg-1"]),
      maxTurns: 2,
      remainingBudget: 2,
    });
    expect(userRejected.errors).toContain("SPEAKER_NOT_AI");

    const unavailable = {
      ...base,
      turns: [{ ...base.turns[0], speakerCharacterId: "ai-offline" }],
    };
    const offlineRejected = validateDialoguePlan(unavailable, {
      participantIds: new Set(["ai-offline"]),
      aiParticipantIds: new Set(["ai-offline"]),
      eligibleCandidateIds: new Set(["ai-offline"]),
      availablePutativeIds: new Set(),
      messageIds: new Set(["msg-1"]),
      maxTurns: 2,
      remainingBudget: 2,
    });
    expect(offlineRejected.errors).toContain("SPEAKER_UNAVAILABLE");

    const replyUnknown = {
      ...base,
      turns: [{ ...base.turns[0], speakerCharacterId: "ai-kimi", replyToMessageId: "msg-999" }],
    };
    const replyRejected = validateDialoguePlan(replyUnknown, {
      participantIds: new Set(["ai-kimi"]),
      aiParticipantIds: new Set(["ai-kimi"]),
      eligibleCandidateIds: new Set(["ai-kimi"]),
      availablePutativeIds: new Set(["ai-kimi"]),
      messageIds: new Set(["msg-1"]),
      maxTurns: 2,
      remainingBudget: 2,
    });
    expect(replyRejected.errors).toContain("REPLY_TO_UNKNOWN");
  });

  it("budget e ceiling de turnos são respeitados", async () => {
    const { plan } = await runScenario({ content: "vocês viram a corrida?", budgetRemaining: 1 });
    expect(plan.turns.length).toBeLessThanOrEqual(1);
    expect(plan.continuation).toBe("STOP");
  });

  it("plano vazio recebe fallback seguro", async () => {
    const { candidateSet } = await runScenario({
      content: "bom dia",
      participants: [
        { characterId: "ai-off", name: "Offline", controller: "AI", available: false },
        { characterId: "user-alicya", name: "Alicya", controller: "USER", available: true },
      ],
    });
    const fallback = safePlan(candidateSet);
    expect(fallback.turns).toEqual([]);
    expect(fallback.stopReason).toBe("PLANNER_DECLINED");
    expect(fallback.continuation).toBe("STOP");
  });

  it("STOP é possível mesmo com candidatos", async () => {
    const { plan } = await runScenario({ content: "bom dia amigos" });
    if (plan.turns.length === 0) {
      expect(plan.continuation).toBe("STOP");
      expect(plan.stopReason).toBe("NO_OPPORTUNITY");
    } else {
      expect(["SELECTED"]).toContain(plan.stopReason);
    }
  });

  it("contratos Zod aceitam plano, utterance e metadata válidos", async () => {
    const { plan } = await runScenario({ content: "bom dia amigos" });
    expect(DialoguePlanSchema.safeParse(plan).success).toBe(true);
    expect(
      DialogueUtteranceSchema.safeParse({
        speakerCharacterId: "ai-kimi",
        replyToMessageId: "msg-1",
        intent: "REACTION",
        messages: [{ text: "bom dia ❤️", fragmentIndex: 0 }],
      }).success,
    ).toBe(true);
    expect(
      MessageDialogueMetadataSchema.safeParse({
        responseType: "REACTION",
        replyToMessageId: "msg-1",
        fragmentIndex: 0,
        topicTag: null,
      }).success,
    ).toBe(true);
    expect(MessageDialogueMetadataSchema.safeParse({ responseType: "INVALID" }).success).toBe(false);
  });

  it("determinismo: mesmos inputs produzem o mesmo plano e mesmo candidate set", async () => {
    const a = await runScenario({ content: "vocês viram a corrida?" });
    const b = await runScenario({ content: "vocês viram a corrida?" });
    expect(a.plan).toEqual(b.plan);
    expect(a.candidateSet.candidates).toEqual(b.candidateSet.candidates);
  });
});
