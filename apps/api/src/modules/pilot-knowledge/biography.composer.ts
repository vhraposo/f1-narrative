import type { GenerationProvider } from "../generation/generation.assembly.js";
import type { ApprovedClaimSet } from "./biography.claims.js";
import { claimsByIds, planBiographyParagraphs } from "./biography.planner.js";
import { composeBiographyContext, type BiographyFacts } from "./pilot-knowledge.profile.js";

export const BIOGRAPHY_COMPOSER_VERSION = "biography-composer.v3";
export const BIOGRAPHY_DISPLAY_CAP = 3200;

export const BIOGRAPHY_COMPOSER_SYSTEM_PROMPT = [
  "Você é um editor biográfico especializado em Fórmula 1.",
  "Produza uma biografia em português brasileiro natural, como uma narrativa biográfica contínua — nunca uma ficha estatística.",
  "Use exclusivamente os fatos fornecidos no evidence bundle.",
  "Não use conhecimento externo. Não invente informações. Não preencha lacunas.",
  "Não altere datas, nomes, equipes, resultados, categorias ou anos.",
  "Aproveite a evidência de diferentes etapas da vida e da carreira: origens, kart, categorias de base, entrada na F1, equipes, conquistas, personalidade pública, interesses e projetos.",
  "Quando houver evidência de kart e categorias de base, contextualize a progressão até a F1.",
  "Quando houver hobbies, interesses ou projetos, inclua-os naturalmente, sem exagerar.",
  "Quando descrever personalidade, atribua corretamente: use expressões como 'em entrevista, descreveu-se como', 'o perfil oficial da equipe o descreve como' ou 'em aparições públicas, demonstrou'.",
  "Nunca transforme uma descrição de fonte em verdade psicológica universal.",
  "Não repita informações já apresentadas e não invente transições de carreira.",
  "Escreva em português brasileiro; não misture inglês, exceto nomes oficiais.",
  "Não produza títulos, bullets, markdown, URLs, comentários sobre fontes ou JSON dentro de strings.",
  "Responda APENAS com JSON válido no formato exato:",
  '{"language":"pt-BR","paragraphs":[{"sentences":[{"text":"frase em pt-BR","claimIds":["CLAIM-001"]}]}]}',
  "Organize os parágrafos na ordem temática indicada no prompt do usuário, omitindo temas sem claims.",
].join("\n");

export type ComposerSentence = {
  readonly text: string;
  readonly claimIds: readonly string[];
};

export type ComposerParagraph = {
  readonly sentences: readonly ComposerSentence[];
};

export type ComposerOutput = {
  readonly language: "pt-BR";
  readonly paragraphs: readonly ComposerParagraph[];
};

export function buildBiographyComposerUserPrompt(set: ApprovedClaimSet): string {
  const plans = planBiographyParagraphs(set);
  const lines: string[] = [
    `Evidence bundle (única fonte permitida) para ${set.subjectName}.`,
    "Parágrafos planejados (use apenas os claims de cada bloco; omita blocos vazios):",
  ];
  for (const [index, plan] of plans.entries()) {
    lines.push(`PARÁGRAFO ${index + 1} — ${plan.topic}:`);
    for (const claim of claimsByIds(set, plan.claimIds)) {
      lines.push(`  ${claim.id} [${claim.category}] ${claim.display}`);
    }
  }
  lines.push("Escreva a biografia agora, no formato JSON exigido.");
  return lines.join("\n");
}

function stripCodeFences(raw: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (fenced?.[1]) return fenced[1].trim();
  return raw.trim();
}

export function parseComposerOutput(
  raw: string,
  knownClaimIds: ReadonlySet<string>,
): ComposerOutput | null {
  const text = stripCodeFences(raw);
  if (text.length === 0) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (record.language !== "pt-BR") return null;
  if (!Array.isArray(record.paragraphs)) return null;
  if (record.paragraphs.length < 1 || record.paragraphs.length > 8) return null;
  const paragraphs: ComposerParagraph[] = [];
  let totalSentences = 0;
  for (const item of record.paragraphs) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const paragraph = item as Record<string, unknown>;
    if (!Array.isArray(paragraph.sentences)) return null;
    if (paragraph.sentences.length < 1 || paragraph.sentences.length > 4) return null;
    const sentences: ComposerSentence[] = [];
    for (const sentence of paragraph.sentences) {
      if (typeof sentence !== "object" || sentence === null || Array.isArray(sentence)) {
        return null;
      }
      const entry = sentence as Record<string, unknown>;
      if (typeof entry.text !== "string") return null;
      const trimmed = entry.text.trim();
      if (trimmed.length < 10 || trimmed.length > 600) return null;
      if (!Array.isArray(entry.claimIds) || entry.claimIds.length === 0) return null;
      const ids: string[] = [];
      for (const id of entry.claimIds) {
        if (typeof id !== "string" || !knownClaimIds.has(id)) return null;
        ids.push(id);
      }
      sentences.push({ text: trimmed, claimIds: ids });
      totalSentences += 1;
    }
    paragraphs.push({ sentences });
  }
  if (totalSentences < 2 || totalSentences > 28) return null;
  return { language: "pt-BR", paragraphs };
}

export function composerOutputToText(output: ComposerOutput): string {
  return output.paragraphs
    .map((paragraph) => paragraph.sentences.map((sentence) => sentence.text).join(" "))
    .join("\n\n");
}

export type BiographyComposer = (input: {
  readonly claimSet: ApprovedClaimSet;
}) => Promise<string | null>;

export function createLlmBiographyComposer(provider: GenerationProvider): BiographyComposer {
  return async ({ claimSet }) => {
    const output = await provider.run({
      context: {} as never,
      systemPrompt: BIOGRAPHY_COMPOSER_SYSTEM_PROMPT,
      userPrompt: buildBiographyComposerUserPrompt(claimSet),
    });
    if (output.mode !== "generated" || typeof output.text !== "string") return null;
    const parsed = parseComposerOutput(
      output.text,
      new Set(claimSet.claims.map((claim) => claim.id)),
    );
    if (!parsed) return null;
    return composerOutputToText(parsed);
  };
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
  return text.length > BIOGRAPHY_DISPLAY_CAP ? text.slice(0, BIOGRAPHY_DISPLAY_CAP) : text;
}

export function deterministicBiographyContext(facts: BiographyFacts): string | null {
  return composeBiographyContext(facts);
}
