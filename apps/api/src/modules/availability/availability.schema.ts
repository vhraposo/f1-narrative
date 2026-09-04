import { z } from "zod";

// Esquemas de validação para o domínio de Availability (Disponibilidade).
//
// CharacterAvailability é um sub-recurso PRIVADO de um Character (1:1, único
// por personagem). A ownership NÃO é armazenada aqui (não há userId): ela é
// herdada do Character vinculado — o servidor sempre autentica o dono via a
// relação `character.userId`. Personagem de outro usuário nunca é exposto
// (404, não 403).
//
// Characters com userId null (previsto para controle por IA) ficam FORA do
// escopo nesta fase: sem filtro de userId eles não são alcançáveis por aqui.
//
// Regras:
// - status usa o enum real AvailabilityStatus (AVAILABLE/BUSY/TRAINING/
//   TRAVELING/SLEEPING/RACE_WEEKEND/OFFLINE);
// - reason (opcional) complementa o status;
// - until (opcional) marca o fim de um status temporário;
// - `until < since` é rejeitado pelo servidor (400 VALIDATION_ERROR);
// - NÃO há DERIVAÇÃO automática a partir de Schedule nem integração com
//   WorldState/Events nesta fase — disponibilidade é editada manualmente.

export const availabilityStatusSchema = z.enum([
  "AVAILABLE",
  "BUSY",
  "TRAINING",
  "TRAVELING",
  "SLEEPING",
  "RACE_WEEKEND",
  "OFFLINE",
]);

// Campos aceitos na atualização da disponibilidade de um Character (todos
// opcionais — PATCH). O cliente nunca controla id/characterId/since/createdAt/
// updatedAt.
export const updateAvailabilitySchema = z.object({
  status: availabilityStatusSchema.optional(),
  reason: z
    .string()
    .max(500, "O motivo deve ter no máximo 500 caracteres")
    .nullable()
    .optional(),
  until: z
    .string()
    .datetime({ offset: true })
    .nullable()
    .optional(),
});

export type UpdateAvailabilityInput = z.infer<typeof updateAvailabilitySchema>;

export const availabilityCharacterIdParamSchema = z.object({
  characterId: z.string().uuid("Identificador de personagem inválido"),
});