import type { BehaviorContextView, BehaviorDecisionResult } from "./behavior.types.js";

export type BehaviorLanguageInput = {
  readonly context: BehaviorContextView;
  readonly decision: BehaviorDecisionResult;
};

export type BehaviorLanguageOutput = {
  readonly text: string;
  readonly provider: string;
  readonly model: string;
  readonly fallback: boolean;
};

export interface BehaviorLanguageEngine {
  compose(input: BehaviorLanguageInput): Promise<BehaviorLanguageOutput>;
}

const REASON_PHRASES: Record<string, string> = {
  POLICY_RESPOND_TO_DIRECT_MESSAGE: "responde à mensagem recebida",
  POLICY_REACT_TO_WORLD_CHANGE: "comenta o que aconteceu no mundo",
  POLICY_CONSOLIDATE_SIGNIFICANT_EXPERIENCE: "registra o que essa experiência significou",
  POLICY_APPLY_SOCIAL_CONSEQUENCE: "reage socialmente ao que aconteceu",
  POLICY_EMIT_SCHEDULED_EVENT: "segue a agenda planejada",
  POLICY_NO_ACTION_BASELINE: "mantém-se em silêncio por enquanto",
};

export function deterministicTextFor(
  context: BehaviorContextView,
  reasonCode: string,
): string {
  const phrase = REASON_PHRASES[reasonCode] ?? "decide não agir agora";
  return `${context.identity.name} ${phrase}.`;
}

export function createDeterministicLanguageEngine(): BehaviorLanguageEngine {
  return {
    async compose(input) {
      return {
        text: deterministicTextFor(input.context, input.decision.reasonCode),
        provider: "deterministic",
        model: "behavior-language.v1",
        fallback: true,
      };
    },
  };
}
