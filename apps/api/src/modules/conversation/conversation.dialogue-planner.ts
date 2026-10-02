import { performance } from "node:perf_hooks";

import {
  buildFallbackPlan,
  DeterministicDialoguePlanner,
  DialoguePlanSchema,
  type DialogueCandidateSet,
  type DialoguePlan,
  type DialoguePlanner,
  type DialoguePlannerInput,
} from "./conversation.dialogue.js";

export type DialoguePlannerKind = "off" | "deterministic" | "llm";

export type DialoguePlannerContext = {
  readonly conversationId: string;
  readonly universeId: string;
  readonly lastMessageId: string;
  readonly lastMessageContent: string;
  readonly depth: number;
  readonly energyLevel: string;
  readonly window: {
    readonly maxInitialResponders: number;
    readonly maxReactions: number;
    readonly maxChainDepth: number;
  };
  readonly allowedMessageIds: readonly string[];
  readonly participants: ReadonlyArray<{
    readonly characterId: string;
    readonly name: string;
    readonly score: number;
    readonly opportunity: number;
    readonly eligible: boolean;
    readonly reasons: readonly string[];
    readonly allowedIntents: readonly string[];
  }>;
};

export interface DialoguePlannerProvider {
  readonly name: string;
  readonly model?: string;
  plan(context: DialoguePlannerContext): Promise<unknown>;
}

export type LlmPlannerTrace = {
  readonly plannerKind: "llm";
  readonly provider: string;
  readonly model: string | null;
  readonly latencyMs: number;
  readonly valid: boolean;
  readonly fallback: boolean;
  readonly invalidReason: string | null;
};

export function resolveDialoguePlannerKind(
  value: string | undefined = process.env.DIALOGUE_PLANNER,
): DialoguePlannerKind {
  if (value === "llm") return "llm";
  if (value === "off") return "off";
  return "deterministic";
}

export function buildDialoguePlannerContext(
  input: DialoguePlannerInput,
  allowedMessageIds: readonly string[],
): DialoguePlannerContext {
  const { candidateSet } = input;
  return {
    conversationId: candidateSet.conversationId,
    universeId: candidateSet.universeId,
    lastMessageId: candidateSet.lastMessageId,
    lastMessageContent: candidateSet.lastMessageContent,
    depth: candidateSet.depth,
    energyLevel: candidateSet.energy.level,
    window: {
      maxInitialResponders: candidateSet.window.maxInitialResponders,
      maxReactions: candidateSet.window.maxReactions,
      maxChainDepth: candidateSet.window.maxChainDepth,
    },
    allowedMessageIds,
    participants: candidateSet.candidates.map((candidate) => ({
      characterId: candidate.characterId,
      name: candidate.name,
      score: candidate.score,
      opportunity: candidate.opportunity,
      eligible: candidate.eligible,
      reasons: candidate.reasons,
      allowedIntents: candidate.allowedIntents,
    })),
  };
}

export class LlmDialoguePlanner implements DialoguePlanner {
  readonly kind = "llm" as const;
  private trace: LlmPlannerTrace | null = null;
  private readonly deterministic = new DeterministicDialoguePlanner();

  constructor(private readonly provider: DialoguePlannerProvider) {}

  get lastTrace(): LlmPlannerTrace | null {
    return this.trace;
  }

  async plan(input: DialoguePlannerInput): Promise<DialoguePlan> {
    const started = performance.now();
    const allowedMessageIds = [input.candidateSet.lastMessageId];
    const context = buildDialoguePlannerContext(input, allowedMessageIds);
    try {
      const raw = await this.provider.plan(context);
      const parsed = DialoguePlanSchema.safeParse(raw);
      if (!parsed.success) return this.fallback(input, "INVALID_SCHEMA", started);
      const eligibleIds = new Set(
        input.candidateSet.selected.map((candidate) => candidate.characterId),
      );
      const allowedReplies = new Set(allowedMessageIds);
      for (const turn of parsed.data.turns) {
        if (!eligibleIds.has(turn.speakerCharacterId)) {
          return this.fallback(input, "UNKNOWN_SPEAKER", started);
        }
        if (turn.replyToMessageId !== null && !allowedReplies.has(turn.replyToMessageId)) {
          return this.fallback(input, "UNKNOWN_REPLY_TO", started);
        }
      }
      this.trace = {
        plannerKind: "llm",
        provider: this.provider.name,
        model: this.provider.model ?? null,
        latencyMs: Math.round(performance.now() - started),
        valid: true,
        fallback: false,
        invalidReason: null,
      };
      return parsed.data;
    } catch {
      return this.fallback(input, "PROVIDER_ERROR", started);
    }
  }

  private async fallback(
    input: DialoguePlannerInput,
    reason: string,
    started: number,
  ): Promise<DialoguePlan> {
    const plan = await this.deterministic.plan(input);
    this.trace = {
      plannerKind: "llm",
      provider: this.provider.name,
      model: this.provider.model ?? null,
      latencyMs: Math.round(performance.now() - started),
      valid: false,
      fallback: true,
      invalidReason: reason,
    };
    return plan;
  }
}

export function createDialoguePlanner(
  kind: DialoguePlannerKind,
  provider?: DialoguePlannerProvider,
): DialoguePlanner {
  if (kind === "llm" && provider) return new LlmDialoguePlanner(provider);
  return new DeterministicDialoguePlanner();
}

export function plannerFallbackFor(candidateSet: DialogueCandidateSet): DialoguePlan {
  return buildFallbackPlan(candidateSet);
}
