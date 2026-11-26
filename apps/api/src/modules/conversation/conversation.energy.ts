export type ConversationEnergyLevel = "QUIET" | "NORMAL" | "ACTIVE" | "HIGHLY_ACTIVE";

export type ConversationEnergySignal =
  | "QUESTION"
  | "DIRECT_ADDRESS"
  | "HIGH_INTENSITY"
  | "TOPIC_F1"
  | "LONG_MESSAGE"
  | "RECENT_ACTIVITY"
  | "GREETING"
  | "SHORT_MESSAGE";

export type ConversationEnergy = {
  readonly energy: number;
  readonly intensity: number;
  readonly level: ConversationEnergyLevel;
  readonly reasons: readonly ConversationEnergySignal[];
};

const HIGH_INTENSITY_PATTERN =
  /\b(nervos[ao]|nervosa|ajuda|socorro|urgente|amor|odeio|raiva|chorar|triste|feliz|incrível|inacreditável|não acredito|mentira|absurdo)\b/;
const TOPIC_PATTERN = /\b(corrida|classifica|qualifica|resultado|gp|grande prêmio|podium|pódio|pole|volta|equipe|motor|carro)\b/;
const GREETING_PATTERN = /^\s*(bom dia|boa tarde|boa noite|oi|olá|e aí|eai)\b/;
const LAUGH_PATTERN = /\b(kkk+|rsrs+|haha+|hahaha+)\b/;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function evaluateConversationEnergy(input: {
  readonly message: string;
  readonly participantCount: number;
  readonly recentAiMessages: number;
}): ConversationEnergy {
  const text = input.message.trim();
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const reasons: ConversationEnergySignal[] = [];
  let energy = 0.3;
  let intensity = 0.1;

  if (text.includes("?")) {
    energy += 0.15;
    reasons.push("QUESTION");
  }
  if (text.length >= 120) {
    energy += 0.1;
    reasons.push("LONG_MESSAGE");
  } else if (text.length <= 12) {
    energy -= 0.05;
    reasons.push("SHORT_MESSAGE");
  }
  if (HIGH_INTENSITY_PATTERN.test(normalized) || LAUGH_PATTERN.test(normalized)) {
    energy += 0.25;
    intensity += 0.45;
    reasons.push("HIGH_INTENSITY");
  }
  if (TOPIC_PATTERN.test(normalized)) {
    energy += 0.2;
    intensity += 0.15;
    reasons.push("TOPIC_F1");
  }
  if (GREETING_PATTERN.test(normalized)) {
    energy += 0.1;
    reasons.push("GREETING");
  }
  if (/[A-ZÀ-Ý]{4,}/.test(text) || text.includes("!!")) {
    intensity += 0.25;
    energy += 0.1;
    if (!reasons.includes("HIGH_INTENSITY")) reasons.push("HIGH_INTENSITY");
  }
  if (input.recentAiMessages > 0) {
    energy += Math.min(0.2, input.recentAiMessages * 0.07);
    reasons.push("RECENT_ACTIVITY");
  }
  if (input.participantCount >= 4) energy += 0.05;

  const finalEnergy = clamp01(energy);
  const finalIntensity = clamp01(intensity);
  const level: ConversationEnergyLevel =
    finalEnergy >= 0.75
      ? "HIGHLY_ACTIVE"
      : finalEnergy >= 0.5
        ? "ACTIVE"
        : finalEnergy >= 0.3
          ? "NORMAL"
          : "QUIET";
  return { energy: finalEnergy, intensity: finalIntensity, level, reasons };
}

export type ResponseWindowStopThresholds = {
  readonly initial: number;
  readonly reaction: number;
};

export type ResponseWindow = {
  readonly maxInitialResponders: number;
  readonly maxReactions: number;
  readonly maxChainDepth: number;
  readonly stopThresholds: ResponseWindowStopThresholds;
  readonly reactionAllowance: number;
  readonly reasonCodes: readonly string[];
};

export function planResponseWindow(
  energy: ConversationEnergy,
  options: { readonly budgetRemaining: number },
): ResponseWindow {
  const template: Record<
    ConversationEnergyLevel,
    { initial: number; reactions: number; depth: number; initialThreshold: number; reactionThreshold: number }
  > = {
    QUIET: { initial: 1, reactions: 1, depth: 1, initialThreshold: 31, reactionThreshold: 37 },
    NORMAL: { initial: 2, reactions: 1, depth: 2, initialThreshold: 28, reactionThreshold: 34 },
    ACTIVE: { initial: 3, reactions: 2, depth: 3, initialThreshold: 24, reactionThreshold: 30 },
    HIGHLY_ACTIVE: { initial: 4, reactions: 3, depth: 4, initialThreshold: 20, reactionThreshold: 26 },
  };
  const selected = template[energy.level];
  const intensityBoost = energy.intensity >= 0.5 ? 1 : 0;
  const ceiling = Math.max(0, options.budgetRemaining);
  return {
    maxInitialResponders: Math.max(0, Math.min(selected.initial + intensityBoost, ceiling)),
    maxReactions: Math.max(0, Math.min(selected.reactions, ceiling)),
    maxChainDepth: Math.max(1, Math.min(selected.depth, ceiling)),
    stopThresholds: {
      initial: selected.initialThreshold,
      reaction: selected.reactionThreshold,
    },
    reactionAllowance: energy.intensity >= 0.5 ? 2 : 1,
    reasonCodes: [
      `ENERGY_${energy.level}`,
      ...(intensityBoost > 0 ? ["INTENSITY_BOOST"] : []),
      ...energy.reasons.slice(0, 4),
    ],
  };
}
