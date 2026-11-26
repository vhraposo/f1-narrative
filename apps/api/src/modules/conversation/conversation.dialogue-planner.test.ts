import { describe, expect, it } from "vitest";

import type { CandidateSetEntry, DialogueCandidateSet, DialoguePlan } from "./conversation.dialogue.js";
import {
  createDialoguePlanner,
  LlmDialoguePlanner,
  resolveDialoguePlannerKind,
  type DialoguePlannerProvider,
} from "./conversation.dialogue-planner.js";
import { DeterministicDialoguePlanner } from "./conversation.dialogue.js";

const candidateSet: DialogueCandidateSet = {
  conversationId: "conv-1",
  universeId: "uni-1",
  lastMessageId: "msg-1",
  lastMessageContent: "bom dia amigos",
  depth: 0,
  energy: { energy: 0.4, intensity: 0.1, level: "NORMAL", reasons: ["GREETING"] },
  window: {
    maxInitialResponders: 2,
    maxReactions: 1,
    maxChainDepth: 2,
    stopThresholds: { initial: 28, reaction: 34 },
    reactionAllowance: 1,
    reasonCodes: ["ENERGY_NORMAL"],
  },
  candidates: [
    {
      characterId: "ai-kimi",
      name: "Kimi",
      eligible: true,
      opportunity: 0.6,
      score: 40,
      reasons: ["SOCIAL_BASELINE"],
      allowedIntents: ["ANSWER", "REACTION"],
      recentActivity: 0,
    },
  ],
  selected: [
    {
      characterId: "ai-kimi",
      name: "Kimi",
      eligible: true,
      opportunity: 0.6,
      score: 40,
      reasons: ["SOCIAL_BASELINE"],
      allowedIntents: ["ANSWER", "REACTION"],
      recentActivity: 0,
    },
  ],
  rejected: [],
};

const input = { candidateSet };

function validPlan(): DialoguePlan {
  return {
    conversationIntent: "CONTINUE",
    topic: null,
    emotionalTone: "PLAYFUL",
    turns: [
      {
        speakerCharacterId: "ai-kimi",
        replyToMessageId: "msg-1",
        intent: "REACTION",
        maxMessages: 1,
        priority: 0.6,
      },
    ],
    continuation: "RE_EVALUATE",
    stopReason: "SELECTED",
  };
}

function providerReturning(value: unknown): DialoguePlannerProvider {
  return { name: "stub", model: "stub-1", async plan() { return value; } };
}

function providerFailing(): DialoguePlannerProvider {
  return { name: "failing", async plan() { throw new Error("provider indisponível"); } };
}

describe("F2B — LLM dialogue planner atrás de flag", () => {
  it("flag default é deterministic; off e llm são reconhecidos", () => {
    expect(resolveDialoguePlannerKind(undefined)).toBe("deterministic");
    expect(resolveDialoguePlannerKind("")).toBe("deterministic");
    expect(resolveDialoguePlannerKind("off")).toBe("off");
    expect(resolveDialoguePlannerKind("llm")).toBe("llm");
  });

  it("provider ausente cai para deterministic mesmo com kind llm", () => {
    const planner = createDialoguePlanner("llm");
    expect(planner.kind).toBe("deterministic");
  });

  it("provider presente com kind llm cria LlmDialoguePlanner", () => {
    const planner = createDialoguePlanner("llm", providerReturning(validPlan()));
    expect(planner.kind).toBe("llm");
  });

  it("structured output válido é aceito com trace sem fallback", async () => {
    const planner = new LlmDialoguePlanner(providerReturning(validPlan()));
    const plan = await planner.plan(input);
    expect(plan).toEqual(validPlan());
    expect(planner.lastTrace?.valid).toBe(true);
    expect(planner.lastTrace?.fallback).toBe(false);
    expect(planner.lastTrace?.provider).toBe("stub");
  });

  it("provider que falha usa fallback determinístico", async () => {
    const planner = new LlmDialoguePlanner(providerFailing());
    const plan = await planner.plan(input);
    const expected = await new DeterministicDialoguePlanner().plan(input);
    expect(plan).toEqual(expected);
    expect(planner.lastTrace?.fallback).toBe(true);
    expect(planner.lastTrace?.invalidReason).toBe("PROVIDER_ERROR");
  });

  it("schema inválido usa fallback INVALID_SCHEMA", async () => {
    const planner = new LlmDialoguePlanner(providerReturning({ turns: "nope" }));
    await planner.plan(input);
    expect(planner.lastTrace?.invalidReason).toBe("INVALID_SCHEMA");
  });

  it("speaker desconhecido usa fallback UNKNOWN_SPEAKER", async () => {
    const forged = validPlan();
    forged.turns[0]!.speakerCharacterId = "ai-fora";
    const planner = new LlmDialoguePlanner(providerReturning(forged));
    await planner.plan(input);
    expect(planner.lastTrace?.invalidReason).toBe("UNKNOWN_SPEAKER");
  });

  it("replyTo desconhecido usa fallback UNKNOWN_REPLY_TO", async () => {
    const forged = validPlan();
    forged.turns[0]!.replyToMessageId = "msg-999";
    const planner = new LlmDialoguePlanner(providerReturning(forged));
    await planner.plan(input);
    expect(planner.lastTrace?.invalidReason).toBe("UNKNOWN_REPLY_TO");
  });

  it("USER ou participante externo nunca passa (não está no candidate set)", async () => {
    const forged = validPlan();
    forged.turns[0]!.speakerCharacterId = "user-alicya";
    const planner = new LlmDialoguePlanner(providerReturning(forged));
    await planner.plan(input);
    expect(planner.lastTrace?.invalidReason).toBe("UNKNOWN_SPEAKER");
  });

  it("contexto do provider usa allowlist de IDs", async () => {
    let received: { participants: ReadonlyArray<{ characterId: string }>; allowedMessageIds: readonly string[] } | null = null;
    const provider: DialoguePlannerProvider = {
      name: "capture",
      async plan(context) {
        received = context;
        return validPlan();
      },
    };
    await new LlmDialoguePlanner(provider).plan(input);
    expect(received!.participants.map((p) => p.characterId)).toEqual(["ai-kimi"]);
    expect(received!.allowedMessageIds).toEqual(["msg-1"]);
  });

  it("schema roundtrip mantém o plano determinístico", async () => {
    const deterministic = await new DeterministicDialoguePlanner().plan(input);
    const planner = new LlmDialoguePlanner(providerReturning(deterministic));
    const plan = await planner.plan(input);
    expect(plan).toEqual(deterministic);
    expect(planner.lastTrace?.fallback).toBe(false);
  });
});

describe("F6.3 — primeiro speaker preferido da oportunidade", () => {
  function entry(characterId: string, score: number): CandidateSetEntry {
    return {
      characterId,
      name: characterId,
      eligible: true,
      opportunity: score / 100,
      score,
      reasons: ["SOCIAL_BASELINE"],
      allowedIntents: ["REACTION"],
      recentActivity: 0,
    };
  }

  function twoSpeakers(): DialogueCandidateSet {
    const a = entry("ai-a", 40);
    const b = entry("ai-b", 39);
    return { ...candidateSet, candidates: [a, b], selected: [a, b], rejected: [] };
  }

  it("honra o primeiro speaker da oportunidade", async () => {
    const plan = await new DeterministicDialoguePlanner().plan({
      candidateSet: twoSpeakers(),
      preferredFirstSpeakerCharacterId: "ai-b",
    });
    expect(plan.turns[0]?.speakerCharacterId).toBe("ai-b");
  });

  it("sem preferência mantém o ranking por score", async () => {
    const plan = await new DeterministicDialoguePlanner().plan({ candidateSet: twoSpeakers() });
    expect(plan.turns[0]?.speakerCharacterId).toBe("ai-a");
  });
});
