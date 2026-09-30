import { z } from "zod";
import { PERSONA_EVIDENCE_TYPES, PERSONA_TRAIT_KEYS } from "./persona.rules.js";

export const personaCharacterParamsSchema = z.object({
  characterId: z.string().uuid("Identificador de personagem inválido"),
});

export const personaTraitParamsSchema = z.object({
  characterId: z.string().uuid("Identificador de personagem inválido"),
  traitKey: z.enum(PERSONA_TRAIT_KEYS),
});

export const personaEvidenceParamsSchema = z.object({
  evidenceId: z.string().uuid("Identificador de evidência inválido"),
});

const personaTraitUpdateSchema = z
  .object({
    key: z.enum(PERSONA_TRAIT_KEYS),
    value: z
      .string()
      .trim()
      .min(1, "Informe o valor do trait")
      .max(200, "Valor do trait muito longo (máx. 200 caracteres)"),
  })
  .strict();

export const updatePersonaBodySchema = z
  .object({
    summary: z
      .string()
      .max(2000, "Summary muito longo (máx. 2000 caracteres)")
      .nullable()
      .optional(),
    traits: z
      .array(personaTraitUpdateSchema)
      .refine(
        (traits) =>
          new Set(traits.map((trait) => trait.key)).size === traits.length,
        { message: "Trait duplicado no payload" },
      )
      .optional(),
  })
  .strict();

export const createPersonaEvidenceBodySchema = z
  .object({
    traitKey: z.enum(PERSONA_TRAIT_KEYS),
    proposedValue: z
      .string()
      .trim()
      .min(1, "Informe o valor proposto")
      .max(200, "Valor proposto muito longo (máx. 200 caracteres)"),
    sourceType: z.enum(PERSONA_EVIDENCE_TYPES),
    title: z
      .string()
      .trim()
      .min(1, "Informe o título")
      .max(200, "Título muito longo (máx. 200 caracteres)"),
    url: z
      .string()
      .url("URL inválida")
      .max(2048, "URL muito longa (máx. 2048 caracteres)")
      .nullable()
      .optional(),
    publishedAt: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), {
        message: "Data de publicação inválida",
      })
      .nullable()
      .optional(),
    excerpt: z
      .string()
      .trim()
      .min(1, "Informe o trecho")
      .max(500, "Trecho muito longo (máx. 500 caracteres)"),
    confidence: z
      .number()
      .min(0, "Confiança deve estar entre 0 e 1")
      .max(1, "Confiança deve estar entre 0 e 1"),
  })
  .strict();

export const reviewPersonaEvidenceBodySchema = z
  .object({
    status: z.enum(["APPROVED", "REJECTED"]),
    confidence: z
      .number()
      .min(0, "Confiança deve estar entre 0 e 1")
      .max(1, "Confiança deve estar entre 0 e 1")
      .optional(),
  })
  .strict();
