import {
  BIOGRAPHY_COMPOSER_VERSION,
  type BiographyComposer,
} from "./biography.composer.js";
import type { ApprovedClaimSet } from "./biography.claims.js";
import { evaluateBiographyCoverage, type BiographyCoverage } from "./biography.coverage.js";
import { renderRichDeterministicBiography } from "./biography.fallback.js";
import { validateBiographyText } from "./biography.quality.js";
import type { BiographyVerifier } from "./biography.verifier.js";
import {
  composeBiographyDisplay,
  type BiographyFacts,
} from "./pilot-knowledge.profile.js";

export type BiographyPipelineMode = "LLM_APPROVED" | "RICH_DETERMINISTIC" | "FALLBACK";

export type BiographyPipelineResult = {
  readonly display: string;
  readonly mode: BiographyPipelineMode;
  readonly fallbackReason: string | null;
  readonly fingerprint: string;
  readonly claimsCount: number;
  readonly generatorVersion: string;
  readonly evidenceVersion: string | null;
  readonly coverage: BiographyCoverage;
};

function minimalFromClaims(set: ApprovedClaimSet): string | null {
  const parts: string[] = [];
  const name = set.subjectName;
  const birth = set.claims.find((claim) => claim.key === "BIRTH_DATE");
  const place = set.claims.find((claim) => claim.key === "BIRTH_PLACE");
  const nationality = set.claims.find((claim) => claim.key === "NATIONALITY");
  if (birth) {
    parts.push(
      place
        ? `${name} nasceu em ${birth.display}, em ${place.display}.`
        : `${name} nasceu em ${birth.display}.`,
    );
  } else if (nationality) {
    parts.push(`${name} tem nacionalidade ${nationality.display}.`);
  }
  const debut = set.claims.find((claim) => claim.key === "F1_DEBUT");
  if (debut) parts.push(`Tem registros na Fórmula 1 desde ${debut.display}.`);
  const title = set.claims.find((claim) => claim.key === "CHAMPIONSHIP");
  if (title) parts.push(`Conquistou o campeonato mundial em ${title.display}.`);
  if (parts.length === 0) return null;
  return parts.join(" ");
}

function countParagraphs(text: string): number {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0).length;
}

export async function composeBiographyFromClaims(input: {
  readonly claimSet: ApprovedClaimSet;
  readonly facts: BiographyFacts;
  readonly composer?: BiographyComposer;
  readonly verifier?: BiographyVerifier;
}): Promise<BiographyPipelineResult> {
  const coverage = evaluateBiographyCoverage(input.claimSet);
  const base = {
    fingerprint: input.claimSet.fingerprint,
    claimsCount: input.claimSet.claims.length,
    generatorVersion: BIOGRAPHY_COMPOSER_VERSION,
    evidenceVersion: input.claimSet.evidenceVersion,
    coverage,
  };

  const richDisplay = coverage.rich
    ? renderRichDeterministicBiography(input.claimSet)
    : null;
  const deterministic =
    richDisplay ?? composeBiographyDisplay(input.facts) ?? minimalFromClaims(input.claimSet);

  if (input.claimSet.identityStatus !== "RESOLVED") {
    return {
      ...base,
      display: deterministic ?? "",
      mode: "FALLBACK",
      fallbackReason: "ambiguous-identity",
    };
  }

  if (!input.composer) {
    if (richDisplay) {
      return {
        ...base,
        display: richDisplay,
        mode: "RICH_DETERMINISTIC",
        fallbackReason: "rich-deterministic",
      };
    }
    return {
      ...base,
      display: deterministic ?? "",
      mode: "FALLBACK",
      fallbackReason: "composer-unavailable",
    };
  }

  let candidate: string | null | undefined;
  try {
    candidate = await input.composer({ claimSet: input.claimSet });
  } catch {
    candidate = undefined;
  }
  if (candidate === undefined) {
    return {
      ...base,
      display: deterministic ?? "",
      mode: richDisplay ? "RICH_DETERMINISTIC" : "FALLBACK",
      fallbackReason: "composer-error",
    };
  }
  if (!candidate) {
    return {
      ...base,
      display: deterministic ?? "",
      mode: richDisplay ? "RICH_DETERMINISTIC" : "FALLBACK",
      fallbackReason: "composer-parse-failed",
    };
  }

  const quality = validateBiographyText({ text: candidate, claims: input.claimSet });
  const issues = [...quality.issues];
  if (quality.ok && coverage.rich && countParagraphs(candidate) < 3) {
    issues.push("too-few-paragraphs");
  }
  if (issues.length > 0) {
    return {
      ...base,
      display: deterministic ?? "",
      mode: richDisplay ? "RICH_DETERMINISTIC" : "FALLBACK",
      fallbackReason: `quality:${issues[0] ?? "unknown"}`,
    };
  }

  if (input.verifier) {
    let verification: Awaited<ReturnType<BiographyVerifier>>;
    try {
      verification = await input.verifier({ text: candidate, claimSet: input.claimSet });
    } catch {
      verification = null;
    }
    if (verification && !verification.approved) {
      return {
        ...base,
        display: deterministic ?? "",
        mode: richDisplay ? "RICH_DETERMINISTIC" : "FALLBACK",
        fallbackReason: `semantic:${verification.issues[0] ?? verification.unsupportedStatements[0] ?? "rejected"}`,
      };
    }
  }

  return { ...base, display: candidate, mode: "LLM_APPROVED", fallbackReason: null };
}
