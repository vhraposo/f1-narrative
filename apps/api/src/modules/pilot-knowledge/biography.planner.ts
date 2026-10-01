import type {
  ApprovedClaimSet,
  BiographyClaim,
  BiographyEvidenceCategory,
} from "./biography.claims.js";

export type BiographyParagraphPlan = {
  readonly id: string;
  readonly topic: string;
  readonly categories: readonly BiographyEvidenceCategory[];
  readonly claimIds: readonly string[];
};

const PARAGRAPH_SPECS: readonly {
  id: string;
  topic: string;
  categories: readonly BiographyEvidenceCategory[];
}[] = [
  { id: "identity_origins", topic: "identidade e origens", categories: ["IDENTITY", "ORIGIN"] },
  { id: "karting", topic: "início no kart", categories: ["KARTING"] },
  { id: "junior_career", topic: "categorias de base", categories: ["JUNIOR_CAREER"] },
  {
    id: "f1_entry_teams",
    topic: "entrada na F1 e trajetória de equipes",
    categories: ["F1_ENTRY", "TEAM_HISTORY"],
  },
  { id: "achievements", topic: "conquistas na F1", categories: ["F1_ACHIEVEMENTS"] },
  { id: "personality", topic: "personalidade pública", categories: ["PUBLIC_PERSONALITY"] },
  { id: "interests", topic: "interesses e hobbies", categories: ["INTERESTS"] },
  {
    id: "projects_context",
    topic: "projetos fora das pistas e contexto atual",
    categories: ["PROJECTS", "CURRENT_CONTEXT"],
  },
];

export function planBiographyParagraphs(set: ApprovedClaimSet): readonly BiographyParagraphPlan[] {
  const used = new Set<string>();
  const plans: BiographyParagraphPlan[] = [];
  for (const spec of PARAGRAPH_SPECS) {
    const claimIds: string[] = [];
    for (const claim of set.claims) {
      if (!spec.categories.includes(claim.category)) continue;
      if (used.has(claim.id)) continue;
      used.add(claim.id);
      claimIds.push(claim.id);
    }
    if (claimIds.length === 0) continue;
    plans.push({ id: spec.id, topic: spec.topic, categories: spec.categories, claimIds });
  }
  return plans;
}

export function claimsByIds(
  set: ApprovedClaimSet,
  ids: readonly string[],
): BiographyClaim[] {
  const byId = new Map(set.claims.map((claim) => [claim.id, claim]));
  return ids
    .map((id) => byId.get(id))
    .filter((claim): claim is BiographyClaim => claim !== undefined);
}
