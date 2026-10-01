import type { ApprovedClaimSet, BiographyEvidenceCategory } from "./biography.claims.js";
import { BIOGRAPHY_EVIDENCE_CATEGORIES } from "./biography.claims.js";

export type BiographyCoverageArea = {
  readonly category: BiographyEvidenceCategory;
  readonly claimCount: number;
};

export type BiographyCoverage = {
  readonly areas: readonly BiographyCoverageArea[];
  readonly relevantCount: number;
  readonly rich: boolean;
  readonly missing: readonly BiographyEvidenceCategory[];
};

const RICH_EXCLUDED: readonly BiographyEvidenceCategory[] = [
  "IDENTITY",
  "CURRENT_CONTEXT",
];

export const RICH_BIOGRAPHY_MIN_AREAS = 5;

export function evaluateBiographyCoverage(set: ApprovedClaimSet): BiographyCoverage {
  const counts = new Map<BiographyEvidenceCategory, number>();
  for (const claim of set.claims) {
    if (claim.status !== "APPROVED") continue;
    counts.set(claim.category, (counts.get(claim.category) ?? 0) + 1);
  }
  const areas: BiographyCoverageArea[] = BIOGRAPHY_EVIDENCE_CATEGORIES.map(
    (category) => ({ category, claimCount: counts.get(category) ?? 0 }),
  );
  const relevantCount = areas.filter(
    (area) => area.claimCount > 0 && !RICH_EXCLUDED.includes(area.category),
  ).length;
  return {
    areas,
    relevantCount,
    rich: relevantCount >= RICH_BIOGRAPHY_MIN_AREAS,
    missing: areas.filter((area) => area.claimCount === 0).map((area) => area.category),
  };
}
