import { z } from "zod";

export const INITIALIZATION_SCOPE_VALUES = [
  "DRIVER_GRID",
  "RACES",
  "RESULTS",
  "STANDINGS",
] as const;

export const initializationScopeSchema = z.enum(INITIALIZATION_SCOPE_VALUES);
export type InitializationScope = z.infer<typeof initializationScopeSchema>;

export const universeInitializationBodySchema = z.object({
  seasonId: z.string().uuid("Identificador de temporada inválido"),
  externalSeasonId: z.string().uuid("Identificador da temporada externa inválido"),
  scopes: z
    .array(initializationScopeSchema)
    .min(1, "Informe ao menos um escopo de materialização")
    .optional(),
});

export type UniverseInitializationInput = z.infer<typeof universeInitializationBodySchema>;

export const universeInitializationStatusQuerySchema = z.object({
  seasonId: z.string().uuid("Identificador de temporada inválido"),
  externalSeasonId: z.string().uuid("Identificador da temporada externa inválido"),
  scopes: z.string().optional(),
});

export type UniverseInitializationStatusQuery = z.infer<
  typeof universeInitializationStatusQuerySchema
>;