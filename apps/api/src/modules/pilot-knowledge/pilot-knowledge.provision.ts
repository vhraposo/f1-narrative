import type { Prisma } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import { getF1dbDataset } from "../f1db/f1db.dataset.js";
import {
  computeF1dbDriverMilestones,
  getF1dbDriverStats,
  resolveF1dbDriverStrict,
} from "../f1db/f1db.drivers.js";
import type { F1dbDriver } from "../f1db/f1db.dataset.js";
import {
  BIOGRAPHY_COMPOSER_VERSION,
  deterministicBiographyContext,
  type BiographyComposer,
} from "./biography.composer.js";
import {
  buildApprovedBiographyClaims,
  type ApprovedClaimSet,
  type BiographyClaimSourceRef,
} from "./biography.claims.js";
import {
  curatedEvidenceVersion,
  getCuratedEvidenceForDriver,
} from "./biography.evidence.js";
import { composeBiographyFromClaims } from "./biography.pipeline.js";
import { validateBiographyText } from "./biography.quality.js";
import type { BiographyVerifier } from "./biography.verifier.js";
import { deriveMilestonesFromExternalData } from "./pilot-knowledge.events.js";
import {
  readDriverSourceIdentity,
  upsertDriverProfileFromProvider,
  type BiographyFacts,
  type StructuredDriverProfileInput,
} from "./pilot-knowledge.profile.js";
import { recordKnowledgeSource } from "./pilot-knowledge.sources.js";

export type ProvisionOptions = {
  readonly biographyComposer?: BiographyComposer;
  readonly biographyVerifier?: BiographyVerifier;
  readonly biographyModel?: string;
};

export type ProvisionOutcome =
  | "PROVISIONED"
  | "ALREADY_PROVISIONED"
  | "NO_EXTERNAL_BINDING"
  | "DRIVER_NOT_FOUND";

export type ProvisionBiographyStatus = {
  readonly mode: "LLM_APPROVED" | "RICH_DETERMINISTIC" | "FALLBACK" | "NOT_REQUESTED";
  readonly fallbackReason: string | null;
};

export type ProvisionResult = {
  readonly outcome: ProvisionOutcome;
  readonly externalDriverId: string | null;
  readonly biography?: ProvisionBiographyStatus;
};

type MirrorDriver = {
  readonly name: string;
  readonly fullName: string | null;
  readonly nationality: string | null;
  readonly number: number | null;
  readonly sourceRecord: Prisma.JsonValue | null;
};

type MirrorCareer = {
  teams: string[];
  championships: number[];
  currentTeamName: string | null;
  driverNumber: number | null;
  debutYear: number | null;
};

async function collectMirrorCareer(externalDriverId: string): Promise<MirrorCareer> {
  const [seasons, titles] = await Promise.all([
    prisma.externalDriverSeason.findMany({
      where: { externalDriverId },
      orderBy: [{ seasonYear: "asc" }],
      select: { seasonYear: true, teamNameSnapshot: true, number: true },
    }),
    prisma.externalStanding.findMany({
      where: { externalDriverId, position: 1 },
      orderBy: [{ seasonYear: "asc" }],
      select: { seasonYear: true },
    }),
  ]);

  // P1 de temporada em andamento não é título: só anos com campeão final
  // conhecido no F1DB entram como campeonato (líder ≠ campeão).
  const dataset = getF1dbDataset();
  const championships = titles
    .map((title) => title.seasonYear)
    .filter((year) => !dataset || dataset.championsByYear.has(year));
  const teams = [...new Set(seasons.map((season) => season.teamNameSnapshot).filter(Boolean))] as string[];
  const lastSeason = seasons[seasons.length - 1] ?? null;
  return {
    teams,
    championships,
    currentTeamName: lastSeason?.teamNameSnapshot ?? null,
    driverNumber: lastSeason?.number ?? null,
    debutYear: seasons[0]?.seasonYear ?? null,
  };
}

function topMilestoneTitles(
  milestones: readonly { title: string; importance: number; seasonYear: number | null }[],
): string[] {
  return [...milestones]
    .sort((a, b) => b.importance - a.importance || (a.seasonYear ?? 0) - (b.seasonYear ?? 0))
    .slice(0, 3)
    .map((event) => event.title);
}

function buildBiographyFacts(input: {
  driver: MirrorDriver;
  career: MirrorCareer;
  milestones: readonly { title: string; importance: number; seasonYear: number | null }[];
  f1dbDriver: F1dbDriver | null;
  sourceIdentity: { dateOfBirth: Date | null; driverCode: string | null };
}): BiographyFacts {
  const { driver, career, milestones, f1dbDriver, sourceIdentity } = input;
  const f1dbMilestones = f1dbDriver
    ? computeF1dbDriverMilestones(f1dbDriver.id)
    : null;
  const f1dbStats = f1dbDriver ? getF1dbDriverStats(f1dbDriver) : null;

  const debutYears = [
    career.debutYear,
    f1dbMilestones?.debut?.year ?? null,
  ].filter((year): year is number => typeof year === "number");
  const championships = [
    ...new Set([...career.championships, ...(f1dbMilestones?.championshipYears ?? [])]),
  ].sort((a, b) => a - b);
  const dateOfBirth = sourceIdentity.dateOfBirth ?? (f1dbDriver?.dateOfBirth
    ? new Date(`${f1dbDriver.dateOfBirth}T00:00:00.000Z`)
    : null);

  return {
    publicName: driver.name,
    fullName: driver.fullName,
    dateOfBirth,
    placeOfBirth: f1dbDriver?.placeOfBirth ?? null,
    nationality: driver.nationality,
    debutYear: debutYears.length > 0 ? Math.min(...debutYears) : null,
    teams: career.teams,
    championships,
    milestoneTitles: topMilestoneTitles(milestones),
    career: f1dbStats
      ? {
          wins: f1dbStats.wins,
          podiums: f1dbStats.podiums,
          poles: f1dbStats.poles,
          fastestLaps: f1dbStats.fastestLaps,
          titles: f1dbStats.titles,
          starts: f1dbStats.starts,
        }
      : null,
  };
}

const SOURCE_PROVIDER_MAP: Record<string, "F1_OFFICIAL" | "TEAM_OFFICIAL" | "DRIVER_OFFICIAL" | "REPUTABLE_NEWS" | "CURATED"> = {
  F1_OFFICIAL: "F1_OFFICIAL",
  TEAM_OFFICIAL: "TEAM_OFFICIAL",
  DRIVER_OFFICIAL: "DRIVER_OFFICIAL",
  REPUTABLE_NEWS: "REPUTABLE_NEWS",
};

const SOURCE_KIND_MAP: Record<string, "OFFICIAL_PROFILE" | "BIOGRAPHY_PAGE" | "INTERVIEW" | "DATABASE_EXPORT"> = {
  OFFICIAL_PROFILE: "OFFICIAL_PROFILE",
  BIOGRAPHY_PAGE: "BIOGRAPHY_PAGE",
  INTERVIEW: "INTERVIEW",
};

async function recordCuratedEvidenceSources(
  claims: ApprovedClaimSet,
  now: Date,
): Promise<Array<{ url: string; sourceId: string }>> {
  const refs = new Map<string, BiographyClaimSourceRef>();
  for (const claim of claims.claims) {
    if (claim.sourceRef) refs.set(claim.sourceRef.url, claim.sourceRef);
  }
  const recorded: Array<{ url: string; sourceId: string }> = [];
  for (const ref of refs.values()) {
    const source = await recordKnowledgeSource(
      {
        provider: SOURCE_PROVIDER_MAP[ref.provider] ?? "CURATED",
        sourceKind: SOURCE_KIND_MAP[ref.sourceType] ?? "DATABASE_EXPORT",
        url: ref.url,
        title: ref.title,
        license: "UNKNOWN",
        attributionRequirement: "Obrigatória",
        attributionText: "Fato estruturado com proveniência; nenhum texto de fonte foi copiado.",
        metadata: { curatedEvidence: true },
      },
      now,
    );
    recorded.push({ url: ref.url, sourceId: source.id });
  }
  return recorded;
}

async function recordGeneratedBiographySource(
  claims: ApprovedClaimSet,
  model: string | null,
  evidenceSources: ReadonlyArray<{ url: string; sourceId: string }>,
  now: Date,
) {
  return recordKnowledgeSource(
    {
      provider: "CURATED",
      sourceKind: "BIOGRAPHY_PAGE",
      url: null,
      title: `Biografia composta por IA (${BIOGRAPHY_COMPOSER_VERSION})`,
      license: "UNKNOWN",
      attributionRequirement: null,
      attributionText:
        "Síntese original gerada a partir de claims aprovados do espelho/F1DB e evidence curada; não copiada de fonte.",
      metadata: {
        generator: "biography-composer",
        generatorVersion: BIOGRAPHY_COMPOSER_VERSION,
        fingerprint: claims.fingerprint,
        claimsCount: claims.claims.length,
        model: model ?? null,
        evidenceVersion: claims.evidenceVersion,
        evidenceSources,
      },
    },
    now,
  );
}

async function recordDeterministicBiographySource(
  claims: ApprovedClaimSet,
  mode: "RICH_DETERMINISTIC" | "FALLBACK",
  evidenceSources: ReadonlyArray<{ url: string; sourceId: string }>,
  now: Date,
) {
  const title = `Biografia determinística (${BIOGRAPHY_COMPOSER_VERSION})`;
  const existing = await prisma.externalKnowledgeSource.findFirst({
    where: {
      provider: "CURATED",
      sourceKind: "BIOGRAPHY_PAGE",
      title,
      metadata: { path: ["fingerprint"], equals: claims.fingerprint },
    },
  });
  if (existing) return existing;

  return recordKnowledgeSource(
    {
      provider: "CURATED",
      sourceKind: "BIOGRAPHY_PAGE",
      url: null,
      title,
      license: "UNKNOWN",
      attributionRequirement: null,
      attributionText:
        "Síntese determinística a partir de claims aprovados do espelho/F1DB e evidence curada; nenhum texto de fonte foi copiado.",
      metadata: {
        generator: "biography-deterministic",
        generatorVersion: BIOGRAPHY_COMPOSER_VERSION,
        fingerprint: claims.fingerprint,
        claimsCount: claims.claims.length,
        evidenceVersion: claims.evidenceVersion,
        evidenceSources,
        mode,
      },
    },
    now,
  );
}

async function buildMirrorProfileInput(
  externalDriverId: string,
  driver: MirrorDriver,
  sourceId: string | null,
  now: Date,
  options: ProvisionOptions = {},
): Promise<{ input: StructuredDriverProfileInput; biography: ProvisionBiographyStatus }> {
  const [career, milestones] = await Promise.all([
    collectMirrorCareer(externalDriverId),
    deriveMilestonesFromExternalData(externalDriverId, now),
  ]);
  const sourceIdentity = readDriverSourceIdentity(driver.sourceRecord);

  const dataset = getF1dbDataset();
  const resolution = dataset
    ? resolveF1dbDriverStrict({
        name: driver.name,
        driverCode: sourceIdentity.driverCode,
      })
    : { driver: null, ambiguous: false };
  const f1dbDriver = resolution.driver;

  const biographyFacts = buildBiographyFacts({
    driver,
    career,
    milestones,
    f1dbDriver,
    sourceIdentity,
  });

  const driverCode = sourceIdentity.driverCode ?? f1dbDriver?.abbreviation ?? null;
  const baseInput = {
    fullName: driver.fullName,
    publicName: driver.name,
    dateOfBirth: biographyFacts.dateOfBirth ?? null,
    placeOfBirth: biographyFacts.placeOfBirth ?? null,
    driverCode,
    nationality: driver.nationality,
    driverNumber: career.driverNumber ?? driver.number ?? null,
    currentTeamName: career.currentTeamName,
    sourceId,
    biographyFacts,
  } satisfies StructuredDriverProfileInput;

  const curated = getCuratedEvidenceForDriver(f1dbDriver?.id ?? null);
  const evidenceVersion = curatedEvidenceVersion();
  const claimSet = buildApprovedBiographyClaims({
    externalDriverId,
    facts: biographyFacts,
    f1dbDriver,
    f1dbAmbiguous: resolution.ambiguous,
    f1dbSourceVersion: dataset?.sourceVersion ?? null,
    curated,
    evidenceVersion,
  });

  const pipeline = await composeBiographyFromClaims({
    claimSet,
    facts: biographyFacts,
    ...(options.biographyComposer ? { composer: options.biographyComposer } : {}),
    ...(options.biographyVerifier ? { verifier: options.biographyVerifier } : {}),
  });

  if (pipeline.mode === "LLM_APPROVED" && pipeline.display.trim().length > 0) {
    const evidenceSources = await recordCuratedEvidenceSources(claimSet, now);
    const source = await recordGeneratedBiographySource(
      claimSet,
      options.biographyModel ?? null,
      evidenceSources,
      now,
    );
    return {
      input: {
        ...baseInput,
        biographyContent: {
          display: pipeline.display,
          context: deterministicBiographyContext(biographyFacts),
          sourceId: source.id,
        },
      },
      biography: { mode: "LLM_APPROVED", fallbackReason: null },
    };
  }

  if (pipeline.display.trim().length > 0) {
    const evidenceSources = await recordCuratedEvidenceSources(claimSet, now);
    const mode = pipeline.mode === "RICH_DETERMINISTIC" ? "RICH_DETERMINISTIC" : "FALLBACK";
    const source = await recordDeterministicBiographySource(
      claimSet,
      mode,
      evidenceSources,
      now,
    );
    return {
      input: {
        ...baseInput,
        biographyContent: {
          display: pipeline.display,
          context: deterministicBiographyContext(biographyFacts),
          sourceId: source.id,
        },
      },
      biography: {
        mode,
        fallbackReason: pipeline.fallbackReason,
      },
    };
  }

  return {
    input: baseInput,
    biography: { mode: "NOT_REQUESTED", fallbackReason: pipeline.fallbackReason },
  };
}

function storedBiographyIsValid(
  claims: ApprovedClaimSet,
  display: string,
): boolean {
  return validateBiographyText({ text: display, claims }).ok;
}

async function generatedBiographyNeedsRepair(input: {
  externalDriverId: string;
  driver: MirrorDriver;
  profile: {
    biographyDisplay: string | null;
  };
  metadata: Prisma.JsonValue | null;
  now: Date;
}): Promise<boolean> {
  const metadata = (input.metadata ?? {}) as Record<string, unknown>;
  if (metadata.generatorVersion !== BIOGRAPHY_COMPOSER_VERSION) return true;
  if (metadata.evidenceVersion !== curatedEvidenceVersion()) return true;
  const display = input.profile.biographyDisplay?.trim();
  if (!display) return true;

  const [career, milestones] = await Promise.all([
    collectMirrorCareer(input.externalDriverId),
    deriveMilestonesFromExternalData(input.externalDriverId, input.now),
  ]);
  const sourceIdentity = readDriverSourceIdentity(input.driver.sourceRecord);
  const dataset = getF1dbDataset();
  const resolution = dataset
    ? resolveF1dbDriverStrict({
        name: input.driver.name,
        driverCode: sourceIdentity.driverCode,
      })
    : { driver: null, ambiguous: false };
  const facts = buildBiographyFacts({
    driver: input.driver,
    career,
    milestones,
    f1dbDriver: resolution.driver,
    sourceIdentity,
  });
  const claims = buildApprovedBiographyClaims({
    externalDriverId: input.externalDriverId,
    facts,
    f1dbDriver: resolution.driver,
    f1dbAmbiguous: resolution.ambiguous,
    f1dbSourceVersion: dataset?.sourceVersion ?? null,
    curated: getCuratedEvidenceForDriver(resolution.driver?.id ?? null),
    evidenceVersion: curatedEvidenceVersion(),
  });
  return !storedBiographyIsValid(claims, display);
}

export type CharacterBiographyEvidence = {
  readonly externalDriverId: string;
  readonly claimSet: ApprovedClaimSet;
  readonly curated: ReturnType<typeof getCuratedEvidenceForDriver>;
  readonly f1dbDriver: F1dbDriver | null;
};

export async function loadBiographyEvidenceForCharacter(
  characterId: string,
  now: Date = new Date(),
): Promise<CharacterBiographyEvidence | null> {
  const binding = await prisma.externalBindingDriver.findFirst({
    where: { characterId },
    orderBy: { createdAt: "asc" },
    select: { externalDriverId: true },
  });
  if (!binding) return null;

  const externalDriverId = binding.externalDriverId;
  const driver = await prisma.externalDriver.findUnique({
    where: { id: externalDriverId },
    select: {
      id: true,
      name: true,
      fullName: true,
      nationality: true,
      number: true,
      sourceRecord: true,
    },
  });
  if (!driver) return null;

  const [career, milestones] = await Promise.all([
    collectMirrorCareer(externalDriverId),
    deriveMilestonesFromExternalData(externalDriverId, now),
  ]);
  const sourceIdentity = readDriverSourceIdentity(driver.sourceRecord);
  const dataset = getF1dbDataset();
  const resolution = dataset
    ? resolveF1dbDriverStrict({ name: driver.name, driverCode: sourceIdentity.driverCode })
    : { driver: null, ambiguous: false };
  const f1dbDriver = resolution.driver;
  const facts = buildBiographyFacts({
    driver,
    career,
    milestones,
    f1dbDriver,
    sourceIdentity,
  });
  const curated = getCuratedEvidenceForDriver(f1dbDriver?.id ?? null);
  const claimSet = buildApprovedBiographyClaims({
    externalDriverId,
    facts,
    f1dbDriver,
    f1dbAmbiguous: resolution.ambiguous,
    f1dbSourceVersion: dataset?.sourceVersion ?? null,
    curated,
    evidenceVersion: curatedEvidenceVersion(),
  });
  return { externalDriverId, claimSet, curated, f1dbDriver };
}

export async function ensurePilotKnowledgeProvisioned(
  characterId: string,
  now: Date = new Date(),
  options: ProvisionOptions = {},
): Promise<ProvisionResult> {
  const binding = await prisma.externalBindingDriver.findFirst({
    where: { characterId },
    orderBy: { createdAt: "asc" },
    select: { externalDriverId: true },
  });
  if (!binding) return { outcome: "NO_EXTERNAL_BINDING", externalDriverId: null };

  const externalDriverId = binding.externalDriverId;
  const driver = await prisma.externalDriver.findUnique({
    where: { id: externalDriverId },
    select: {
      id: true,
      name: true,
      fullName: true,
      nationality: true,
      number: true,
      sourceRecord: true,
    },
  });
  if (!driver) return { outcome: "DRIVER_NOT_FOUND", externalDriverId };

  const existingProfile = await prisma.externalDriverProfile.findUnique({
    where: { externalDriverId },
    select: {
      id: true,
      biographyDisplay: true,
      biographySourceId: true,
      sourceId: true,
      publicName: true,
      fullName: true,
      dateOfBirth: true,
      placeOfBirth: true,
      nationality: true,
    },
  });

  if (existingProfile) {
    const biographySource = existingProfile.biographySourceId
      ? await prisma.externalKnowledgeSource.findUnique({
          where: { id: existingProfile.biographySourceId },
          select: { provider: true, sourceKind: true, metadata: true },
        })
      : null;
    const generated =
      biographySource !== null &&
      biographySource.provider === "CURATED" &&
      biographySource.sourceKind === "BIOGRAPHY_PAGE";
    const ownedByMirror =
      biographySource === null ||
      (biographySource.provider === "CURATED" &&
        biographySource.sourceKind === "DATABASE_EXPORT");

    if (ownedByMirror) {
      const { input, biography } = await buildMirrorProfileInput(
        externalDriverId,
        driver,
        existingProfile.biographySourceId ?? existingProfile.sourceId ?? null,
        now,
        options,
      );
      await upsertDriverProfileFromProvider(externalDriverId, input, now);
      return { outcome: "ALREADY_PROVISIONED", externalDriverId, biography };
    }

    if (!generated) {
      await deriveMilestonesFromExternalData(externalDriverId, now);
      return {
        outcome: "ALREADY_PROVISIONED",
        externalDriverId,
        biography: { mode: "NOT_REQUESTED", fallbackReason: null },
      };
    }

    const needsRepair = await generatedBiographyNeedsRepair({
      externalDriverId,
      driver,
      profile: { biographyDisplay: existingProfile.biographyDisplay },
      metadata: biographySource?.metadata ?? null,
      now,
    });
    if (needsRepair) {
      const { input, biography } = await buildMirrorProfileInput(
        externalDriverId,
        driver,
        existingProfile.sourceId ?? existingProfile.biographySourceId ?? null,
        now,
        options,
      );
      await upsertDriverProfileFromProvider(externalDriverId, input, now);
      return { outcome: "ALREADY_PROVISIONED", externalDriverId, biography };
    }

    await deriveMilestonesFromExternalData(externalDriverId, now);
    return {
      outcome: "ALREADY_PROVISIONED",
      externalDriverId,
      biography: { mode: "NOT_REQUESTED", fallbackReason: null },
    };
  }

  const source = await recordKnowledgeSource(
    {
      provider: "CURATED",
      sourceKind: "DATABASE_EXPORT",
      url: null,
      title: "Espelho externo sincronizado (Jolpica)",
      license: "UNKNOWN",
      attributionRequirement: null,
      attributionText: "Dados do espelho externo do próprio sistema",
      metadata: { origin: "jolpica-mirror" },
    },
    now,
  );

  const { input, biography } = await buildMirrorProfileInput(
    externalDriverId,
    driver,
    source.id,
    now,
    options,
  );
  await upsertDriverProfileFromProvider(externalDriverId, input, now);

  return { outcome: "PROVISIONED", externalDriverId, biography };
}
