import { z } from "zod";

// Esquemas de validação para o PUT de DriverProfile (Gestão de Pilotos).
// Aqui o Client controla APENAS dados de base do perfil (number);
// NUNCA controla userId/characterId/controlledBy:
// - ownership deriva do Character vinculado (request.user.id no servidor).
//
// teamId é EXCLUSIVO do domínio de Roster: vinculação de equipe é feita pelas
// operações /api/roster/* (SeasonDriverEntry é a fonte de verdade). DriverProfile
// NÃO aceita teamId no body — a presença da propriedade é rejeitada na rota.

export const upsertDriverSchema = z.object({
  number: z
    .number()
    .int("O número precisa ser um inteiro")
    .min(2, "O número precisa ser entre 2 e 99")
    .max(99, "O número precisa ser entre 2 e 99")
    .nullable()
    .optional(),
});

export type UpsertDriverInput = z.infer<typeof upsertDriverSchema>;

export const driverCharacterIdParamSchema = z.object({
  characterId: z.string().uuid("Identificador de personagem inválido"),
});
