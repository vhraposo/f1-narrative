import { z } from "zod";

export const raceIdParamSchema = z.object({
  raceId: z.string().uuid("Identificador de corrida inválido"),
});

export type RaceIdParam = z.infer<typeof raceIdParamSchema>;