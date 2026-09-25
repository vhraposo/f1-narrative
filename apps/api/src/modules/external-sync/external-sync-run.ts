import { prisma } from "../../infrastructure/database/prisma.js";
import type { PersistResult } from "./jolpica.persist.js";

const activeSyncs = new Map<string, Promise<unknown>>();

export function syncLockKey(
  source: string,
  scope: string,
  year?: number | null,
): string {
  return `${source}:${scope}:${year ?? "-"}`;
}

export function isSyncActive(
  source: string,
  scope: string,
  year?: number | null,
): boolean {
  return activeSyncs.has(syncLockKey(source, scope, year));
}

export function runWithSyncLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = activeSyncs.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const run = (async () => {
    try {
      return await fn();
    } finally {
      activeSyncs.delete(key);
    }
  })();
  activeSyncs.set(key, run);
  return run;
}

export function sanitizeSyncError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 300);
}

export interface SyncRunInput {
  source: string;
  scope: string;
  seasonYear?: number | null;
  triggeredById?: string | null;
}

export async function runRecordedSync(
  input: SyncRunInput,
  fn: () => Promise<PersistResult>,
): Promise<PersistResult> {
  const lockKey = syncLockKey(input.source, input.scope, input.seasonYear ?? null);
  return runWithSyncLock(lockKey, async () => {
    const run = await prisma.externalSyncRun.create({
      data: {
        source: input.source,
        scope: input.scope,
        seasonYear: input.seasonYear ?? null,
        status: "RUNNING",
        triggeredById: input.triggeredById ?? null,
      },
      select: { id: true },
    });
    try {
      const counts = await fn();
      await prisma.externalSyncRun.update({
        where: { id: run.id },
        data: {
          status: "SUCCESS",
          finishedAt: new Date(),
          lastSyncedAt: new Date(),
          statistics: {
            created: counts.created,
            updated: counts.updated,
            unchanged: counts.unchanged,
            skipped: counts.skipped,
          },
        },
      });
      return counts;
    } catch (error) {
      await prisma.externalSyncRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          error: sanitizeSyncError(error),
        },
      });
      throw error;
    }
  });
}
