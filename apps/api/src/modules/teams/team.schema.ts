import { z } from "zod";

// Esquemas de validação para o CRUD de Team.
// userId é definido exclusivamente no servidor (request.user.id) e nunca é
// aceito como campo controlável pelo cliente.

export const createTeamSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome da equipe")
    .max(80, "Nome muito longo (máx. 80 caracteres)"),
  shortName: z
    .string()
    .trim()
    .max(20, "Sigla muito longa (máx. 20 caracteres)")
    .optional()
    .nullable()
    .transform((value) => (value ? value : null)),
  color: z
    .string()
    .trim()
    .max(20, "Cor muito longa (máx. 20 caracteres)")
    .optional()
    .nullable()
    .transform((value) => (value ? value : null)),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;

// PATCH: campos parciais opcionais. userId não está presente.
export const updateTeamSchema = createTeamSchema.partial();

export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;

export const teamIdParamSchema = z.object({
  id: z.string().uuid("Identificador de equipe inválido"),
});
