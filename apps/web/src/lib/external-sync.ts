import { get, post } from "./api";

export type ExternalSyncCounts = {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
};

export type ExternalSyncScopeView = {
  scope: string;
  status: "SUCCESS" | "FAILED";
  counts: ExternalSyncCounts | null;
  durationMs: number;
  error: { statusCode: number; code: string; error: string } | null;
};

export type ExternalRefreshResult = {
  ok: boolean;
  source: string;
  year: number;
  failedScope: string | null;
  code: string | null;
  error: string | null;
  scopes: ExternalSyncScopeView[];
  durationMs: number;
};

export type ExternalSyncRunView = {
  id: string;
  scope: string;
  seasonYear: number | null;
  status: "RUNNING" | "SUCCESS" | "FAILED";
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  lastSyncedAt: string | null;
  statistics: ExternalSyncCounts | null;
  error: string | null;
};

export type ExternalSyncStatus = {
  source: string;
  active: string[];
  lastRun: ExternalSyncRunView | null;
  lastSuccess: ExternalSyncRunView | null;
  recent: ExternalSyncRunView[];
};

export function refreshExternalSeason(
  seasonYear: number,
): Promise<ExternalRefreshResult> {
  return post<ExternalRefreshResult>("/api/external-sync/refresh", {
    seasonYear,
  });
}

export function getExternalSyncStatus(limit = 10): Promise<ExternalSyncStatus> {
  return get<ExternalSyncStatus>(
    `/api/external-sync/status?source=jolpica&limit=${limit}`,
  );
}
