import type { EventImportance, EventType } from "@prisma/client";

export type RelationshipDimension = "affinity" | "trust" | "rivalry";

export type SocialRuleDelta = {
  readonly affinity: number;
  readonly trust: number;
  readonly rivalry: number;
};

export type SocialRule = {
  readonly ruleCode: string;
  readonly trigger: EventType;
  readonly deltas: SocialRuleDelta;
};

export const RELATIONSHIP_DIMENSION_MIN = -100;
export const RELATIONSHIP_DIMENSION_MAX = 100;

const IMPORTANCE_WEIGHT: Record<EventImportance, number> = {
  LOW: 0.5,
  MEDIUM: 1,
  HIGH: 1.5,
  CRITICAL: 2,
};

const BASE_DELTAS: Record<EventType, SocialRuleDelta> = {
  RACE: { affinity: 0, trust: 0, rivalry: 0 },
  RACE_INCIDENT: { affinity: -20, trust: -10, rivalry: 30 },
  RELATIONSHIP: { affinity: 25, trust: 20, rivalry: -10 },
  SOCIAL: { affinity: 10, trust: 5, rivalry: 0 },
  PERSONAL: { affinity: 0, trust: 0, rivalry: 0 },
  NEWS: { affinity: 0, trust: 0, rivalry: 0 },
  WORLD: { affinity: 0, trust: 0, rivalry: 0 },
};

const RULE_CODES: Record<EventType, string> = {
  RACE: "relationship-rule.race.v1",
  RACE_INCIDENT: "relationship-rule.incident.v1",
  RELATIONSHIP: "relationship-rule.relationship-event.v1",
  SOCIAL: "relationship-rule.support.v1",
  PERSONAL: "relationship-rule.personal.v1",
  NEWS: "relationship-rule.news.v1",
  WORLD: "relationship-rule.world.v1",
};

export function socialRuleForEvent(
  type: EventType,
  importance: EventImportance,
): SocialRule {
  const base = BASE_DELTAS[type];
  const weight = IMPORTANCE_WEIGHT[importance];
  return {
    ruleCode: RULE_CODES[type],
    trigger: type,
    deltas: {
      affinity: Math.round(base.affinity * weight),
      trust: Math.round(base.trust * weight),
      rivalry: Math.round(base.rivalry * weight),
    },
  };
}

export function clampRelationshipDimension(value: number): number {
  return Math.min(RELATIONSHIP_DIMENSION_MAX, Math.max(RELATIONSHIP_DIMENSION_MIN, Math.round(value)));
}
