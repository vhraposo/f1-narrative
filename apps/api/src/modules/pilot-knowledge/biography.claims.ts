import { createHash } from "node:crypto";

import {
  computeF1dbDriverMilestones,
  getF1dbDriverTeamSeasons,
  getF1dbRaceLabel,
} from "../f1db/f1db.drivers.js";
import type { F1dbDriver } from "../f1db/f1db.dataset.js";
import type { CuratedEvidenceBundle } from "./biography.evidence.js";
import { feminizeNationalityPtBr, resolveNationalityPtBr } from "./nationality.ptbr.js";
import type { BiographyFacts } from "./pilot-knowledge.profile.js";

export const BIOGRAPHY_CLAIM_SCHEMA_VERSION = "biography-claims.v1";
export const BIOGRAPHY_LANGUAGE = "pt-BR";

export type BiographyEvidenceCategory =
  | "IDENTITY"
  | "ORIGIN"
  | "KARTING"
  | "JUNIOR_CAREER"
  | "F1_ENTRY"
  | "TEAM_HISTORY"
  | "F1_ACHIEVEMENTS"
  | "PUBLIC_PERSONALITY"
  | "INTERESTS"
  | "PROJECTS"
  | "CURRENT_CONTEXT";

export const BIOGRAPHY_EVIDENCE_CATEGORIES: readonly BiographyEvidenceCategory[] = [
  "IDENTITY",
  "ORIGIN",
  "KARTING",
  "JUNIOR_CAREER",
  "F1_ENTRY",
  "TEAM_HISTORY",
  "F1_ACHIEVEMENTS",
  "PUBLIC_PERSONALITY",
  "INTERESTS",
  "PROJECTS",
  "CURRENT_CONTEXT",
];

export function isBiographyEvidenceCategory(
  value: string,
): value is BiographyEvidenceCategory {
  return (BIOGRAPHY_EVIDENCE_CATEGORIES as readonly string[]).includes(value);
}

export type BiographyClaimKey = string;

export type BiographyClaimAuthority =
  | "PRIMARY_OFFICIAL"
  | "STRUCTURED_CANONICAL"
  | "SECONDARY"
  | "UNVERIFIED";

export type BiographyClaimStatus = "APPROVED" | "AMBIGUOUS_IDENTITY" | "UNVERIFIED";

export type BiographyClaimSourceRef = {
  readonly provider: string;
  readonly sourceType: string;
  readonly title: string;
  readonly url: string;
};

export type BiographyClaim = {
  readonly id: string;
  readonly category: BiographyEvidenceCategory;
  readonly key: BiographyClaimKey;
  readonly value: string;
  readonly display: string;
  readonly year: number | null;
  readonly endYear: number | null;
  readonly authority: BiographyClaimAuthority;
  readonly status: BiographyClaimStatus;
  readonly provider: string;
  readonly sourceVersion: string | null;
  readonly attribution: string | null;
  readonly sourceRef: BiographyClaimSourceRef | null;
};

export type ApprovedClaimSet = {
  readonly schemaVersion: string;
  readonly language: typeof BIOGRAPHY_LANGUAGE;
  readonly externalDriverId: string;
  readonly f1dbDriverId: string | null;
  readonly subjectName: string;
  readonly identityStatus: "RESOLVED" | "AMBIGUOUS_IDENTITY";
  readonly claims: readonly BiographyClaim[];
  readonly fingerprint: string;
  readonly evidenceVersion: string | null;
};

type ClaimDraft = {
  readonly category?: BiographyEvidenceCategory;
  readonly key: BiographyClaimKey;
  readonly value: string;
  readonly display: string;
  readonly year: number | null;
  readonly endYear: number | null;
  readonly authority: BiographyClaimAuthority;
  readonly provider: string;
  readonly sourceVersion: string | null;
  readonly attribution?: string | null;
  readonly sourceRef?: BiographyClaimSourceRef | null;
};

const KEY_CATEGORY: Record<string, BiographyEvidenceCategory> = {
  FULL_NAME: "IDENTITY",
  PUBLIC_NAME: "IDENTITY",
  BIRTH_DATE: "IDENTITY",
  BIRTH_PLACE: "IDENTITY",
  NATIONALITY: "IDENTITY",
  COUNTRY: "IDENTITY",
  F1_DEBUT: "F1_ENTRY",
  JUNIOR_PROGRAM: "F1_ENTRY",
  DEBUT: "F1_ENTRY",
  TEAM_SEASON: "TEAM_HISTORY",
  FIRST_WIN: "F1_ACHIEVEMENTS",
  FIRST_PODIUM: "F1_ACHIEVEMENTS",
  FIRST_POLE: "F1_ACHIEVEMENTS",
  CHAMPIONSHIP: "F1_ACHIEVEMENTS",
  CAREER_STATS: "F1_ACHIEVEMENTS",
  INTEREST: "INTERESTS",
};

function categoryForKey(key: string): BiographyEvidenceCategory {
  return KEY_CATEGORY[key] ?? "F1_ACHIEVEMENTS";
}

const CATEGORY_ORDER: Record<BiographyEvidenceCategory, number> = {
  IDENTITY: 0,
  ORIGIN: 1,
  KARTING: 2,
  JUNIOR_CAREER: 3,
  F1_ENTRY: 4,
  TEAM_HISTORY: 5,
  F1_ACHIEVEMENTS: 6,
  PUBLIC_PERSONALITY: 7,
  INTERESTS: 8,
  PROJECTS: 9,
  CURRENT_CONTEXT: 10,
};

function normalizeAuthority(value: string): BiographyClaimAuthority {
  if (
    value === "PRIMARY_OFFICIAL" ||
    value === "STRUCTURED_CANONICAL" ||
    value === "SECONDARY" ||
    value === "UNVERIFIED"
  ) {
    return value;
  }
  return "SECONDARY";
}

const BIRTH_DATE_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function pushClaim(drafts: ClaimDraft[], draft: ClaimDraft | null): void {
  if (!draft) return;
  if (draft.value.trim().length === 0 || draft.display.trim().length === 0) return;
  const duplicate = drafts.some(
    (item) =>
      item.key === draft.key &&
      item.value === draft.value &&
      item.year === draft.year &&
      item.category === draft.category,
  );
  if (!duplicate) drafts.push(draft);
}

function claimOrderKey(claim: ClaimDraft): [number, string, string] {
  const category = claim.category ?? categoryForKey(claim.key);
  return [
    CATEGORY_ORDER[category],
    String(claim.year ?? 0).padStart(4, "0"),
    claim.key,
  ];
}

export function buildApprovedBiographyClaims(input: {
  readonly externalDriverId: string;
  readonly facts: BiographyFacts;
  readonly f1dbDriver: F1dbDriver | null;
  readonly f1dbAmbiguous: boolean;
  readonly f1dbSourceVersion: string | null;
  readonly curated?: CuratedEvidenceBundle | null;
  readonly evidenceVersion?: string | null;
}): ApprovedClaimSet {
  const drafts: ClaimDraft[] = [];
  const provider = input.f1dbDriver ? "F1DB" : "EXTERNAL_MIRROR";
  const sourceVersion = input.f1dbSourceVersion;

  const subjectName =
    (input.f1dbDriver?.fullName ?? input.facts.fullName ?? input.facts.publicName ?? "").trim();

  const fullName = input.f1dbDriver?.fullName ?? input.facts.fullName;
  if (fullName) {
    pushClaim(drafts, {
      key: "FULL_NAME",
      value: fullName,
      display: fullName,
      year: null,
      endYear: null,
      authority: input.f1dbDriver ? "STRUCTURED_CANONICAL" : "SECONDARY",
      provider,
      sourceVersion,
    });
  }
  const publicName = input.facts.publicName;
  if (publicName && publicName !== fullName) {
    pushClaim(drafts, {
      key: "PUBLIC_NAME",
      value: publicName,
      display: publicName,
      year: null,
      endYear: null,
      authority: "SECONDARY",
      provider: "EXTERNAL_MIRROR",
      sourceVersion: null,
    });
  }

  const dateOfBirth = input.facts.dateOfBirth;
  if (dateOfBirth) {
    pushClaim(drafts, {
      key: "BIRTH_DATE",
      value: dateOfBirth.toISOString().slice(0, 10),
      display: BIRTH_DATE_FORMAT.format(dateOfBirth),
      year: dateOfBirth.getUTCFullYear(),
      endYear: null,
      authority: input.f1dbDriver?.dateOfBirth ? "STRUCTURED_CANONICAL" : "SECONDARY",
      provider,
      sourceVersion,
    });
  }
  if (input.facts.placeOfBirth) {
    pushClaim(drafts, {
      key: "BIRTH_PLACE",
      value: input.facts.placeOfBirth,
      display: input.facts.placeOfBirth,
      year: null,
      endYear: null,
      authority: input.f1dbDriver?.placeOfBirth ? "STRUCTURED_CANONICAL" : "SECONDARY",
      provider,
      sourceVersion,
    });
  }
  const nationality = input.facts.nationality
    ? resolveNationalityPtBr(input.facts.nationality)
    : null;
  if (nationality) {
    pushClaim(drafts, {
      key: "NATIONALITY",
      value: nationality,
      display: feminizeNationalityPtBr(nationality).toLowerCase(),
      year: null,
      endYear: null,
      authority: input.f1dbDriver?.nationalityCountryId ? "STRUCTURED_CANONICAL" : "SECONDARY",
      provider,
      sourceVersion,
    });
  }

  const f1dbMilestones = input.f1dbDriver
    ? computeF1dbDriverMilestones(input.f1dbDriver.id)
    : null;

  const debutYear = input.facts.debutYear ?? f1dbMilestones?.debut?.year ?? null;
  if (debutYear !== null) {
    pushClaim(drafts, {
      key: "F1_DEBUT",
      value: String(debutYear),
      display: `${debutYear}`,
      year: debutYear,
      endYear: null,
      authority: "STRUCTURED_CANONICAL",
      provider: input.f1dbDriver ? "F1DB" : "EXTERNAL_MIRROR",
      sourceVersion,
    });
  }

  if (input.f1dbDriver) {
    const teamSeasons = getF1dbDriverTeamSeasons(input.f1dbDriver.id);
    let index = 0;
    while (index < teamSeasons.length) {
      const start = teamSeasons[index];
      if (!start) break;
      const teamLabel = start.constructorFullName || start.constructorName;
      let endYear = start.year;
      let cursor = index + 1;
      while (
        cursor < teamSeasons.length &&
        teamSeasons[cursor]?.constructorId === start.constructorId &&
        teamSeasons[cursor]?.year === endYear + 1
      ) {
        endYear = teamSeasons[cursor]?.year ?? endYear;
        cursor += 1;
      }
      const display =
        endYear > start.year
          ? `${teamLabel} (${start.year}–${endYear})`
          : `${teamLabel} (${start.year})`;
      pushClaim(drafts, {
        key: "TEAM_SEASON",
        value: `${start.constructorId}:${start.year}-${endYear}`,
        display,
        year: start.year,
        endYear,
        authority: "STRUCTURED_CANONICAL",
        provider: "F1DB",
        sourceVersion,
      });
      index = cursor;
    }

    if (f1dbMilestones?.firstWin) {
      const label = getF1dbRaceLabel(f1dbMilestones.firstWin.raceId);
      pushClaim(drafts, {
        key: "FIRST_WIN",
        value: String(f1dbMilestones.firstWin.year),
        display: label
          ? `Primeira vitória em ${f1dbMilestones.firstWin.year} (${label})`
          : `Primeira vitória em ${f1dbMilestones.firstWin.year}`,
        year: f1dbMilestones.firstWin.year,
        endYear: null,
        authority: "STRUCTURED_CANONICAL",
        provider: "F1DB",
        sourceVersion,
      });
    }
    if (f1dbMilestones?.firstPodium) {
      pushClaim(drafts, {
        key: "FIRST_PODIUM",
        value: String(f1dbMilestones.firstPodium.year),
        display: `Primeiro pódio em ${f1dbMilestones.firstPodium.year}`,
        year: f1dbMilestones.firstPodium.year,
        endYear: null,
        authority: "STRUCTURED_CANONICAL",
        provider: "F1DB",
        sourceVersion,
      });
    }
    if (f1dbMilestones?.firstPole) {
      pushClaim(drafts, {
        key: "FIRST_POLE",
        value: String(f1dbMilestones.firstPole.year),
        display: `Primeira pole em ${f1dbMilestones.firstPole.year}`,
        year: f1dbMilestones.firstPole.year,
        endYear: null,
        authority: "STRUCTURED_CANONICAL",
        provider: "F1DB",
        sourceVersion,
      });
    }
    for (const year of f1dbMilestones?.championshipYears ?? []) {
      pushClaim(drafts, {
        key: "CHAMPIONSHIP",
        value: String(year),
        display: `Campeão mundial em ${year}`,
        year,
        endYear: null,
        authority: "STRUCTURED_CANONICAL",
        provider: "F1DB",
        sourceVersion,
      });
    }
  }

  if (input.facts.championships && input.facts.championships.length > 0) {
    for (const year of input.facts.championships) {
      pushClaim(drafts, {
        key: "CHAMPIONSHIP",
        value: String(year),
        display: `Campeão mundial em ${year}`,
        year,
        endYear: null,
        authority: "STRUCTURED_CANONICAL",
        provider: "EXTERNAL_MIRROR",
        sourceVersion: null,
      });
    }
  }

  const career = input.facts.career;
  if (career && career.starts > 0) {
    const parts: string[] = [];
    if (career.wins > 0) parts.push(`${career.wins} ${career.wins === 1 ? "vitória" : "vitórias"}`);
    if (career.podiums > 0) parts.push(`${career.podiums} ${career.podiums === 1 ? "pódio" : "pódios"}`);
    if (career.poles > 0) parts.push(`${career.poles} ${career.poles === 1 ? "pole" : "poles"}`);
    if (career.fastestLaps > 0) {
      parts.push(
        career.fastestLaps === 1
          ? "1 volta mais rápida"
          : `${career.fastestLaps} voltas mais rápidas`,
      );
    }
    const titlesLabel =
      career.titles === 1 ? "1 título mundial" : `${career.titles} títulos mundiais`;
    const statsText =
      career.titles > 0
        ? `${career.starts} largadas, ${parts.join(", ")} e ${titlesLabel}`
        : `${career.starts} largadas, ${parts.join(", ")}`;
    pushClaim(drafts, {
      key: "CAREER_STATS",
      value: `${career.starts}:${career.wins}:${career.podiums}:${career.poles}:${career.fastestLaps}:${career.titles}`,
      display: statsText,
      year: null,
      endYear: null,
      authority: "STRUCTURED_CANONICAL",
      provider: input.f1dbDriver ? "F1DB" : "EXTERNAL_MIRROR",
      sourceVersion,
    });
  }

  for (const interest of input.facts.interests ?? []) {
    pushClaim(drafts, {
      key: "INTEREST",
      value: interest,
      display: interest,
      year: null,
      endYear: null,
      authority: "SECONDARY",
      provider: "CURATED",
      sourceVersion: null,
    });
  }

  const curatedClaims = input.curated?.claims ?? [];
  const curatedKeys = new Set(curatedClaims.map((claim) => claim.key));
  const curatedHasTeamHistory = curatedClaims.some(
    (claim) => claim.category === "TEAM_HISTORY",
  );
  if (curatedKeys.size > 0 || curatedHasTeamHistory) {
    for (let index = drafts.length - 1; index >= 0; index -= 1) {
      const draft = drafts[index];
      if (!draft || draft.sourceRef) continue;
      const replacedByKey = curatedKeys.has(draft.key);
      const replacedTeam = curatedHasTeamHistory && draft.key === "TEAM_SEASON";
      if (replacedByKey || replacedTeam) {
        drafts.splice(index, 1);
      }
    }
  }

  for (const claim of curatedClaims) {
    if (!isBiographyEvidenceCategory(claim.category)) continue;
    const source = input.curated?.sources.get(claim.sourceRef);
    if (!source) continue;
    pushClaim(drafts, {
      category: claim.category,
      key: claim.key,
      value: claim.value,
      display: claim.display,
      year: claim.year,
      endYear: claim.endYear,
      authority: normalizeAuthority(claim.authority),
      provider: source.provider,
      sourceVersion: input.f1dbSourceVersion,
      attribution: claim.attribution,
      sourceRef: {
        provider: source.provider,
        sourceType: source.sourceType,
        title: source.title,
        url: source.url,
      },
    });
  }

  drafts.sort((a, b) => {
    const [groupA, yearA, keyA] = claimOrderKey(a);
    const [groupB, yearB, keyB] = claimOrderKey(b);
    if (groupA !== groupB) return groupA - groupB;
    if (yearA !== yearB) return yearA.localeCompare(yearB);
    return keyA.localeCompare(keyB);
  });

  const claims: BiographyClaim[] = drafts.map((draft, index) => ({
    ...draft,
    category: draft.category ?? categoryForKey(draft.key),
    attribution: draft.attribution ?? null,
    sourceRef: draft.sourceRef ?? null,
    id: `CLAIM-${String(index + 1).padStart(3, "0")}`,
    status: "APPROVED" as const,
  }));

  const identityStatus = input.f1dbAmbiguous ? "AMBIGUOUS_IDENTITY" : "RESOLVED";
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: BIOGRAPHY_CLAIM_SCHEMA_VERSION,
        language: BIOGRAPHY_LANGUAGE,
        externalDriverId: input.externalDriverId,
        f1dbDriverId: input.f1dbDriver?.id ?? null,
        identityStatus,
        evidenceVersion: input.evidenceVersion ?? null,
        claims: claims.map((claim) => [
          claim.category,
          claim.key,
          claim.value,
          claim.year,
          claim.endYear,
          claim.display,
          claim.authority,
          claim.attribution,
          claim.sourceRef?.url ?? null,
        ]),
      }),
    )
    .digest("hex");

  return {
    schemaVersion: BIOGRAPHY_CLAIM_SCHEMA_VERSION,
    language: BIOGRAPHY_LANGUAGE,
    externalDriverId: input.externalDriverId,
    f1dbDriverId: input.f1dbDriver?.id ?? null,
    subjectName: subjectName || "Piloto",
    identityStatus,
    claims,
    fingerprint,
    evidenceVersion: input.evidenceVersion ?? null,
  };
}

export function claimsFingerprint(set: ApprovedClaimSet): string {
  return set.fingerprint;
}

export function planBiographyClaimIds(set: ApprovedClaimSet): readonly string[] {
  return set.claims.map((claim) => claim.id);
}

export function claimVocabulary(set: ApprovedClaimSet): ReadonlySet<string> {
  const words = new Set<string>();
  for (const claim of set.claims) {
    for (const token of `${claim.display} ${claim.value} ${set.subjectName}`
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)) {
      words.add(token.toLowerCase());
    }
  }
  return words;
}
