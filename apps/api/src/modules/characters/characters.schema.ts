import { z } from "zod";

// Esquemas de validação para o CRUD de Character.
// userId e controlledBy são definidos exclusivamente no servidor e nunca
// são aceitos como campos controláveis pelo cliente.

export const createCharacterSchema = z.object({
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
  imageUrl: z
    .union([z.string().url("URL de imagem inválida"), z.literal("")])
    .optional()
    .nullable()
    .transform((value) => (value ? value : null)),
  biography: z
    .string()
    .max(2000, "Biografia muito longa (máx. 2000 caracteres)")
    .optional()
    .nullable()
    .transform((value) => (value ? value : null)),
});

export type CreateCharacterInput = z.infer<typeof createCharacterSchema>;

// PATCH: campos parciais opcionais. userId/controlledBy não estão presentes.
export const updateCharacterSchema = createCharacterSchema.partial();

export type UpdateCharacterInput = z.infer<typeof updateCharacterSchema>;

export const characterIdParamSchema = z.object({
  id: z.string().uuid("Identificador de personagem inválido"),
});
