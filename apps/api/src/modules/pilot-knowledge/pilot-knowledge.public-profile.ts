import {
  BIOGRAPHY_EVIDENCE_CATEGORIES,
  type BiographyClaim,
  type BiographyClaimSourceRef,
  type BiographyEvidenceCategory,
} from "./biography.claims.js";
import { evaluateBiographyCoverage } from "./biography.coverage.js";
import { loadBiographyEvidenceForCharacter } from "./pilot-knowledge.provision.js";

export type PublicProfileStatus = "AVAILABLE" | "PARTIAL" | "EMPTY";

export type PublicProfileFact = {
  readonly category: BiographyEvidenceCategory;
  readonly label: string;
  readonly display: string;
  readonly year: number | null;
  readonly authority: string;
  readonly sourceTitle: string | null;
  readonly sourceUrl: string | null;
};

export type PublicProfileSource = {
  readonly provider: string;
  readonly title: string;
  readonly url: string;
};

export type PublicProfileView = {
  readonly status: PublicProfileStatus;
  readonly summary: string | null;
  readonly facts: readonly PublicProfileFact[];
  readonly sources: readonly PublicProfileSource[];
  readonly evidenceVersion: string | null;
  readonly relevantAreaCount: number;
};

export const PUBLIC_PROFILE_CATEGORY_LABELS: Record<BiographyEvidenceCategory, string> = {
  IDENTITY: "Identidade",
  ORIGIN: "Origem",
  KARTING: "Kart",
  JUNIOR_CAREER: "Categorias de base",
  F1_ENTRY: "Chegada à Fórmula 1",
  TEAM_HISTORY: "Equipes",
  F1_ACHIEVEMENTS: "Conquistas",
  PUBLIC_PERSONALITY: "Personalidade pública",
  INTERESTS: "Interesses",
  PROJECTS: "Projetos",
  CURRENT_CONTEXT: "Temporada atual",
};

const PROVIDER_LABELS: Record<string, string> = {
  F1_OFFICIAL: "Formula 1",
  TEAM_OFFICIAL: "Equipe oficial",
  DRIVER_OFFICIAL: "Piloto oficial",
  FIA_OFFICIAL: "FIA",
  REPUTABLE_NEWS: "Imprensa confiável",
};

export function publicProfileProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

const SUMMARY_MAX_CHARS = 900;

const EMPTY_PROFILE: PublicProfileView = {
  status: "EMPTY",
  summary: null,
  facts: [],
  sources: [],
  evidenceVersion: null,
  relevantAreaCount: 0,
};

const RELEVANT_EXCLUDED: readonly BiographyEvidenceCategory[] = ["IDENTITY", "CURRENT_CONTEXT"];

function capitalize(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return trimmed;
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function withPeriod(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return trimmed;
  return /[.!?…]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

function findClaim(
  claims: readonly BiographyClaim[],
  category: BiographyEvidenceCategory,
  keys?: readonly string[],
): BiographyClaim | null {
  const inCategory = claims.filter((claim) => claim.category === category);
  if (inCategory.length === 0) return null;
  if (keys) {
    for (const key of keys) {
      const match = inCategory.find((claim) => claim.key === key);
      if (match) return match;
    }
  }
  return inCategory[0] ?? null;
}

function buildSummary(claims: readonly BiographyClaim[]): string | null {
  if (claims.length === 0) return null;
  const publicName =
    findClaim(claims, "IDENTITY", ["PUBLIC_NAME", "FULL_NAME"])?.display ??
    findClaim(claims, "IDENTITY")?.display ??
    null;
  if (!publicName) return null;
  const nationality = findClaim(claims, "IDENTITY", ["NATIONALITY"])?.display ?? null;
  const birthPlace = findClaim(claims, "IDENTITY", ["BIRTH_PLACE"])?.display ?? null;
  const birthDate = findClaim(claims, "IDENTITY", ["BIRTH_DATE"]) ?? null;

  const sentences: string[] = [];
  const identityParts = [`${publicName} é um piloto`];
  if (nationality) identityParts.push(nationality);
  identityParts.push("de Fórmula 1");
  let identity = identityParts.join(" ");
  if (birthPlace) {
    identity += `, nascido em ${birthPlace}`;
    if (birthDate?.year) identity += ` em ${birthDate.year}`;
  }
  sentences.push(withPeriod(identity));

  const karting = findClaim(claims, "KARTING", ["COMPETITIVE_YEARS", "START_AGE"]);
  const junior = findClaim(claims, "JUNIOR_CAREER");
  if (junior) sentences.push(withPeriod(capitalize(junior.display)));
  else if (karting) sentences.push(withPeriod(capitalize(karting.display)));

  const debut = findClaim(claims, "F1_ENTRY", ["F1_DEBUT", "DEBUT"]);
  if (debut?.year) sentences.push(`Chegou à Fórmula 1 em ${debut.year}.`);

  const teamSeasons = claims.filter((claim) => claim.category === "TEAM_HISTORY");
  if (teamSeasons.length > 0) {
    const recent = teamSeasons.slice(-2).map((claim) => claim.display);
    sentences.push(withPeriod(`Na Fórmula 1, passou por ${recent.join(" e ")}`));
  }

  const achievement = findClaim(claims, "F1_ACHIEVEMENTS", ["CHAMPIONSHIP"]);
  const firstWin = findClaim(claims, "F1_ACHIEVEMENTS", ["FIRST_WIN"]);
  if (achievement) sentences.push(withPeriod(capitalize(achievement.display)));
  else if (firstWin) sentences.push(withPeriod(capitalize(firstWin.display)));

  const current = findClaim(claims, "CURRENT_CONTEXT", ["CURRENT_TEAM"]);
  if (current) sentences.push(withPeriod(capitalize(current.display)));

  const summary = sentences.join(" ").trim();
  if (summary.length <= SUMMARY_MAX_CHARS) return summary;
  return `${summary.slice(0, SUMMARY_MAX_CHARS - 1).trimEnd()}…`;
}

const FACT_LIMITS: Partial<Record<BiographyEvidenceCategory, number>> = {
  ORIGIN: 2,
  KARTING: 1,
  JUNIOR_CAREER: 2,
  F1_ENTRY: 1,
  TEAM_HISTORY: 2,
  F1_ACHIEVEMENTS: 3,
  PUBLIC_PERSONALITY: 1,
  INTERESTS: 1,
  PROJECTS: 1,
  CURRENT_CONTEXT: 1,
};

function buildFacts(claims: readonly BiographyClaim[]): PublicProfileFact[] {
  const facts: PublicProfileFact[] = [];
  for (const category of BIOGRAPHY_EVIDENCE_CATEGORIES) {
    if (category === "IDENTITY") continue;
    const limit = FACT_LIMITS[category] ?? 1;
    const inCategory = claims.filter((claim) => claim.category === category);
    if (inCategory.length === 0) continue;
    const selected = inCategory.slice(0, limit);
    for (const claim of selected) {
      const source: BiographyClaimSourceRef | null = claim.sourceRef;
      facts.push({
        category,
        label: PUBLIC_PROFILE_CATEGORY_LABELS[category],
        display: withPeriod(claim.display),
        year: claim.year,
        authority: claim.authority,
        sourceTitle: source?.title ?? null,
        sourceUrl: source?.url ?? null,
      });
    }
  }
  return facts;
}

function buildSources(claims: readonly BiographyClaim[]): PublicProfileSource[] {
  const byUrl = new Map<string, PublicProfileSource>();
  for (const claim of claims) {
    const source = claim.sourceRef;
    if (!source) continue;
    if (byUrl.has(source.url)) continue;
    byUrl.set(source.url, {
      provider: source.provider,
      title: source.title,
      url: source.url,
    });
  }
  return [...byUrl.values()].sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
}

export async function getPublicProfileView(characterId: string): Promise<PublicProfileView> {
  const evidence = await loadBiographyEvidenceForCharacter(characterId);
  if (!evidence) return EMPTY_PROFILE;
  const claims = evidence.claimSet.claims.filter((claim) => claim.status === "APPROVED");
  if (claims.length === 0) return EMPTY_PROFILE;

  const coverage = evaluateBiographyCoverage(evidence.claimSet);
  const curatedClaims = claims.filter((claim) => claim.sourceRef !== null);
  const curatedRelevantAreas = new Set(
    curatedClaims
      .map((claim) => claim.category)
      .filter((category) => !RELEVANT_EXCLUDED.includes(category)),
  ).size;

  const status: PublicProfileStatus =
    coverage.rich || curatedRelevantAreas >= 3 ? "AVAILABLE" : "PARTIAL";

  return {
    status,
    summary: buildSummary(claims),
    facts: buildFacts(curatedClaims.length > 0 ? curatedClaims : claims),
    sources: buildSources(claims),
    evidenceVersion: evidence.claimSet.evidenceVersion,
    relevantAreaCount: coverage.relevantCount,
  };
}
