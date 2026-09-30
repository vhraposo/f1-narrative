import {
  composeBiographyContext,
  type BiographyFacts,
} from "./pilot-knowledge.profile.js";
import { feminizeNationalityPtBr, resolveNationalityPtBr } from "./nationality.ptbr.js";

export const BIOGRAPHY_COMPOSER_VERSION = "biography-composer.v1";
export const BIOGRAPHY_DISPLAY_CAP = 2400;

export const BIOGRAPHY_COMPOSER_SYSTEM_PROMPT = [
  "Você é um editor biográfico especializado em Fórmula 1.",
  "Produza uma biografia em português brasileiro.",
  "Use exclusivamente os fatos fornecidos no evidence bundle.",
  "A biografia deve ter aproximadamente 5 a 8 parágrafos curtos.",
  "Inclua, quando houver evidência: nascimento, cidade/país, início no kart, caminho pelas categorias, entrada na F1, equipe(s), principais conquistas, personalidade pública observável, hobbies/interesses publicamente documentados, projetos fora das pistas e fatos relevantes para compreender o piloto.",
  "Não invente características psicológicas. Não faça diagnóstico. Não especule.",
  "Não diga que alguém é 'arrogante', 'tímido' ou 'gentil' sem evidência pública.",
  "Quando descrever personalidade, use linguagem como 'Em entrevistas e aparições públicas, costuma ser descrito como...' ou 'O próprio piloto se descreveu como...' quando houver fonte.",
  "Não copie frases longas de fontes. Produza texto original.",
  "Toda afirmação factual importante deve estar presente no evidence bundle.",
  "Se uma informação não estiver presente, não invente.",
  "Não invente relacionamentos, hobbies, gostos ou citações.",
  "Não inclua URLs, markdown, listas ou títulos; apenas parágrafos de prosa.",
].join("\n");

export type BiographyClaim = {
  readonly label: string;
  readonly value: string;
};

export type BiographyComposeInput = {
  readonly subject: string;
  readonly claims: readonly BiographyClaim[];
};

export type BiographyComposer = (
  input: BiographyComposeInput,
) => Promise<string | null>;

export function buildBiographyComposerUserPrompt(input: BiographyComposeInput): string {
  const lines = [
    `Evidence bundle (única fonte permitida) para ${input.subject}:`,
    ...input.claims.map((claim) => `- ${claim.label}: ${claim.value}`),
    "",
    "Escreva a biografia agora, apenas com esses fatos.",
  ];
  return lines.join("\n");
}

export function sanitizeComposedBiography(raw: string): string | null {
  let text = raw.trim();
  if (text.length === 0) return null;
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/https?:\/\/\S+/g, " ");
  text = text.replace(/^#{1,6}\s*/gm, "");
  text = text.replace(/[*_`]/g, "");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();
  if (text.length < 80) return null;
  if (text.includes("<") || text.toLowerCase().includes("<script")) return null;
  if (text.length > BIOGRAPHY_DISPLAY_CAP) {
    const slice = text.slice(0, BIOGRAPHY_DISPLAY_CAP);
    const lastBreak = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf(". "));
    text = `${(lastBreak > BIOGRAPHY_DISPLAY_CAP * 0.5 ? slice.slice(0, lastBreak) : slice).trimEnd()}`;
  }
  return text;
}

export function createLlmBiographyComposer(provider: {
  readonly name: string;
  run: (input: {
    context: never;
    systemPrompt: string;
    userPrompt?: string;
  }) => Promise<{ mode: string; text?: string }>;
}): BiographyComposer {
  return async (input) => {
    const output = await provider.run({
      context: {} as never,
      systemPrompt: BIOGRAPHY_COMPOSER_SYSTEM_PROMPT,
      userPrompt: buildBiographyComposerUserPrompt(input),
    });
    if (output.mode !== "generated" || typeof output.text !== "string") return null;
    return sanitizeComposedBiography(output.text);
  };
}

export function biographyClaimsFromFacts(facts: BiographyFacts): BiographyClaim[] {
  const claims: BiographyClaim[] = [];
  const fullName = (facts.fullName ?? facts.publicName ?? "").trim();
  if (fullName.length > 0) claims.push({ label: "Nome completo", value: fullName });
  if (facts.publicName && facts.publicName !== fullName) {
    claims.push({ label: "Nome público", value: facts.publicName });
  }
  if (facts.dateOfBirth) {
    claims.push({
      label: "Data de nascimento",
      value: facts.dateOfBirth.toISOString().slice(0, 10),
    });
  }
  if (facts.placeOfBirth) {
    claims.push({ label: "Local de nascimento", value: facts.placeOfBirth });
  }
  const nationality = facts.nationality ? resolveNationalityPtBr(facts.nationality) : null;
  if (nationality) {
    claims.push({
      label: "Nacionalidade",
      value: feminizeNationalityPtBr(nationality).toLowerCase(),
    });
  }
  if (facts.debutYear !== null && facts.debutYear !== undefined) {
    claims.push({
      label: "Primeiro registro na F1",
      value: String(facts.debutYear),
    });
  }
  if (facts.teams && facts.teams.length > 0) {
    claims.push({ label: "Equipes na F1", value: facts.teams.join(", ") });
  }
  if (facts.championships && facts.championships.length > 0) {
    claims.push({
      label: "Títulos mundiais (anos finais)",
      value: facts.championships.join(", "),
    });
  }
  if (facts.career) {
    claims.push({
      label: "Estatísticas de carreira na F1",
      value: `${facts.career.starts} largadas, ${facts.career.wins} vitórias, ${facts.career.podiums} pódios, ${facts.career.poles} poles, ${facts.career.fastestLaps} voltas mais rápidas, ${facts.career.titles} títulos`,
    });
  }
  if (facts.milestoneTitles && facts.milestoneTitles.length > 0) {
    claims.push({
      label: "Marcos registrados",
      value: facts.milestoneTitles.join("; "),
    });
  }
  if (facts.interests && facts.interests.length > 0) {
    claims.push({ label: "Interesses públicos", value: facts.interests.join(", ") });
  }
  return claims;
}

export function deterministicBiographyContext(facts: BiographyFacts): string | null {
  return composeBiographyContext(facts);
}
