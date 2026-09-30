import type { MemoryImportance, PilotExperienceType } from "@prisma/client";

import { compareSalience, type DerivedExperience } from "./pilot-experience.derive.js";

export type MemoryRuleDecision =
  | { readonly derive: false; readonly ruleCode: string; readonly reason: string }
  | {
      readonly derive: true;
      readonly ruleCode: string;
      readonly memoryType: PilotExperienceType;
      readonly importance: MemoryImportance;
    };

export type MemoryProjectionContext = {
  readonly firstWinExperienceId: string | null;
};

export function decideMemoryRule(
  experience: { readonly experienceType: PilotExperienceType; readonly salience: MemoryImportance },
  context: MemoryProjectionContext,
): MemoryRuleDecision {
  switch (experience.experienceType) {
    case "CHAMPIONSHIP":
      return {
        derive: true,
        ruleCode: "championship-memory",
        memoryType: "CHAMPIONSHIP",
        importance: "CRITICAL",
      };
    case "SPORTING_VICTORY":
      if (context.firstWinExperienceId !== null) {
        return {
          derive: true,
          ruleCode: "first-win-memory",
          memoryType: "SPORTING_VICTORY",
          importance: "HIGH",
        };
      }
      return {
        derive: true,
        ruleCode: "win-memory",
        memoryType: "SIGNIFICANT_RACE",
        importance: "LOW",
      };
    case "SPORTING_DEFEAT":
      return experience.salience === "LOW"
        ? { derive: false, ruleCode: "defeat-low", reason: "salience baixa" }
        : {
            derive: true,
            ruleCode: "defeat-memory",
            memoryType: "SPORTING_DEFEAT",
            importance: "HIGH",
          };
    case "CAREER_MILESTONE":
      return {
        derive: true,
        ruleCode: "career-milestone-memory",
        memoryType: "CAREER_MILESTONE",
        importance: "MEDIUM",
      };
    case "TEAM_CHANGE":
      return {
        derive: true,
        ruleCode: "team-change-memory",
        memoryType: "TEAM_CHANGE",
        importance: "MEDIUM",
      };
    case "RELATIONSHIP_EVENT":
      return {
        derive: true,
        ruleCode: "relationship-memory",
        memoryType: "RELATIONSHIP_EVENT",
        importance: "MEDIUM",
      };
    case "NARRATIVE_EVENT":
      return {
        derive: true,
        ruleCode: "narrative-memory",
        memoryType: "NARRATIVE_EVENT",
        importance: experience.salience,
      };
    case "CONFLICT":
      return {
        derive: true,
        ruleCode: "conflict-memory",
        memoryType: "CONFLICT",
        importance: "HIGH",
      };
    case "PERSONAL_MILESTONE":
    case "OTHER_RELEVANT_EXPERIENCE":
      return experience.salience === "LOW"
        ? { derive: false, ruleCode: "curated-low", reason: "salience baixa" }
        : {
            derive: true,
            ruleCode: "curated-memory",
            memoryType: experience.experienceType,
            importance: experience.salience,
          };
    case "SIGNIFICANT_RACE":
      return { derive: false, ruleCode: "significant-race", reason: "evento comum sem memória durável" };
    default:
      return { derive: false, ruleCode: "unknown", reason: "tipo sem regra" };
  }
}

export function renderMemory(experience: DerivedExperience, memoryType: PilotExperienceType): string {
  if (memoryType !== experience.experienceType) {
    return `${experience.title}.`;
  }
  switch (experience.experienceType) {
    case "SPORTING_VICTORY":
      return `${experience.title} — primeira vitória deste piloto neste Universe.`;
    case "CHAMPIONSHIP":
      return `${experience.title}.`;
    case "SPORTING_DEFEAT":
      return `${experience.title}.`;
    case "CAREER_MILESTONE":
      return `${experience.title}.`;
    case "TEAM_CHANGE":
      return `${experience.title}.`;
    case "RELATIONSHIP_EVENT":
      return `${experience.title}.`;
    case "NARRATIVE_EVENT":
      return `${experience.title}.`;
    case "CONFLICT":
      return `${experience.title}.`;
    default:
      return experience.summary ? `${experience.title}: ${experience.summary}` : `${experience.title}.`;
  }
}

export type ProjectedMemory = {
  readonly derivedKey: string;
  readonly memoryType: PilotExperienceType;
  readonly importance: MemoryImportance;
  readonly ruleCode: string;
  readonly content: string;
  readonly summary: string;
  readonly experience: DerivedExperience;
};

const ORDER_EPOCH = 0;

export function projectMemories(experiences: readonly DerivedExperience[]): ProjectedMemory[] {
  const winExperiences = experiences.filter(
    (experience) => experience.experienceType === "SPORTING_VICTORY",
  );
  const orderedWins = [...winExperiences].sort((a, b) => {
    const aTime = a.occurredAt?.getTime() ?? ORDER_EPOCH;
    const bTime = b.occurredAt?.getTime() ?? ORDER_EPOCH;
    if (aTime !== bTime) return aTime - bTime;
    return a.sourceKey.localeCompare(b.sourceKey);
  });
  const firstWinKey = orderedWins[0]?.sourceKey ?? null;
  const projected: ProjectedMemory[] = [];

  const ordered = [...experiences].sort((a, b) => {
    const aTime = a.occurredAt?.getTime() ?? ORDER_EPOCH;
    const bTime = b.occurredAt?.getTime() ?? ORDER_EPOCH;
    if (aTime !== bTime) return bTime - aTime;
    const salienceDiff = compareSalience(a.salience, b.salience);
    if (salienceDiff !== 0) return salienceDiff;
    return a.sourceKey.localeCompare(b.sourceKey);
  });

  for (const experience of ordered) {
    const decision = decideMemoryRule(experience, {
      firstWinExperienceId: firstWinKey === experience.sourceKey ? experience.sourceKey : null,
    });
    if (!decision.derive) continue;
    projected.push({
      derivedKey: `${experience.sourceKey}:${decision.ruleCode}`,
      memoryType: decision.memoryType,
      importance: decision.importance,
      ruleCode: decision.ruleCode,
      content: renderMemory(experience, decision.memoryType),
      summary: experience.title,
      experience,
    });
  }
  return projected;
}
