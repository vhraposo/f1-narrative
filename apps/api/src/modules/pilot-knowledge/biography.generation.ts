import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import type { GenerationProvider } from "../generation/generation.assembly.js";
import {
  BIOGRAPHY_COMPOSER_VERSION,
  createLlmBiographyComposer,
  type BiographyPromptAudit,
} from "./biography.composer.js";
import { curatedEvidenceVersion } from "./biography.evidence.js";
import { createLlmBiographyVerifier } from "./biography.verifier.js";
import { ensurePilotKnowledgeProvisioned } from "./pilot-knowledge.provision.js";

export type BiographyLifecycleStatus =
  | "MISSING"
  | "READY"
  | "READY_FALLBACK"
  | "STALE"
  | "GENERATING"
  | "FAILED";

export type BiographyStateView = {
  readonly status: BiographyLifecycleStatus;
  readonly display: string | null;
  readonly context: string | null;
  readonly origin: "UNIVERSE" | "EXTERNAL" | "NONE";
  readonly runId: string | null;
  readonly evidenceVersion: string | null;
  readonly generatorVersion: string | null;
  readonly fallbackReason: string | null;
  readonly lastVerifiedAt: Date | null;
};

export async function readBiographyState(characterId: string): Promise<BiographyStateView> {
  const [profile, run] = await Promise.all([
    prisma.externalDriverProfile.findFirst({
      where: { externalDriver: { bindings: { some: { characterId } } } },
      select: {
        biographyDisplay: true,
        biographyContext: true,
        biographySourceId: true,
        lastVerifiedAt: true,
        biographySource: { select: { sourceKind: true, metadata: true } },
      },
    }),
    prisma.biographyGenerationRun.findFirst({
      where: { characterId, status: { in: ["PENDING", "RUNNING"] } },
      orderBy: { startedAt: "desc" },
      select: { id: true },
    }),
  ]);

  if (!profile) {
    const character = await prisma.character.findUnique({
      where: { id: characterId },
      select: { biography: true },
    });
    const universeBiography = character?.biography?.trim() ?? null;
    if (universeBiography) {
      return {
        status: "READY",
        display: universeBiography,
        context: universeBiography,
        origin: "UNIVERSE",
        runId: null,
        evidenceVersion: null,
        generatorVersion: null,
        fallbackReason: null,
        lastVerifiedAt: null,
      };
    }
    return {
      status: "MISSING",
      display: null,
      context: null,
      origin: "NONE",
      runId: run?.id ?? null,
      evidenceVersion: null,
      generatorVersion: null,
      fallbackReason: null,
      lastVerifiedAt: null,
    };
  }

  const metadata = (profile.biographySource?.metadata ?? {}) as Record<string, unknown>;
  const generatorVersion =
    typeof metadata.generatorVersion === "string" ? metadata.generatorVersion : null;
  const evidenceVersion =
    typeof metadata.evidenceVersion === "string" ? metadata.evidenceVersion : null;
  const fallbackReason =
    typeof metadata.fallbackReason === "string" ? metadata.fallbackReason : null;
  const display = profile.biographyDisplay?.trim() ?? null;

  if (run) {
    return {
      status: "GENERATING",
      display,
      context: profile.biographyContext,
      origin: display ? "EXTERNAL" : "NONE",
      runId: run.id,
      evidenceVersion,
      generatorVersion,
      fallbackReason,
      lastVerifiedAt: profile.lastVerifiedAt,
    };
  }

  if (!display) {
    return {
      status: "MISSING",
      display: null,
      context: null,
      origin: "NONE",
      runId: null,
      evidenceVersion,
      generatorVersion,
      fallbackReason,
      lastVerifiedAt: profile.lastVerifiedAt,
    };
  }

  const generated = profile.biographySource?.sourceKind === "BIOGRAPHY_PAGE";
  const expectedEvidenceVersion = curatedEvidenceVersion();
  const staleByVersion =
    generated && generatorVersion !== null && generatorVersion !== BIOGRAPHY_COMPOSER_VERSION;
  const staleByEvidence =
    generated &&
    expectedEvidenceVersion !== null &&
    evidenceVersion !== expectedEvidenceVersion;

  return {
    status: staleByVersion || staleByEvidence ? "STALE" : fallbackReason ? "READY_FALLBACK" : "READY",
    display,
    context: profile.biographyContext,
    origin: "EXTERNAL",
    runId: null,
    evidenceVersion,
    generatorVersion,
    fallbackReason,
    lastVerifiedAt: profile.lastVerifiedAt,
  };
}

export function sanitizePromptPayload(value: unknown): Prisma.InputJsonValue {
  const json = JSON.stringify(value);
  const sanitized = json.replace(
    /(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]+|api[_-]?key["']?\s*[:=]\s*["'][^"']+["']|authorization["']?\s*[:=]\s*["'][^"']+["'])/gi,
    "[REDACTED]",
  );
  return JSON.parse(sanitized) as Prisma.InputJsonValue;
}

export function promptFingerprint(audit: BiographyPromptAudit | null): string {
  const payload = audit ?? { systemPrompt: "", userPrompt: "" };
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

export type GenerationRequestResult = {
  readonly runId: string;
  readonly status: "PENDING" | "RUNNING" | "SUCCEEDED" | "SUCCEEDED_FALLBACK" | "FAILED";
  readonly reused: boolean;
  readonly skipped?: boolean;
};

export type GenerationOptions = {
  readonly provider?: GenerationProvider;
  readonly model?: string;
  readonly now?: Date;
};

function modeFromProvision(
  mode: "LLM_APPROVED" | "RICH_DETERMINISTIC" | "FALLBACK" | "NOT_REQUESTED" | undefined,
): "LLM" | "RICH_DETERMINISTIC" | "COMPACT_FALLBACK" {
  if (mode === "LLM_APPROVED") return "LLM";
  if (mode === "RICH_DETERMINISTIC") return "RICH_DETERMINISTIC";
  return "COMPACT_FALLBACK";
}

async function executeGenerationRun(runId: string, options: GenerationOptions): Promise<void> {
  const run = await prisma.biographyGenerationRun.findUnique({
    where: { id: runId },
    select: { characterId: true },
  });
  if (!run) return;

  let promptAudit: BiographyPromptAudit | null = null;
  const startedAt = Date.now();
  await prisma.biographyGenerationRun.update({
    where: { id: runId },
    data: { status: "RUNNING" },
  });

  try {
    const result = await ensurePilotKnowledgeProvisioned(run.characterId, options.now ?? new Date(), {
      ...(options.provider
        ? {
            biographyComposer: createLlmBiographyComposer(options.provider, (audit) => {
              promptAudit = audit;
            }),
            biographyVerifier: createLlmBiographyVerifier(options.provider),
            biographyModel: options.model ?? options.provider.name,
          }
        : {}),
    });

    const profile = await prisma.externalDriverProfile.findFirst({
      where: { externalDriver: { bindings: { some: { characterId: run.characterId } } } },
      select: { biographySourceId: true, biographySource: { select: { metadata: true } } },
    });
    const metadata = (profile?.biographySource?.metadata ?? {}) as Record<string, unknown>;
    const mode = modeFromProvision(result.biography?.mode);
    const success = mode === "LLM" ? "SUCCEEDED" : "SUCCEEDED_FALLBACK";

    await prisma.biographyGenerationRun.update({
      where: { id: runId },
      data: {
        status: success,
        mode,
        provider: options.provider?.name ?? null,
        model: options.model ?? null,
        prompt: promptAudit ? sanitizePromptPayload(promptAudit) : undefined,
        promptHash: promptFingerprint(promptAudit),
        evidenceVersion:
          typeof metadata.evidenceVersion === "string" ? metadata.evidenceVersion : null,
        fingerprint:
          typeof metadata.fingerprint === "string" ? metadata.fingerprint : null,
        fallbackReason: result.biography?.fallbackReason ?? null,
        outputSourceId: profile?.biographySourceId ?? null,
        timings: { totalMs: Date.now() - startedAt },
        completedAt: new Date(),
      },
    });
  } catch (error) {
    await prisma.biographyGenerationRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        failureReason: error instanceof Error ? error.message.slice(0, 300) : "unknown error",
        timings: { totalMs: Date.now() - startedAt },
        completedAt: new Date(),
      },
    });
  }
}

const characterLocks = new Map<string, Promise<unknown>>();

export async function requestBiographyGeneration(
  characterId: string,
  options: GenerationOptions = {},
): Promise<GenerationRequestResult> {
  const previous = characterLocks.get(characterId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  characterLocks.set(characterId, tail);
  await previous.catch(() => undefined);
  try {
    return await requestBiographyGenerationInternal(characterId, options);
  } finally {
    release();
    if (characterLocks.get(characterId) === tail) characterLocks.delete(characterId);
  }
}

async function requestBiographyGenerationInternal(
  characterId: string,
  options: GenerationOptions = {},
): Promise<GenerationRequestResult> {
  const state = await readBiographyState(characterId);
  if (state.status === "READY" || state.status === "READY_FALLBACK") {
    const lastRun = await prisma.biographyGenerationRun.findFirst({
      where: {
        characterId,
        status: { in: ["SUCCEEDED", "SUCCEEDED_FALLBACK"] },
      },
      orderBy: { startedAt: "desc" },
      select: { id: true, status: true, evidenceVersion: true },
    });
    if (lastRun && lastRun.evidenceVersion === state.evidenceVersion) {
      return {
        runId: lastRun.id,
        status: lastRun.status === "SUCCEEDED" ? "SUCCEEDED" : "SUCCEEDED_FALLBACK",
        reused: true,
        skipped: true,
      };
    }
  }
  if (state.status === "GENERATING" && state.runId) {
    return { runId: state.runId, status: "RUNNING", reused: true };
  }

  const externalDriverId = await prisma.externalBindingDriver
    .findFirst({
      where: { characterId },
      orderBy: { createdAt: "asc" },
      select: { externalDriverId: true },
    })
    .then((binding) => binding?.externalDriverId ?? null);

  const active = await prisma.biographyGenerationRun.findFirst({
    where: { characterId, status: { in: ["PENDING", "RUNNING"] } },
    orderBy: { startedAt: "desc" },
    select: { id: true, status: true },
  });
  if (active) {
    return {
      runId: active.id,
      status: active.status === "RUNNING" ? "RUNNING" : "PENDING",
      reused: true,
    };
  }

  const run = await prisma.biographyGenerationRun.create({
    data: {
      characterId,
      externalDriverId,
      status: "PENDING",
      promptVersion: BIOGRAPHY_COMPOSER_VERSION,
      promptHash: promptFingerprint(null),
      generatorVersion: BIOGRAPHY_COMPOSER_VERSION,
    },
    select: { id: true },
  });

  void executeGenerationRun(run.id, options).catch(() => undefined);

  return { runId: run.id, status: "PENDING", reused: false };
}

export async function getLatestGenerationRun(characterId: string) {
  return prisma.biographyGenerationRun.findFirst({
    where: { characterId },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      status: true,
      mode: true,
      provider: true,
      model: true,
      fallbackReason: true,
      evidenceVersion: true,
      generatorVersion: true,
      promptHash: true,
      startedAt: true,
      completedAt: true,
    },
  });
}

export type BackfillSummary = {
  readonly targets: number;
  readonly succeeded: number;
  readonly fallback: number;
  readonly failed: number;
  readonly skipped: number;
  readonly rich: number;
  readonly results: Array<{
    readonly characterId: string;
    readonly status: string;
    readonly mode: string | null;
    readonly skipped: boolean;
  }>;
};

function uniqueCharacterIds(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string"))];
}

export async function listCurrentGridCharacterIds(universeIds?: readonly string[]): Promise<string[]> {
  const universes = await prisma.universe.findMany({
    where:
      universeIds && universeIds.length > 0
        ? { id: { in: [...universeIds] } }
        : { status: "READY" },
    select: { id: true, worldStates: { select: { currentSeasonId: true, key: true } } },
  });

  const currentSeasonByUniverse = new Map<string, string | null>();
  for (const universe of universes) {
    const current = universe.worldStates.find((world) => world.key === "default");
    currentSeasonByUniverse.set(universe.id, current?.currentSeasonId ?? null);
  }

  const seasonIds = uniqueCharacterIds([...currentSeasonByUniverse.values()]);
  const entries = seasonIds.length
    ? await prisma.seasonDriverEntry.findMany({
        where: { seasonId: { in: seasonIds } },
        select: { driverProfile: { select: { characterId: true } } },
      })
    : [];
  const rosterCharacterIds = entries.map((entry) => entry.driverProfile.characterId);
  if (rosterCharacterIds.length > 0) return uniqueCharacterIds(rosterCharacterIds);

  const boundCharacters = await prisma.externalBindingDriver.findMany({
    where: { universeId: { in: universes.map((universe) => universe.id) } },
    select: { characterId: true },
  });
  return uniqueCharacterIds(boundCharacters.map((binding) => binding.characterId));
}

export async function backfillCurrentGridBiographies(options: {
  readonly provider?: GenerationProvider;
  readonly model?: string;
  readonly universeIds?: readonly string[];
} = {}): Promise<BackfillSummary> {
  const characterIds = await listCurrentGridCharacterIds(options.universeIds);
  const results: BackfillSummary["results"] = [];
  let succeeded = 0;
  let fallback = 0;
  let failed = 0;
  let skipped = 0;
  let rich = 0;

  for (const characterId of characterIds) {
    try {
      const request = await requestBiographyGeneration(characterId, options);
      if (request.skipped) {
        skipped += 1;
        const run = await prisma.biographyGenerationRun.findUnique({
          where: { id: request.runId },
          select: { mode: true },
        });
        if (run?.mode === "LLM" || run?.mode === "RICH_DETERMINISTIC") rich += 1;
        results.push({ characterId, status: request.status, mode: run?.mode ?? null, skipped: true });
        continue;
      }
      let attempts = 0;
      while (attempts < 120) {
        const run = await prisma.biographyGenerationRun.findUnique({
          where: { id: request.runId },
          select: { status: true, mode: true },
        });
        if (!run) break;
        if (run.status === "SUCCEEDED" || run.status === "SUCCEEDED_FALLBACK" || run.status === "FAILED") {
          if (run.status === "SUCCEEDED") succeeded += 1;
          else if (run.status === "SUCCEEDED_FALLBACK") fallback += 1;
          else failed += 1;
          if (run.mode === "LLM" || run.mode === "RICH_DETERMINISTIC") rich += 1;
          results.push({ characterId, status: run.status, mode: run.mode, skipped: false });
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
        attempts += 1;
      }
    } catch {
      failed += 1;
      results.push({ characterId, status: "FAILED", mode: null, skipped: false });
    }
  }

  return { targets: characterIds.length, succeeded, fallback, failed, skipped, rich, results };
}
