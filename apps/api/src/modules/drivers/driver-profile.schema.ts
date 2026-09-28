import { z } from "zod";
import { driverNumberSchema } from "./driver-number.rules.js";

// Esquemas de validação para o PUT de DriverProfile (Gestão de Pilotos).
// Aqui o Client controla APENAS dados de base do perfil (number);
// NUNCA controla userId/characterId/controlledBy:
// - ownership deriva do Character vinculado (request.user.id no servidor).
//
// teamId é EXCLUSIVO do domínio de Roster: vinculação de equipe é feita pelas
// operações /api/roster/* (SeasonDriverEntry é a fonte de verdade). DriverProfile
// NÃO aceita teamId no body — a presença da propriedade é rejeitada na rota.

export const upsertDriverSchema = z.object({
  number: driverNumberSchema.nullable().optional(),
});

export type UpsertDriverInput = z.infer<typeof upsertDriverSchema>;

export const updateDriverProfileSchema = upsertDriverSchema.extend({
  customHeadshotUrl: z
    .string()
    .trim()
    .url("Informe uma URL válida para a imagem")
    .max(2048, "URL muito longa")
    .nullable()
    .optional(),
});

export const driverCharacterIdParamSchema = z.object({
  characterId: z.string().uuid("Identificador de personagem inválido"),
});

export const driverIdParamSchema = z.object({
  id: z.string().uuid("Identificador de piloto inválido"),
});

export const driverListQuerySchema = z.object({
  seasonId: z.string().uuid("Identificador de temporada inválido").optional(),
});
