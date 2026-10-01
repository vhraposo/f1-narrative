import type { GenerationProvider } from "../generation/generation.assembly.js";
import type { ApprovedClaimSet, BiographyClaim } from "./biography.claims.js";
import { planBiographyClaimIds } from "./biography.claims.js";
import { composeBiographyContext, type BiographyFacts } from "./pilot-knowledge.profile.js";

export const BIOGRAPHY_COMPOSER_VERSION = "biography-composer.v2";
export const BIOGRAPHY_DISPLAY_CAP = 2400;

export const BIOGRAPHY_COMPOSER_SYSTEM_PROMPT = [
  "Você é um editor biográfico especializado em Fórmula 1.",
  "Use somente os claims fornecidos no evidence bundle.",
  "Não use conhecimento externo. Não invente fatos.",
  "Não corrija fatos silenciosamente. Não altere datas, nomes, equipes, resultados ou categorias.",
  "Não transforme inferências em fatos. Não adicione personalidade ou hobbies sem claim.",
  "Se informação suficiente não existir, omita.",
  "Escreva em português brasileiro natural, sem misturar inglês, exceto nomes oficiais necessários.",
  "Não traduza nomes próprios.",
  "Não produza comentários sobre fontes, markdown, URLs, placeholders ou JSON dentro de strings.",
  "Responda APENAS com JSON válido no formato exato:",
  '{"language":"pt-BR","sentences":[{"text":"frase em pt-BR","claimIds":["CLAIM-001"]}]}',
  "Cada frase deve citar apenas claimIds existentes no evidence bundle.",
  "Produza entre 3 e 8 frases, em ordem cronológica.",
].join("\n");

export type ComposerSentence = {
  readonly text: string;
  readonly claimIds: readonly string[];
};

export type ComposerOutput = {
  readonly language: "pt-BR";
  readonly sentences: readonly ComposerSentence[];
};

function claimsForPrompt(set: ApprovedClaimSet, ids: readonly string[]): BiographyClaim[] {
  const byId = new Map(set.claims.map((claim) => [claim.id, claim]));
  return ids
    .map((id) => byId.get(id))
    .filter((claim): claim is BiographyClaim => claim !== undefined);
}

export function buildBiographyComposerUserPrompt(
  set: ApprovedClaimSet,
  plannedIds: readonly string[] = planBiographyClaimIds(set),
): string {
  const lines = [
    `Evidence bundle (única fonte permitida) para ${set.subjectName}:`,
    ...claimsForPrompt(set, plannedIds).map(
      (claim) => `${claim.id} [${claim.key}] ${claim.display}`,
    ),
    "",
    "Escreva a biografia agora, apenas com esses claims, no formato JSON exigido.",
  ];
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
  if (!Array.isArray(record.sentences)) return null;
  if (record.sentences.length < 2 || record.sentences.length > 12) return null;
  const sentences: ComposerSentence[] = [];
  for (const item of record.sentences) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const sentence = item as Record<string, unknown>;
    if (typeof sentence.text !== "string") return null;
    const trimmed = sentence.text.trim();
    if (trimmed.length < 10 || trimmed.length > 600) return null;
    if (!Array.isArray(sentence.claimIds) || sentence.claimIds.length === 0) return null;
    const ids: string[] = [];
    for (const id of sentence.claimIds) {
      if (typeof id !== "string" || !knownClaimIds.has(id)) return null;
      ids.push(id);
    }
    sentences.push({ text: trimmed, claimIds: ids });
  }
  return { language: "pt-BR", sentences };
}

export function composerOutputToText(output: ComposerOutput): string {
  return output.sentences.map((sentence) => sentence.text).join(" ");
}

export type BiographyComposer = (input: {
  readonly claimSet: ApprovedClaimSet;
}) => Promise<string | null>;

export function createLlmBiographyComposer(provider: GenerationProvider): BiographyComposer {
  return async ({ claimSet }) => {
    const plannedIds = planBiographyClaimIds(claimSet);
    const output = await provider.run({
      context: {} as never,
      systemPrompt: BIOGRAPHY_COMPOSER_SYSTEM_PROMPT,
      userPrompt: buildBiographyComposerUserPrompt(claimSet, plannedIds),
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
