import type { Universe } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { JolpicaClient } from "../external-sync/jolpica.client.js";
import { JolpicaTransport } from "../external-sync/jolpica.transport.js";
import {
  JOLPICA_SOURCE,
  JolpicaSyncService,
  type JolpicaSyncScope,
} from "../external-sync/jolpica.service.js";
import { universeInitService } from "../universe-init/universe-init.service.js";

const PROVISION_SCOPES: readonly JolpicaSyncScope[] = [
  "SEASON",
  "DRIVER_SEASONS",
  "RACES",
  "RESULTS",
  "STANDINGS",
];

const WORLD_DEFAULT_KEY = "default";
const LAST_ERROR_MAX_LENGTH = 2000;

export interface ExternalSeasonRef {
  id: string;
  year: number;
}

export interface ProvisionResult {
  universe: Universe;
  report: {
    status: Universe["status"];
    seasonId: string | null;
    externalSeasonId: string | null;
    reason: string | null;
  };
}

export async function getUniverseForUser(userId: string): Promise<Universe | null> {
  return prisma.universe.findUnique({ where: { userId } });
}

export async function ensureUniverse(userId: string): Promise<Universe> {
  try {
    return await prisma.universe.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "P2002") {
      return prisma.universe.findUniqueOrThrow({ where: { userId } });
    }
    throw error;
  }
}

export async function resolveCurrentExternalSeason(): Promise<ExternalSeasonRef | null> {
  const seasons = await prisma.externalSeason.findMany({
    where: { source: JOLPICA_SOURCE },
    orderBy: { year: "desc" },
    select: { id: true, year: true },
  });
  for (const season of seasons) {
    const driverSeason = await prisma.externalDriverSeason.findFirst({
      where: { source: JOLPICA_SOURCE, seasonYear: season.year },
      select: { id: true },
    });
    if (driverSeason) return { id: season.id, year: season.year };
  }
  return null;
}

async function syncCurrentExternalSeason(): Promise<ExternalSeasonRef | null> {
  const year = new Date().getFullYear();
  const client = new JolpicaClient({
    transport: new JolpicaTransport({
      baseUrl: env.JOLPICA_BASE_URL,
      timeoutMs: env.JOLPICA_TIMEOUT_MS,
      maxRetries: env.JOLPICA_MAX_RETRIES,
    }),
  });
  const service = new JolpicaSyncService(client, {
    requestDelayMs: env.JOLPICA_REQUEST_DELAY_MS,
  });
  for (const scope of PROVISION_SCOPES) {
    await service.sync(year, scope);
  }
  return resolveCurrentExternalSeason();
}

async function ensureUniverseSeason(
  universeId: string,
  externalSeason: ExternalSeasonRef,
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    let season = await tx.season.findUnique({
      where: { universeId_year: { universeId, year: externalSeason.year } },
      select: { id: true },
    });
    if (!season) {
      season = await tx.season.create({
        data: {
          universeId,
          year: externalSeason.year,
          name: String(externalSeason.year),
          status: "PRE_SEASON",
        },
        select: { id: true },
      });
    }

    const binding = await tx.externalBindingSeason.findUnique({
      where: {
        universeId_externalSeasonId: {
          universeId,
          externalSeasonId: externalSeason.id,
        },
      },
      select: { id: true },
    });
    if (!binding) {
      await tx.externalBindingSeason.create({
        data: {
          universeId,
          externalSeasonId: externalSeason.id,
          seasonId: season.id,
          confidence: "CONFIRMED",
        },
      });
    }

    await tx.worldState.upsert({
      where: { universeId_key: { universeId, key: WORLD_DEFAULT_KEY } },
      update: {},
      create: {
        universeId,
        key: WORLD_DEFAULT_KEY,
        currentSeasonId: season.id,
      },
    });

    return season.id;
  });
}

async function markFailed(universeId: string, reason: string): Promise<void> {
  await prisma.universe
    .update({
      where: { id: universeId },
      data: { status: "FAILED", lastError: reason.slice(0, LAST_ERROR_MAX_LENGTH) },
    })
    .catch(() => undefined);
}

export async function provisionUniverse(userId: string): Promise<ProvisionResult> {
  const universe = await ensureUniverse(userId);
  if (universe.status === "READY") {
    return {
      universe,
      report: {
        status: "READY",
        seasonId: null,
        externalSeasonId: null,
        reason: null,
      },
    };
  }

  try {
    let externalSeason = await resolveCurrentExternalSeason();
    if (!externalSeason && env.NODE_ENV !== "test") {
      externalSeason = await syncCurrentExternalSeason();
    }
    if (!externalSeason) {
      const reason = "external_sync_unavailable";
      await markFailed(universe.id, reason);
      return {
        universe: { ...universe, status: "FAILED", lastError: reason },
        report: {
          status: "FAILED",
          seasonId: null,
          externalSeasonId: null,
          reason,
        },
      };
    }

    const seasonId = await ensureUniverseSeason(universe.id, externalSeason);
    await universeInitService.execute(
      { id: userId },
      { seasonId, externalSeasonId: externalSeason.id },
      universe.id,
    );

    const ready = await prisma.universe.update({
      where: { id: universe.id },
      data: { status: "READY", lastError: null },
    });
    return {
      universe: ready,
      report: {
        status: "READY",
        seasonId,
        externalSeasonId: externalSeason.id,
        reason: null,
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await markFailed(universe.id, reason);
    return {
      universe: { ...universe, status: "FAILED", lastError: reason },
      report: {
        status: "FAILED",
        seasonId: null,
        externalSeasonId: null,
        reason,
      },
    };
  }
}
