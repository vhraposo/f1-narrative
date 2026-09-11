import { z } from "zod";

export const seasonIdParamSchema = z.object({
  seasonId: z.string().uuid("Identificador de temporada inválido"),
});

export const teamIdBodySchema = z.object({
  teamId: z.string().uuid("Identificador de equipe inválido"),
});

export type SeasonIdParam = z.infer<typeof seasonIdParamSchema>;
export type TeamIdBody = z.infer<typeof teamIdBodySchema>;
