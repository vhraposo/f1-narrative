import { z } from "zod";


export const teamVisualIdentitySchema = z.object({
  primary: z.string().min(1, "Informe a cor primária"),
  secondary: z.string().optional().nullable(),
  accent: z.string().optional().nullable(),
  foreground: z.string().optional().nullable(),
});

export const teamVisualIdentityFieldSchema =
  teamVisualIdentitySchema.optional().nullable();

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
  visualIdentity: teamVisualIdentityFieldSchema,
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const updateTeamSchema = createTeamSchema.partial();

export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;

export const teamIdParamSchema = z.object({
  id: z.string().uuid("Identificador de equipe inválido"),
});
