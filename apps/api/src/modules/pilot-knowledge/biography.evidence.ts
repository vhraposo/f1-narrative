import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { env } from "../../config/env.js";
import { getF1dbDataset } from "../f1db/f1db.dataset.js";

export const CURATED_EVIDENCE_SCHEMA_VERSION = "biography-evidence.v1";

export type CuratedSourceRef = {
  readonly id: string;
  readonly provider: string;
  readonly sourceType: string;
  readonly title: string;
  readonly url: string;
};

export type CuratedEvidenceClaim = {
  readonly category: string;
  readonly key: string;
  readonly value: string;
  readonly display: string;
  readonly year: number | null;
  readonly endYear: number | null;
  readonly authority: string;
  readonly status: "APPROVED";
  readonly sourceRef: string;
  readonly attribution: string | null;
  readonly context: "ON_TRACK" | "OFF_TRACK" | null;
};

export type CuratedEvidenceBundle = {
  readonly driverKey: string;
  readonly claims: readonly CuratedEvidenceClaim[];
  readonly sources: ReadonlyMap<string, CuratedSourceRef>;
};

export type CuratedEvidenceDataset = {
  readonly version: string;
  readonly generatedAt: string | null;
  readonly drivers: ReadonlyMap<string, CuratedEvidenceBundle>;
  readonly aliases: ReadonlyMap<string, string>;
};

function resolveEvidenceDir(): string | null {
  const candidates = [
    ...(env.BIOGRAPHY_EVIDENCE_DIR ? [path.resolve(env.BIOGRAPHY_EVIDENCE_DIR)] : []),
    path.resolve(process.cwd(), "..", "..", "data", "external", "biography"),
    path.resolve(process.cwd(), "data", "external", "biography"),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "curated-evidence.json"))) return candidate;
  }
  return null;
}

type RawClaim = {
  category?: unknown;
  key?: unknown;
  value?: unknown;
  display?: unknown;
  year?: unknown;
  endYear?: unknown;
  authority?: unknown;
  sourceRef?: unknown;
  attribution?: unknown;
  context?: unknown;
};

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toYearOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

let cached: CuratedEvidenceDataset | null | undefined;

export function getCuratedEvidenceDataset(): CuratedEvidenceDataset | null {
  if (cached !== undefined) return cached;
  const dataDir = resolveEvidenceDir();
  if (!dataDir) {
    cached = null;
    return cached;
  }
  try {
    const raw = readFileSync(path.join(dataDir, "curated-evidence.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      schemaVersion?: string;
      generatedAt?: string;
      generatorVersion?: string;
      sources?: Record<string, Record<string, unknown>>;
      drivers?: Record<string, { claims?: unknown }>;
      aliases?: Record<string, unknown>;
    };
    if (parsed.schemaVersion !== CURATED_EVIDENCE_SCHEMA_VERSION) {
      cached = null;
      return cached;
    }
    const sources = new Map<string, CuratedSourceRef>();
    for (const [id, source] of Object.entries(parsed.sources ?? {})) {
      const url = toStringOrNull(source.url);
      const title = toStringOrNull(source.title);
      const provider = toStringOrNull(source.provider);
      const sourceType = toStringOrNull(source.sourceType);
      if (!url || !title || !provider || !sourceType) continue;
      sources.set(id, { id, provider, sourceType, title, url });
    }
    const version = createHash("sha256")
      .update(`${parsed.generatorVersion ?? "curated"}:${raw}`)
      .digest("hex")
      .slice(0, 16);
    const drivers = new Map<string, CuratedEvidenceBundle>();
    for (const [driverKey, entry] of Object.entries(parsed.drivers ?? {})) {
      const claims: CuratedEvidenceClaim[] = [];
      for (const item of Array.isArray(entry.claims) ? (entry.claims as RawClaim[]) : []) {
        const category = toStringOrNull(item.category);
        const key = toStringOrNull(item.key);
        const value = toStringOrNull(item.value);
        const display = toStringOrNull(item.display);
        const sourceRef = toStringOrNull(item.sourceRef);
        if (!category || !key || !value || !display || !sourceRef) continue;
        if (!sources.has(sourceRef)) continue;
        claims.push({
          category,
          key,
          value,
          display,
          year: toYearOrNull(item.year),
          endYear: toYearOrNull(item.endYear),
          authority: toStringOrNull(item.authority) ?? "SECONDARY",
          status: "APPROVED",
          sourceRef,
          attribution: toStringOrNull(item.attribution),
          context:
            item.context === "ON_TRACK" || item.context === "OFF_TRACK"
              ? item.context
              : null,
        });
      }
      drivers.set(driverKey, { driverKey, claims, sources });
    }
    const aliases = new Map<string, string>();
    for (const [alias, target] of Object.entries(parsed.aliases ?? {})) {
      const resolved = toStringOrNull(target);
      if (resolved && drivers.has(resolved)) aliases.set(alias, resolved);
    }
    cached = {
      version,
      generatedAt: toStringOrNull(parsed.generatedAt),
      drivers,
      aliases,
    };
    return cached;
  } catch {
    cached = null;
    return cached;
  }
}

export function resetCuratedEvidenceCache(): void {
  cached = undefined;
}

export function getCuratedEvidenceForDriver(
  f1dbDriverId: string | null,
): CuratedEvidenceBundle | null {
  if (!f1dbDriverId) return null;
  const dataset = getCuratedEvidenceDataset();
  if (!dataset) return null;
  const key = dataset.aliases.get(f1dbDriverId) ?? f1dbDriverId;
  return dataset.drivers.get(key) ?? null;
}

export function curatedEvidenceVersion(): string | null {
  const dataset = getCuratedEvidenceDataset();
  if (!dataset) return null;
  return `${dataset.version}:${getF1dbDataset()?.sourceVersion ?? "no-f1db"}`;
}
