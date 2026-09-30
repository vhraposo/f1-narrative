import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  DriverIdentityQuery,
  ExternalDriverKnowledgeProvider,
  ProviderCareerData,
  ProviderIdentityCandidate,
  ProviderProfileResult,
  ProviderRelationship,
  ProviderSourceReference,
} from "./provider.types.js";

export type F1dbDriverRecord = {
  readonly driverId: string;
  readonly name?: string;
  readonly fullName?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly nationality?: string;
  readonly placeOfBirth?: string;
  readonly dateOfBirth?: string;
  readonly number?: number;
  readonly code?: string;
};

export type F1dbSeasonEntryRecord = {
  readonly driverId: string;
  readonly year: number;
  readonly constructorName?: string;
  readonly number?: number;
};

export type F1dbStandingRecord = {
  readonly driverId: string;
  readonly year: number;
  readonly position: number;
};

export type F1dbDataset = {
  readonly version: string;
  readonly drivers: readonly F1dbDriverRecord[];
  readonly seasonEntries: readonly F1dbSeasonEntryRecord[];
  readonly standings: readonly F1dbStandingRecord[];
};

export type F1dbDatasetFiles = {
  readonly drivers?: string;
  readonly seasonEntries?: string;
  readonly standings?: string;
};

export async function loadF1dbDataset(
  dataDir: string,
  files: F1dbDatasetFiles = {},
): Promise<F1dbDataset> {
  const read = async <T>(name: string, fallback: readonly T[]): Promise<readonly T[]> => {
    try {
      const raw = await readFile(join(dataDir, name), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) throw new Error(`${name} deve ser um array JSON`);
      return parsed as readonly T[];
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return fallback;
      throw error;
    }
  };
  const versionFile = await readFile(join(dataDir, "release.json"), "utf8").catch(() => null);
  let version = "unknown";
  if (versionFile !== null) {
    try {
      const parsed = JSON.parse(versionFile) as { version?: string; tag?: string };
      version = parsed.version ?? parsed.tag ?? "unknown";
    } catch {
      version = "unknown";
    }
  }
  return {
    version,
    drivers: await read(files.drivers ?? "drivers.json", []),
    seasonEntries: await read(files.seasonEntries ?? "season-entries.json", []),
    standings: await read(files.standings ?? "standings.json", []),
  };
}

function driverDisplayName(driver: F1dbDriverRecord): string {
  if (driver.name) return driver.name;
  if (driver.fullName) return driver.fullName;
  const parts = [driver.firstName, driver.lastName].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return parts.join(" ") || driver.driverId;
}

function driverFullName(driver: F1dbDriverRecord): string | null {
  if (driver.fullName) return driver.fullName;
  const parts = [driver.firstName, driver.lastName].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return parts.length > 0 ? parts.join(" ") : null;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export class F1dbProvider implements ExternalDriverKnowledgeProvider {
  readonly source = "F1DB" as const;

  constructor(private readonly dataset: F1dbDataset) {}

  private byExternalId(externalId: string): F1dbDriverRecord | null {
    return this.dataset.drivers.find((driver) => driver.driverId === externalId) ?? null;
  }

  private toCandidate(driver: F1dbDriverRecord): ProviderIdentityCandidate {
    return {
      externalId: driver.driverId,
      name: driverDisplayName(driver),
      fullName: driverFullName(driver),
      nationality: driver.nationality ?? null,
      number: driver.number ?? null,
      dateOfBirth: parseDate(driver.dateOfBirth),
      f1dbDriverId: driver.driverId,
    };
  }

  async resolveDriverIdentity(query: DriverIdentityQuery): Promise<ProviderIdentityCandidate[]> {
    if (query.f1dbDriverId) {
      const exact = this.byExternalId(query.f1dbDriverId);
      if (exact) return [this.toCandidate(exact)];
    }
    const normalized = query.name.trim().toLowerCase();
    if (normalized.length === 0) return [];
    return this.dataset.drivers
      .filter((driver) => {
        const name = driverDisplayName(driver).toLowerCase();
        const full = driverFullName(driver)?.toLowerCase() ?? "";
        return name.includes(normalized) || full.includes(normalized) || normalized.includes(name);
      })
      .map((driver) => this.toCandidate(driver))
      .sort((a, b) => a.externalId.localeCompare(b.externalId));
  }

  async fetchStructuredProfile(candidate: ProviderIdentityCandidate): Promise<ProviderProfileResult> {
    const driver = this.byExternalId(candidate.externalId);
    if (!driver) {
      throw new Error(`f1db driver not found: ${candidate.externalId}`);
    }
    const seasons = this.dataset.seasonEntries
      .filter((entry) => entry.driverId === driver.driverId)
      .sort((a, b) => a.year - b.year);
    const teams = [...new Set(seasons.map((entry) => entry.constructorName).filter(Boolean))] as string[];
    const championships = this.dataset.standings
      .filter((standing) => standing.driverId === driver.driverId && standing.position === 1)
      .map((standing) => standing.year)
      .sort((a, b) => a - b);
    const dateOfBirth = parseDate(driver.dateOfBirth);
    const currentTeamName = seasons.length > 0 ? (seasons[seasons.length - 1]?.constructorName ?? null) : null;

    return {
      profile: {
        fullName: driverFullName(driver),
        publicName: driverDisplayName(driver),
        dateOfBirth,
        placeOfBirth: driver.placeOfBirth ?? null,
        nationality: driver.nationality ?? null,
        representedCountry: driver.nationality ?? null,
        driverNumber: driver.number ?? null,
        driverCode: driver.code ?? null,
        currentTeamName,
        officialLinks: null,
        biographyFacts: {
          publicName: driverDisplayName(driver),
          fullName: driverFullName(driver),
          dateOfBirth,
          placeOfBirth: driver.placeOfBirth ?? null,
          nationality: driver.nationality ?? null,
          representedCountry: driver.nationality ?? null,
          teams,
          championships,
        },
      },
      source: this.releaseSource(),
    };
  }

  async fetchRelationships(candidate: ProviderIdentityCandidate): Promise<ProviderRelationship[]> {
    void candidate;
    return [];
  }

  async fetchCareerData(candidate: ProviderIdentityCandidate): Promise<ProviderCareerData> {
    const seasons = this.dataset.seasonEntries
      .filter((entry) => entry.driverId === candidate.externalId)
      .sort((a, b) => a.year - b.year)
      .map((entry) => ({
        year: entry.year,
        teamName: entry.constructorName ?? null,
        number: entry.number ?? null,
      }));
    const championships = this.dataset.standings
      .filter((standing) => standing.driverId === candidate.externalId && standing.position === 1)
      .map((standing) => standing.year)
      .sort((a, b) => a - b);
    return { seasons, championships };
  }

  async fetchSourceReferences(candidate: ProviderIdentityCandidate): Promise<ProviderSourceReference[]> {
    void candidate;
    return [this.releaseSource()];
  }

  private releaseSource(): ProviderSourceReference {
    return {
      provider: "F1DB",
      sourceKind: "STRUCTURED_RELEASE",
      url: null,
      title: `F1DB release ${this.dataset.version}`,
      license: "CC_BY_4_0",
      attributionRequirement: "Obrigatória",
      attributionText: "F1DB — CC BY 4.0",
      sourceVersion: this.dataset.version,
    };
  }
}
