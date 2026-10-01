import type { GenerationProvider } from "../generation/generation.assembly.js";
import { BIOGRAPHY_LANGUAGE, type ApprovedClaimSet } from "./biography.claims.js";

export const BIOGRAPHY_VERIFIER_VERSION = "biography-verifier.v1";

export const BIOGRAPHY_VERIFIER_SYSTEM_PROMPT = [
  "Você verifica se uma biografia em português foi escrita SOMENTE com os claims fornecidos.",
  "Você não pode usar conhecimento externo.",
  "Liste qualquer afirmação que não possa ser sustentada pelos claims.",
  "Liste qualquer divergência de data, ano, equipe, categoria, nome ou resultado em relação aos claims.",
  "Responda APENAS com JSON válido no formato exato:",
  '{"approved":true,"issues":[],"unsupportedStatements":[],"claimMismatches":[]}',
  "approved deve ser false se existir QUALQUER afirmação não sustentada ou divergência.",
].join("\n");

export type BiographyVerification = {
  readonly approved: boolean;
  readonly issues: readonly string[];
  readonly unsupportedStatements: readonly string[];
  readonly claimMismatches: readonly string[];
};

export type BiographyVerifier = (input: {
  readonly text: string;
  readonly claimSet: ApprovedClaimSet;
}) => Promise<BiographyVerification | null>;

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    out.push(item);
  }
  return out;
}

export function parseVerifierOutput(raw: string): BiographyVerification | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.approved !== "boolean") return null;
  const issues = stringArray(record.issues ?? []);
  const unsupportedStatements = stringArray(record.unsupportedStatements ?? []);
  const claimMismatches = stringArray(record.claimMismatches ?? []);
  if (!issues || !unsupportedStatements || !claimMismatches) return null;
  return { approved: record.approved, issues, unsupportedStatements, claimMismatches };
}

export function buildVerifierUserPrompt(input: {
  readonly text: string;
  readonly claimSet: ApprovedClaimSet;
}): string {
  const lines = [
    `Idioma esperado: ${BIOGRAPHY_LANGUAGE}.`,
    `Piloto: ${input.claimSet.subjectName}.`,
    "Claims aprovados (única base factual permitida):",
    ...input.claimSet.claims.map((claim) => `${claim.id} [${claim.key}] ${claim.display}`),
    "",
    "Biografia candidata:",
    input.text,
    "",
    "Responda no formato JSON exigido.",
  ];
  return lines.join("\n");
}

export function createLlmBiographyVerifier(provider: GenerationProvider): BiographyVerifier {
  return async ({ text, claimSet }) => {
    const output = await provider.run({
      context: {} as never,
      systemPrompt: BIOGRAPHY_VERIFIER_SYSTEM_PROMPT,
      userPrompt: buildVerifierUserPrompt({ text, claimSet }),
    });
    if (output.mode !== "generated" || typeof output.text !== "string") return null;
    return parseVerifierOutput(output.text);
  };
}
