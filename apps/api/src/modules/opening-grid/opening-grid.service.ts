import { prisma } from "../../infrastructure/database/prisma.js";
import type { OpeningGridClient } from "./opening-grid.client.js";
import {
  persistOpeningGridClaims,
  type ClaimsPersistResult,
} from "./opening-grid.persist.js";
import {
  OPENING_GRID_SOURCE,
  normalizeOpeningGridClaims,
  validateOpeningGridPayload,
  type OpeningGridConflict,
} from "./opening-grid.source.js";

export interface OpeningGridIngestReport {
  source: string;
  year: number;
  fetchedUrl: string;
  ingested: boolean;
  claims: number;
  counts: ClaimsPersistResult;
  conflicts: OpeningGridConflict[];
  durationMs: number;
}

export class OpeningGridIngestService {
  private readonly client: OpeningGridClient;

  constructor(client: OpeningGridClient) {
    this.client = client;
  }

  async ingest(year: number): Promise<OpeningGridIngestReport> {
    const started = Date.now();
    const payload = await this.client.getSeason(year);
    const conflicts = validateOpeningGridPayload(payload);
    const claims = normalizeOpeningGridClaims(payload);

    const base = {
      source: OPENING_GRID_SOURCE,
      year,
      fetchedUrl: this.client.sourceUrlFor(year),
      claims: claims.length,
      durationMs: Date.now() - started,
    };

    if (conflicts.length > 0) {
      return {
        ...base,
        ingested: false,
        counts: { created: 0, updated: 0, unchanged: 0 },
        conflicts,
      };
    }

    const counts = await prisma.$transaction((tx) =>
      persistOpeningGridClaims(tx, claims),
    );
    return { ...base, ingested: true, counts, conflicts: [] };
  }
}