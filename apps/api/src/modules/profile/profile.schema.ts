import { z } from "zod";

export const updateProfileSchema = z
  .object({
    favoriteTeamId: z.string().uuid("Equipe inválida").nullable().optional(),
    favoriteDriverId: z.string().uuid("Piloto inválido").nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Informe ao menos um campo para atualizar",
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
