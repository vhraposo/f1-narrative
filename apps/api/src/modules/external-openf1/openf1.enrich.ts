import { prisma } from "../../infrastructure/database/prisma.js";
import type { OpenF1Client } from "./openf1.client.js";
import { normalizeOpenF1Drivers } from "./openf1.normalizer.js";

export const OPENF1_SOURCE = "openf1";

export interface OpenF1EnrichReport {
  source: string;
  counts: {
    rowsConsidered: number;
    matchedDrivers: number;
    rowsUpdated: number;
    rowsUnchanged: number;
    rowsWithoutHeadshot: number;
  };
  durationMs: number;
}

export class OpenF1EnrichmentService {
  private readonly client: OpenF1Client;

  constructor(client: OpenF1Client) {
    this.client = client;
  }

  async enrich(): Promise<OpenF1EnrichReport> {
    const startedAt = Date.now();

    const candidates = await prisma.externalDriver.findMany({
      where: { number: { not: null } },
      select: { id: true, number: true, headshotUrl: true },
    });

    const raw = await this.client.getLatestDrivers();
    const normalized = normalizeOpenF1Drivers(raw);
    const headshotByNumber = new Map<number, string>();
    for (const driver of normalized) {
      if (driver.headshotUrl == null) continue;
      if (!headshotByNumber.has(driver.driverNumber)) {
        headshotByNumber.set(driver.driverNumber, driver.headshotUrl);
      }
    }

    let matchedDrivers = 0;
    let rowsUpdated = 0;
    let rowsUnchanged = 0;
    let rowsWithoutHeadshot = 0;
    const matchedNumbers = new Set<number>();

    for (const row of candidates) {
      if (row.number == null) continue;
      const headshotUrl = headshotByNumber.get(row.number);
      if (headshotUrl == null) {
        rowsWithoutHeadshot += 1;
        continue;
      }
      if (!matchedNumbers.has(row.number)) {
        matchedNumbers.add(row.number);
        matchedDrivers += 1;
      }
      if (row.headshotUrl === headshotUrl) {
        rowsUnchanged += 1;
        continue;
      }
      await prisma.externalDriver.update({
        where: { id: row.id },
        data: { headshotUrl },
      });
      rowsUpdated += 1;
    }

    return {
      source: OPENF1_SOURCE,
      counts: {
        rowsConsidered: candidates.length,
        matchedDrivers,
        rowsUpdated,
        rowsUnchanged,
        rowsWithoutHeadshot,
      },
      durationMs: Date.now() - startedAt,
    };
  }
}