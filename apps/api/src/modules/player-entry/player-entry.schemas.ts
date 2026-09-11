import { z } from "zod";

export const playerEntrySeasonQuerySchema = z.object({
  seasonId: z.string().uuid("Identificador de temporada inválido").optional(),
});

export const playerEntryBodySchema = z.object({
  seasonId: z.string().uuid("Identificador de temporada inválido"),
  teamId: z.string().uuid("Identificador de equipe inválido"),
  seat: z.union([z.literal(1), z.literal(2)]),
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome")
    .max(120, "Nome muito longo (máx. 120 caracteres)"),
  nationality: z
    .string()
    .trim()
    .min(1, "Informe a nacionalidade")
    .max(80, "Nacionalidade muito longa (máx. 80 caracteres)"),
  gender: z
    .string()
    .trim()
    .max(40, "Gênero muito longo (máx. 40 caracteres)")
    .optional()
    .nullable()
    .transform((value) => (value ? value : null)),
  birthDate: z.coerce
    .date({ error: "Data de nascimento inválida" })
    .refine((date) => date.getTime() <= Date.now(), {
      message: "A data de nascimento não pode estar no futuro",
    }),
});

export type PlayerEntrySeasonQuery = z.infer<typeof playerEntrySeasonQuerySchema>;
export type PlayerEntryBody = z.infer<typeof playerEntryBodySchema>;