import { z } from "zod";

export const RECONCILIATION_KINDS = [
  "DRIVER",
  "TEAM",
  "SEASON",
  "RACE",
  "DRIVER_SEASON",
  "RESULT",
  "STANDING",
] as const;

export type ReconciliationKind = (typeof RECONCILIATION_KINDS)[number];

export const kindSchema = z.enum(RECONCILIATION_KINDS);

export const sourceSchema = z.string().min(1).max(50);

export const sourceQuerySchema = z.object({
  source: sourceSchema.default("jolpica"),
});

export const kindParamsSchema = z.object({
  kind: kindSchema,
});

export const candidatesParamsSchema = z.object({
  kind: kindSchema,
  externalId: z.string().min(1).max(200),
});

export const candidatesQuerySchema = z.object({
  source: sourceSchema.default("jolpica"),
  seasonYear: z.coerce.number().int().min(1950).max(2100).optional(),
  round: z.coerce.number().int().min(1).max(100).optional(),
});

export const externalListQuerySchema = z.object({
  source: sourceSchema.default("jolpica"),
  seasonYear: z.coerce.number().int().min(1950).max(2100).optional(),
  teamExternalId: z.string().min(1).max(200).optional(),
});

export const bindingsListQuerySchema = z.object({
  source: sourceSchema.default("jolpica"),
  kind: kindSchema.optional(),
  confidence: z.enum(["SUGGESTED", "CONFIRMED"]).optional(),
});

export const suggestBindingSchema = z
  .object({
    kind: kindSchema,
    source: sourceSchema,
    externalId: z.string().min(1).max(200),
    seasonYear: z.coerce.number().int().min(1950).max(2100).optional(),
    round: z.coerce.number().int().min(1).max(100).optional(),
    candidateId: z.string().uuid("Identificador do candidato inválido"),
  })
  .strict();

export const confirmBindingSchema = z
  .object({
    kind: kindSchema,
    source: sourceSchema,
    externalId: z.string().min(1).max(200),
    seasonYear: z.coerce.number().int().min(1950).max(2100).optional(),
    round: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export const bindingIdParamsSchema = z.object({
  id: z.string().uuid("Identificador de vínculo inválido"),
});

export const seasonIdParamSchema = z.object({
  seasonId: z.string().uuid("Identificador de temporada inválido"),
});

export const raceIdParamSchema = z.object({
  raceId: z.string().uuid("Identificador de corrida inválido"),
});