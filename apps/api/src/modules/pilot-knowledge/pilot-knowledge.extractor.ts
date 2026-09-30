import type { ExternalPublicEvidenceType, ExternalPublicTraitSource } from "@prisma/client";
import { z } from "zod";

import type { GenerationProvider } from "../generation/generation.assembly.js";

export type ExtractionClaim = {
  readonly traitKey: string;
  readonly proposedValue: string;
  readonly sourceKind: ExternalPublicTraitSource;
  readonly evidenceType: ExternalPublicEvidenceType;
  readonly confidence: number | null;
  readonly summary: string;
};

export type ExtractionStatus = "SUPPORTED" | "UNSUPPORTED" | "UNCERTAIN";

export type ExtractionResult = {
  readonly status: ExtractionStatus;
  readonly claims: readonly ExtractionClaim[];
};

export type ExtractionInput = {
  readonly driverName: string;
  readonly sourceTitle: string;
  readonly sourceText: string;
  readonly evidenceType: ExternalPublicEvidenceType;
};

export interface PilotPersonaExtractor {
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}

export const EXTRACTION_SYSTEM_PROMPT = [
  "Você está extraindo claims públicos suportados de uma fonte sobre um piloto de Fórmula 1.",
  "Responda somente com JSON válido no formato {\"status\":\"SUPPORTED|UNSUPPORTED|UNCERTAIN\",\"claims\":[{\"traitKey\":\"...\",\"proposedValue\":\"...\",\"sourceKind\":\"DIRECT_SELF_DESCRIPTION|OBSERVED_PUBLIC_BEHAVIOR|INFERRED\",\"evidenceType\":\"...\",\"confidence\":0..1|null,\"summary\":\"síntese curta e original\"}]}.",
  "Extraia apenas o que a fonte suporta explicitamente; não invente; não infira doença, estado mental, diagnóstico, fitness ou motivos privados.",
  "Use apenas traits públicos suportados (comunicação, comportamento observável, interesses, motivações declaradas, fala).",
  "O resumo deve ser uma síntese original curta, nunca uma cópia de frases da fonte.",
  "Sem suporte suficiente, retorne status UNSUPPORTED e lista vazia.",
].join("\n");

const claimSchema = z
  .object({
    traitKey: z.string().min(1).max(64),
    proposedValue: z.string().min(1).max(400),
    sourceKind: z.enum(["DIRECT_SELF_DESCRIPTION", "OBSERVED_PUBLIC_BEHAVIOR", "INFERRED"]),
    evidenceType: z.enum([
      "SELF_DESCRIPTION",
      "OFFICIAL_INTERVIEW",
      "FIA_TRANSCRIPT",
      "TEAM_PROFILE",
      "F1_PROFILE",
      "DRIVER_OFFICIAL",
      "REPUTABLE_NEWS",
      "STRUCTURED_DATA",
    ]),
    confidence: z.number().min(0).max(1).nullable().optional(),
    summary: z.string().min(1).max(500),
  })
  .strict();

const extractionSchema = z
  .object({
    status: z.enum(["SUPPORTED", "UNSUPPORTED", "UNCERTAIN"]),
    claims: z.array(claimSchema).max(20),
  })
  .strict();

export function parseExtractionResponse(text: string): ExtractionResult {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Extração inválida: JSON não encontrado");
  }
  const parsed = extractionSchema.parse(JSON.parse(text.slice(start, end + 1)));
  return {
    status: parsed.status,
    claims: parsed.claims.map((claim) => ({
      traitKey: claim.traitKey,
      proposedValue: claim.proposedValue,
      sourceKind: claim.sourceKind,
      evidenceType: claim.evidenceType,
      confidence: claim.confidence ?? null,
      summary: claim.summary,
    })),
  };
}

export function createProviderPilotPersonaExtractor(
  provider: GenerationProvider,
): PilotPersonaExtractor {
  return {
    async extract(input: ExtractionInput): Promise<ExtractionResult> {
      const result = await provider.run({
        context: {} as never,
        systemPrompt: EXTRACTION_SYSTEM_PROMPT,
        userPrompt: [
          `Piloto: ${input.driverName}`,
          `Fonte: ${input.sourceTitle}`,
          `Tipo de evidência: ${input.evidenceType}`,
          "Trecho/transcrição estruturada para extração:",
          input.sourceText,
        ].join("\n"),
      });
      if (result.mode !== "generated" || typeof result.text !== "string") {
        throw new Error("Extração indisponível: provider não gerou texto");
      }
      return parseExtractionResponse(result.text);
    },
  };
}

export const emptyPilotPersonaExtractor: PilotPersonaExtractor = {
  async extract(): Promise<ExtractionResult> {
    return { status: "UNSUPPORTED", claims: [] };
  },
};
