import type { Role } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  JOLPICA_SOURCE,
  type JolpicaSyncScope,
} from "./jolpica.service.js";
import {
  UniverseInitError,
  universeInitService,
  type Actor,
  type InitReport,
} from "../universe-init/universe-init.service.js";
import { ensureUniverse } from "../universe/universe.service.js";

const WORLD_KEY = "default";

export interface AutoMaterializeResult {
  attempted: boolean;
  status: "OK" | "SKIPPED" | "CONFLICT";
  reason: string | null;
  report?: InitReport;
}

export const MATERIALIZABLE_SCOPES: readonly JolpicaSyncScope[] = [
  "DRIVER_SEASONS",
  "RACES",
  "RESULTS",
  "STANDINGS",
] as const;

export async function tryAutoMaterialize(
  actor: Actor,
  year: number,
  universeId?: string,
): Promise<AutoMaterializeResult> {
  const externalSeason = await prisma.externalSeason.findUnique({
    where: { source_year: { source: JOLPICA_SOURCE, year } },
    select: { id: true },
  });
  if (!externalSeason) {
    return {
      attempted: false,
      status: "SKIPPED",
      reason: "external_season_missing",
    };
  }

  const scopeUniverseId = universeId ?? (await ensureUniverse(actor.id)).id;
  const seasonId = await resolveUniverseSeasonId(
    scopeUniverseId,
    year,
    externalSeason.id,
  );
  if (!seasonId) {
    return {
      attempted: false,
      status: "SKIPPED",
      reason: "universe_season_missing",
    };
  }

  try {
    const report = await universeInitService.execute(
      actor,
      {
        seasonId,
        externalSeasonId: externalSeason.id,
      },
      scopeUniverseId,
    );
    return { attempted: true, status: "OK", reason: null, report };
  } catch (error) {
    if (error instanceof UniverseInitError) {
      return {
        attempted: true,
        status: "CONFLICT",
        reason: error.code,
      };
    }
    throw error;
  }
}

async function resolveUniverseSeasonId(
  universeId: string,
  year: number,
  externalSeasonId: string,
): Promise<string | null> {
  const binding = await prisma.externalBindingSeason.findUnique({
    where: {
      universeId_externalSeasonId: { universeId, externalSeasonId },
    },
    select: { seasonId: true, confidence: true },
  });
  if (binding && binding.confidence === "CONFIRMED") {
    return binding.seasonId;
  }

  const world = await prisma.worldState.findUnique({
    where: { universeId_key: { universeId, key: WORLD_KEY } },
    select: { currentSeasonId: true },
  });
  if (world?.currentSeasonId) {
    const season = await prisma.season.findUnique({
      where: { id: world.currentSeasonId },
      select: { year: true },
    });
    if (season && season.year === year) return world.currentSeasonId;
  }

  const seasons = await prisma.season.findMany({
    where: { universeId, year },
    select: { id: true },
  });
  if (seasons.length === 1) return seasons[0].id;
  return null;
}