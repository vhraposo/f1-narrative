import { createHash } from "node:crypto";

import type { CharacterGoal, CharacterGoalKind } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import type {
  BehaviorContextView,
  BehaviorDecisionRequest,
  ResolvedGoal,
} from "./behavior.types.js";

export const GOAL_RULE_CODES = {
  WIN_RACE: "goal-rule.race-win.v1",
  WIN_CHAMPIONSHIP: "goal-rule.championship-challenge.v1",
  OUTPERFORM_TEAMMATE: "goal-rule.teammate-performance.v1",
  RECOVER_AFTER_SETBACK: "goal-rule.recover-after-setback.v1",
  PROTECT_RELATIONSHIP: "goal-rule.protect-relationship.v1",
  CONFRONT_RIVAL: "goal-rule.confront-rival.v1",
} as const;

export const GOAL_PRIORITIES: Record<CharacterGoalKind, number> = {
  WIN_RACE: 100,
  WIN_CHAMPIONSHIP: 90,
  RECOVER_AFTER_SETBACK: 80,
  OUTPERFORM_TEAMMATE: 70,
  CONFRONT_RIVAL: 65,
  USER_DEFINED_GOAL: 60,
  PROTECT_RELATIONSHIP: 55,
  MAINTAIN_POSITION: 50,
  SUPPORT_FRIEND: 45,
  BUILD_REPUTATION: 40,
  RESTORE_CONFIDENCE: 35,
};

const SETBACK_DAYS = 7;
const PROTECT_RELATIONSHIP_RIVALRY = 0.5;
const CONFRONT_RIVAL_RIVALRY = 0.7;

export type GoalDerivation = {
  readonly kind: CharacterGoalKind;
  readonly priority: number;
  readonly ruleCode: string;
  readonly targetCharacterId: string | null;
  readonly targetRaceId: string | null;
  readonly seasonId: string | null;
  readonly validTo: Date | null;
};

export type GoalReconcileReport = {
  readonly goals: readonly ResolvedGoal[];
  readonly created: number;
  readonly reactivated: number;
  readonly completed: number;
  readonly failed: number;
  readonly expired: number;
  readonly manualConflicts: number;
};

export function goalFingerprint(input: {
  universeId: string;
  characterId: string;
  kind: CharacterGoalKind;
  targetCharacterId: string | null;
  targetRaceId: string | null;
  seasonId: string | null;
  ruleCode: string;
  validTo: Date | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        universeId: input.universeId,
        characterId: input.characterId,
        kind: input.kind,
        targetCharacterId: input.targetCharacterId,
        targetRaceId: input.targetRaceId,
        seasonId: input.seasonId,
        ruleCode: input.ruleCode,
        validity: input.validTo ? input.validTo.toISOString().slice(0, 10) : null,
      }),
    )
    .digest("hex");
}

function significantSetback(context: BehaviorContextView): boolean {
  return context.experience.recent.some(
    (experience) =>
      (experience.experienceType === "SPORTING_DEFEAT" ||
        experience.experienceType === "CONFLICT") &&
      (experience.salience === "HIGH" || experience.salience === "CRITICAL"),
  );
}

function topRivalryEntry(
  context: BehaviorContextView,
): { otherCharacterId: string; rivalry: number } | null {
  const entries = context.relationships.entries
    .map((entry) => ({
      otherCharacterId: entry.otherCharacterId,
      rivalry: entry.dimensions.rivalry ?? 0,
    }))
    .filter((entry) => entry.rivalry > 0)
    .sort((a, b) => {
      if (b.rivalry !== a.rivalry) return b.rivalry - a.rivalry;
      return a.otherCharacterId.localeCompare(b.otherCharacterId);
    });
  return entries[0] ?? null;
}

export function deriveGoalCandidates(
  context: BehaviorContextView,
  request: BehaviorDecisionRequest,
  options: { readonly currentRaceStatus?: string | null } = {},
): GoalDerivation[] {
  const derivations: GoalDerivation[] = [];
  const currentRaceStatus =
    options.currentRaceStatus ?? context.currentState.race?.status ?? null;
  const seasonId = context.world.currentSeasonId;
  const standing = context.motorsport.standing;

  if (
    context.identity.controller === "AI" &&
    context.world.currentRaceId !== null &&
    currentRaceStatus !== "FINISHED"
  ) {
    derivations.push({
      kind: "WIN_RACE",
      priority: GOAL_PRIORITIES.WIN_RACE,
      ruleCode: GOAL_RULE_CODES.WIN_RACE,
      targetCharacterId: null,
      targetRaceId: context.world.currentRaceId,
      seasonId,
      validTo: null,
    });
  }

  if (
    context.identity.controller === "AI" &&
    seasonId !== null &&
    standing?.position !== null &&
    standing?.position !== undefined &&
    standing.position <= 3
  ) {
    derivations.push({
      kind: "WIN_CHAMPIONSHIP",
      priority: GOAL_PRIORITIES.WIN_CHAMPIONSHIP,
      ruleCode: GOAL_RULE_CODES.WIN_CHAMPIONSHIP,
      targetCharacterId: null,
      targetRaceId: null,
      seasonId,
      validTo: null,
    });
  }

  const teammate = context.motorsport.teammate;
  if (
    context.identity.controller === "AI" &&
    teammate &&
    standing?.position !== null &&
    standing?.position !== undefined &&
    teammate.position !== null &&
    standing.position > teammate.position
  ) {
    derivations.push({
      kind: "OUTPERFORM_TEAMMATE",
      priority: GOAL_PRIORITIES.OUTPERFORM_TEAMMATE,
      ruleCode: GOAL_RULE_CODES.OUTPERFORM_TEAMMATE,
      targetCharacterId: teammate.characterId,
      targetRaceId: null,
      seasonId,
      validTo: null,
    });
  }

  if (context.identity.controller === "AI" && significantSetback(context)) {
    derivations.push({
      kind: "RECOVER_AFTER_SETBACK",
      priority: GOAL_PRIORITIES.RECOVER_AFTER_SETBACK,
      ruleCode: GOAL_RULE_CODES.RECOVER_AFTER_SETBACK,
      targetCharacterId: null,
      targetRaceId: null,
      seasonId,
      validTo: new Date(request.worldDate.getTime() + SETBACK_DAYS * 24 * 60 * 60 * 1000),
    });
  }

  const rival = topRivalryEntry(context);
  if (rival && rival.rivalry >= PROTECT_RELATIONSHIP_RIVALRY) {
    derivations.push({
      kind: "PROTECT_RELATIONSHIP",
      priority: GOAL_PRIORITIES.PROTECT_RELATIONSHIP,
      ruleCode: GOAL_RULE_CODES.PROTECT_RELATIONSHIP,
      targetCharacterId: rival.otherCharacterId,
      targetRaceId: null,
      seasonId,
      validTo: null,
    });
  }

  if (rival && rival.rivalry >= CONFRONT_RIVAL_RIVALRY && significantSetback(context)) {
    derivations.push({
      kind: "CONFRONT_RIVAL",
      priority: GOAL_PRIORITIES.CONFRONT_RIVAL,
      ruleCode: GOAL_RULE_CODES.CONFRONT_RIVAL,
      targetCharacterId: rival.otherCharacterId,
      targetRaceId: null,
      seasonId,
      validTo: new Date(request.worldDate.getTime() + SETBACK_DAYS * 24 * 60 * 60 * 1000),
    });
  }

  return derivations;
}

function toResolvedGoal(goal: CharacterGoal): ResolvedGoal {
  return {
    id: goal.id,
    kind: goal.kind,
    priority: goal.priority,
    status: goal.status,
    source: goal.source,
    ruleCode: goal.ruleCode,
    fingerprint: goal.fingerprint,
    targetCharacterId: goal.targetCharacterId,
    targetRaceId: goal.targetRaceId,
    seasonId: goal.seasonId,
    validTo: goal.validTo,
  };
}

export async function listActiveGoals(
  universeId: string,
  characterId: string,
): Promise<ResolvedGoal[]> {
  const goals = await prisma.characterGoal.findMany({
    where: { universeId, characterId, status: { in: ["ACTIVE", "PAUSED"] } },
    orderBy: [{ priority: "desc" }, { kind: "asc" }, { id: "asc" }],
  });
  return goals.map(toResolvedGoal);
}

export async function resolveCharacterGoals(
  context: BehaviorContextView,
  request: BehaviorDecisionRequest,
): Promise<ResolvedGoal[]> {
  const persisted = await listActiveGoals(request.universeId, request.characterId);
  const derivations = deriveGoalCandidates(context, request);
  const existing = new Set(persisted.map((goal) => goal.fingerprint).filter(Boolean));
  const synthetic = derivations
    .map((derivation) => ({
      derivation,
      fingerprint: goalFingerprint({
        universeId: request.universeId,
        characterId: request.characterId,
        ...derivation,
      }),
    }))
    .filter((entry) => !existing.has(entry.fingerprint))
    .map((entry) => ({
      id: `derived:${entry.fingerprint.slice(0, 16)}`,
      kind: entry.derivation.kind,
      priority: entry.derivation.priority,
      status: "ACTIVE" as const,
      source: "DERIVED" as const,
      ruleCode: entry.derivation.ruleCode,
      fingerprint: entry.fingerprint,
      targetCharacterId: entry.derivation.targetCharacterId,
      targetRaceId: entry.derivation.targetRaceId,
      seasonId: entry.derivation.seasonId,
      validTo: entry.derivation.validTo,
    }));
  return [...persisted, ...synthetic].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.id.localeCompare(b.id);
  });
}

async function evaluateGoalOutcome(
  goal: CharacterGoal,
  context: BehaviorContextView,
  request: BehaviorDecisionRequest,
  currentRaceStatus: string | null,
): Promise<"COMPLETED" | "FAILED" | null> {
  if (goal.kind === "WIN_RACE" && goal.targetRaceId) {
    const race = await prisma.race.findUnique({
      where: { id: goal.targetRaceId },
      select: { status: true },
    });
    if (!race || race.status !== "FINISHED") return null;
    const profile = await prisma.driverProfile.findFirst({
      where: { characterId: goal.characterId },
      select: { id: true },
    });
    if (!profile) return "FAILED";
    const result = await prisma.raceResult.findUnique({
      where: { raceId_driverProfileId: { raceId: goal.targetRaceId, driverProfileId: profile.id } },
      select: { position: true },
    });
    return result?.position === 1 ? "COMPLETED" : "FAILED";
  }

  if (goal.kind === "WIN_CHAMPIONSHIP" && goal.seasonId) {
    const season = await prisma.season.findUnique({
      where: { id: goal.seasonId },
      select: { status: true },
    });
    if (!season || season.status !== "FINISHED") return null;
    const standing = await prisma.championshipStanding.findFirst({
      where: {
        seasonId: goal.seasonId,
        driverProfile: { characterId: goal.characterId },
      },
      select: { position: true },
    });
    return standing?.position === 1 ? "COMPLETED" : "FAILED";
  }

  if (goal.kind === "OUTPERFORM_TEAMMATE") {
    const teammate = context.motorsport.teammate;
    const ownPosition = context.motorsport.standing?.position ?? null;
    if (!teammate || teammate.position === null || ownPosition === null) return null;
    return ownPosition < teammate.position ? "COMPLETED" : null;
  }

  if (goal.kind === "RECOVER_AFTER_SETBACK") {
    return significantSetback(context) ? null : "COMPLETED";
  }

  void request;
  void currentRaceStatus;
  return null;
}

export async function reconcileCharacterGoals(
  context: BehaviorContextView,
  request: BehaviorDecisionRequest,
): Promise<GoalReconcileReport> {
  const existing = await prisma.characterGoal.findMany({
    where: { universeId: request.universeId, characterId: request.characterId },
    orderBy: [{ kind: "asc" }, { id: "asc" }],
  });
  const currentRaceStatus = context.world.currentRaceId
    ? (
        await prisma.race.findUnique({
          where: { id: context.world.currentRaceId },
          select: { status: true },
        })
      )?.status ?? null
    : null;

  let completed = 0;
  let failed = 0;
  let expired = 0;
  let created = 0;
  let reactivated = 0;
  let manualConflicts = 0;
  const terminalIds = new Set<string>();

  for (const goal of existing) {
    if (goal.status !== "ACTIVE" && goal.status !== "PAUSED") continue;
    if (goal.validTo && goal.validTo.getTime() < request.worldDate.getTime()) {
      await prisma.characterGoal.update({
        where: { id: goal.id },
        data: { status: "EXPIRED" },
      });
      terminalIds.add(goal.id);
      expired += 1;
      continue;
    }
    const outcome = await evaluateGoalOutcome(goal, context, request, currentRaceStatus);
    if (outcome === "COMPLETED") {
      await prisma.characterGoal.update({
        where: { id: goal.id },
        data: { status: "COMPLETED", completedAt: request.worldDate },
      });
      terminalIds.add(goal.id);
      completed += 1;
    } else if (outcome === "FAILED") {
      await prisma.characterGoal.update({
        where: { id: goal.id },
        data: { status: "FAILED" },
      });
      terminalIds.add(goal.id);
      failed += 1;
    }
  }

  const derivations = deriveGoalCandidates(context, request, { currentRaceStatus });
  const byFingerprint = new Map(
    existing.map((goal) => [goal.fingerprint, goal] as const).filter(([key]) => key !== null),
  );
  const currentFingerprints = new Set<string>();

  for (const derivation of derivations) {
    const fingerprint = goalFingerprint({
      universeId: request.universeId,
      characterId: request.characterId,
      ...derivation,
    });
    currentFingerprints.add(fingerprint);

    const manual = existing.find(
      (goal) =>
        goal.source === "MANUAL" &&
        goal.kind === derivation.kind &&
        (goal.targetCharacterId ?? null) === derivation.targetCharacterId &&
        (goal.status === "ACTIVE" || goal.status === "PAUSED"),
    );
    if (manual) {
      manualConflicts += 1;
      continue;
    }

    const found = byFingerprint.get(fingerprint);
    if (found) {
      if (found.status === "EXPIRED" || found.status === "FAILED") {
        await prisma.characterGoal.update({
          where: { id: found.id },
          data: { status: "ACTIVE", completedAt: null },
        });
        reactivated += 1;
      }
      continue;
    }

    await prisma.characterGoal.create({
      data: {
        universeId: request.universeId,
        characterId: request.characterId,
        kind: derivation.kind,
        priority: derivation.priority,
        status: "ACTIVE",
        source: "DERIVED",
        ruleCode: derivation.ruleCode,
        fingerprint,
        targetCharacterId: derivation.targetCharacterId,
        targetRaceId: derivation.targetRaceId,
        seasonId: derivation.seasonId,
        validFrom: request.worldDate,
        validTo: derivation.validTo,
        metadata: { engine: "deterministic", ruleCode: derivation.ruleCode },
      },
    });
    created += 1;
  }

  for (const goal of existing) {
    if (goal.source !== "DERIVED" || goal.status !== "ACTIVE") continue;
    if (terminalIds.has(goal.id)) continue;
    if (goal.fingerprint && currentFingerprints.has(goal.fingerprint)) continue;
    await prisma.characterGoal.update({
      where: { id: goal.id },
      data: { status: "EXPIRED" },
    });
    expired += 1;
  }

  const goals = await listActiveGoals(request.universeId, request.characterId);
  return { goals, created, reactivated, completed, failed, expired, manualConflicts };
}
