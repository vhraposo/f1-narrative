import {
  BIOGRAPHY_COMPOSER_VERSION,
  type BiographyComposer,
} from "./biography.composer.js";
import type { ApprovedClaimSet } from "./biography.claims.js";
import { validateBiographyText } from "./biography.quality.js";
import type { BiographyVerifier } from "./biography.verifier.js";
import {
  composeBiographyDisplay,
  type BiographyFacts,
} from "./pilot-knowledge.profile.js";

export type BiographyPipelineMode = "LLM_APPROVED" | "FALLBACK";

export type BiographyPipelineResult = {
  readonly display: string;
  readonly mode: BiographyPipelineMode;
  readonly fallbackReason: string | null;
  readonly fingerprint: string;
  readonly claimsCount: number;
  readonly generatorVersion: string;
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

export async function composeBiographyFromClaims(input: {
  readonly claimSet: ApprovedClaimSet;
  readonly facts: BiographyFacts;
  readonly composer?: BiographyComposer;
  readonly verifier?: BiographyVerifier;
}): Promise<BiographyPipelineResult> {
  const base = {
    fingerprint: input.claimSet.fingerprint,
    claimsCount: input.claimSet.claims.length,
    generatorVersion: BIOGRAPHY_COMPOSER_VERSION,
  };

  const deterministic =
    composeBiographyDisplay(input.facts) ?? minimalFromClaims(input.claimSet);

  if (input.claimSet.identityStatus !== "RESOLVED") {
    return {
      ...base,
      display: deterministic ?? "",
      mode: "FALLBACK",
      fallbackReason: "ambiguous-identity",
    };
  }

  if (!input.composer) {
    return {
      ...base,
      display: deterministic ?? "",
      mode: "FALLBACK",
      fallbackReason: "composer-unavailable",
    };
  }

  let candidate: string | null | undefined = null;
  try {
    candidate = await input.composer({ claimSet: input.claimSet });
  } catch {
    candidate = undefined;
  }
  if (candidate === undefined) {
    return {
      ...base,
      display: deterministic ?? "",
      mode: "FALLBACK",
      fallbackReason: "composer-error",
    };
  }
  if (!candidate) {
    return {
      ...base,
      display: deterministic ?? "",
      mode: "FALLBACK",
      fallbackReason: "composer-parse-failed",
    };
  }

  const quality = validateBiographyText({ text: candidate, claims: input.claimSet });
  if (!quality.ok) {
    return {
      ...base,
      display: deterministic ?? "",
      mode: "FALLBACK",
      fallbackReason: `quality:${quality.issues[0] ?? "unknown"}`,
    };
  }

  if (input.verifier) {
    let verification: Awaited<ReturnType<BiographyVerifier>> = null;
    try {
      verification = await input.verifier({ text: candidate, claimSet: input.claimSet });
    } catch {
      verification = null;
    }
    if (verification && !verification.approved) {
      return {
        ...base,
        display: deterministic ?? "",
        mode: "FALLBACK",
        fallbackReason: `semantic:${verification.issues[0] ?? verification.unsupportedStatements[0] ?? "rejected"}`,
      };
    }
  }

  return { ...base, display: candidate, mode: "LLM_APPROVED", fallbackReason: null };
}
