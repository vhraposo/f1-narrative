import { z } from "zod";

// Esquemas de validação para o domínio de Schedule (Agenda).
//
// CharacterSchedule é um sub-recurso PRIVADO de um Character (1:N). A
// ownership NÃO é armazenada aqui (não há userId): ela é herdada do Character
// vinculado — o servidor sempre autentica o dono via a relação
// `character.userId`. Personagem de outro usuário nunca é exposto (404).
//
// Regras (escopo mínimo desta fase):
// - activity: obrigatória, trim + min 1;
// - startsAt / endsAt: datetime com offset (ISO 8601);
// - endsAt opcional/nullable; `endsAt < startsAt` é rejeitado como
//   VALIDATION_ERROR (endsAt = startsAt é aceito — nada no schema o proíbe);
// - overlap entre schedules NÃO é bloqueado;
// - sem recorrência, sem paginação, sem timezone novo, sem calendário;
// - passado/futuro são aceitos;
// - NÃO há integração automática com WorldState/Events/News nesta fase.

export const createScheduleSchema = z.object({
  activity: z
    .string()
    .trim()
    .min(1, "Informe a atividade")
    .max(200, "Atividade muito longa (máx. 200 caracteres)"),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;

export const updateScheduleSchema = createScheduleSchema.partial();

export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;

export const scheduleCharacterIdParamSchema = z.object({
  characterId: z.string().uuid("Identificador de personagem inválido"),
});

export const scheduleIdParamSchema = z.object({
  characterId: z.string().uuid("Identificador de personagem inválido"),
  scheduleId: z.string().uuid("Identificador de agendamento inválido"),
});