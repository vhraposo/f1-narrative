import { z } from "zod";
import { PERFORMANCE_MAX, PERFORMANCE_MIN } from "./team-performance.js";

const performanceValueSchema = z
  .number()
  .min(PERFORMANCE_MIN)
  .max(PERFORMANCE_MAX);

export const setTeamPerformanceSchema = z.object({
  carSpeed: performanceValueSchema,
  reliability: performanceValueSchema,
  operations: performanceValueSchema,
});

export type SetTeamPerformanceInput = z.infer<typeof setTeamPerformanceSchema>;

export const teamPerformanceParamsSchema = z.object({
  seasonId: z.string().uuid("Identificador de temporada inválido"),
  teamId: z.string().uuid("Identificador de equipe inválido"),
});