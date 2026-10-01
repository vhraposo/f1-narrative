import type { ApprovedClaimSet, BiographyClaim } from "./biography.claims.js";
import { claimsByIds, planBiographyParagraphs } from "./biography.planner.js";

function sentence(text: string): string {
  const trimmed = text.trim().replace(/[.;]+$/u, "");
  const capitalized = trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : trimmed;
  return `${capitalized}.`;
}

function joinDisplays(claims: readonly BiographyClaim[]): string {
  return claims.map((claim) => claim.display.replace(/[.;]+$/u, "")).join("; ");
}

function claimByKey(claims: readonly BiographyClaim[], key: string): BiographyClaim | null {
  return claims.find((claim) => claim.key === key) ?? null;
}

function identityParagraph(
  set: ApprovedClaimSet,
  claims: readonly BiographyClaim[],
): string | null {
  const birthDate = claimByKey(claims, "BIRTH_DATE");
  const birthPlace = claimByKey(claims, "BIRTH_PLACE");
  const country = claimByKey(claims, "COUNTRY");
  const name = set.subjectName;
  const parts: string[] = [];
  if (birthDate && birthPlace) {
    parts.push(
      sentence(
        `${name} nasceu em ${birthPlace.display}${country ? `, ${country.display}` : ""}, em ${birthDate.display}`,
      ),
    );
  } else if (birthDate) {
    parts.push(sentence(`${name} nasceu em ${birthDate.display}`));
  } else if (birthPlace) {
    parts.push(sentence(`${name} nasceu em ${birthPlace.display}`));
  }
  const originClaims = claims.filter(
    (claim) => claim.category === "ORIGIN" || claim.key === "RAISED_IN",
  );
  if (originClaims.length > 0) {
    parts.push(sentence(`Desde cedo, ${joinDisplays(originClaims)}`));
  }
  const identityExtra = claims.filter(
    (claim) =>
      claim.category === "IDENTITY" &&
      !["BIRTH_DATE", "BIRTH_PLACE", "COUNTRY", "FULL_NAME", "NATIONALITY", "PUBLIC_NAME"].includes(
        claim.key,
      ),
  );
  if (identityExtra.length > 0) {
    parts.push(sentence(joinDisplays(identityExtra)));
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

export function renderRichDeterministicBiography(set: ApprovedClaimSet): string | null {
  const plans = planBiographyParagraphs(set);
  if (plans.length === 0) return null;
  const paragraphs: string[] = [];

  for (const plan of plans) {
    const claims = claimsByIds(set, plan.claimIds);
    if (claims.length === 0) continue;
    switch (plan.id) {
      case "identity_origins": {
        const paragraph = identityParagraph(set, claims);
        if (paragraph) paragraphs.push(paragraph);
        break;
      }
      case "karting":
        paragraphs.push(
          sentence(`No kart, ${joinDisplays(claims)}`),
        );
        break;
      case "junior_career":
        paragraphs.push(
          sentence(
            `Antes de chegar à Fórmula 1, construiu sua base nas categorias de monopostos: ${joinDisplays(claims)}`,
          ),
        );
        break;
      case "f1_entry_teams": {
        const entryClaims = claims.filter((claim) => claim.category === "F1_ENTRY");
        const teamClaims = claims.filter((claim) => claim.category === "TEAM_HISTORY");
        const parts: string[] = [];
        if (entryClaims.length > 0) {
          parts.push(sentence(`Na Fórmula 1, ${joinDisplays(entryClaims)}`));
        }
        if (teamClaims.length > 0) {
          parts.push(sentence(`Sua trajetória por equipes passa por ${joinDisplays(teamClaims)}`));
        }
        if (parts.length > 0) paragraphs.push(parts.join(" "));
        break;
      }
      case "achievements":
        paragraphs.push(
          sentence(`Entre os principais marcos da carreira na Fórmula 1, ${joinDisplays(claims)}`),
        );
        break;
      case "personality": {
        const parts = claims.map((claim) => sentence(claim.display));
        paragraphs.push(parts.join(" "));
        break;
      }
      case "interests":
        paragraphs.push(
          sentence(`Fora das pistas, ${joinDisplays(claims)}`),
        );
        break;
      case "projects_context": {
        const projectClaims = claims.filter((claim) => claim.category === "PROJECTS");
        const contextClaims = claims.filter((claim) => claim.category === "CURRENT_CONTEXT");
        const parts: string[] = [];
        if (projectClaims.length > 0) {
          parts.push(sentence(`Além das pistas, ${joinDisplays(projectClaims)}`));
        }
        if (contextClaims.length > 0) {
          parts.push(sentence(`No presente, ${joinDisplays(contextClaims)}`));
        }
        if (parts.length > 0) paragraphs.push(parts.join(" "));
        break;
      }
      default:
        break;
    }
  }

  if (paragraphs.length === 0) return null;
  return paragraphs.join("\n\n");
}

