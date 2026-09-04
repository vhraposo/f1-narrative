import { z } from "zod";

// Esquemas de validação para o domínio de Events (Evento / EventCharacter /
// NewsItem).
//
// Event e NewsItem são entidades globais compartilhadas (sem userId), no
// mesmo padrão de Season/Race: qualquer usuário autenticado pode consultá-las
// e gerenciá-las. O cliente nunca controla id/createdAt/ownership.
//
// NewsItem é derivado, determinístico e SOMENTE LEITURA nesta fase: não existe
// schema de criação/edição manual de notícia; ele é gerado a partir do Event
// pelo servidor. Daí termos apenas o schema de parâmetro para a leitura.
//
// EventCharacter não possui ownership próprio; ao associar um Character a um
// Event, o servidor valida que o Character pertence ao usuário autenticado
// (princípio de ownership já usado em Relationships). Aqui temos apenas os
// schemas de entrada (characterId) e de parâmetros do vínculo.

export const eventTypeSchema = z.enum([
  "RACE",
  "RACE_INCIDENT",
  "RELATIONSHIP",
  "SOCIAL",
  "PERSONAL",
  "NEWS",
  "WORLD",
]);
export const eventImportanceSchema = z.enum([
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
]);
export const eventSourceSchema = z.enum([
  "CANON",
  "USER_DEFINED",
  "GENERATED_EVENT",
  "EXTERNAL_INFORMATION",
]);

// payload é um objeto JSON livre, análogo a dimensions em Relationships.
// Não inventamos aqui uma estrutura narrativa rígida: o Prisma armazena como
// Json. Aceitamos qualquer objeto JSON serializável (não nulo, não array,
// não primitivo).
const payloadSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => value !== undefined && value !== null, {
    message: "Payload deve ser um objeto JSON",
  });

export const createEventSchema = z.object({
  type: eventTypeSchema,
  title: z
    .string()
    .trim()
    .min(1, "Informe o título do evento")
    .max(140, "Título muito longo (máx. 140 caracteres)"),
  description: z
    .string()
    .max(2000, "Descrição muito longa (máx. 2000 caracteres)")
    .optional()
    .nullable()
    .transform((value) => (value ? value : null)),
  importance: eventImportanceSchema.optional(),
  source: eventSourceSchema.optional(),
  worldDate: z.string().datetime({ offset: true }).optional().nullable(),
  payload: payloadSchema.optional().nullable(),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;

// PATCH: campos parciais opcionais. userId/ownership não estão presentes.
export const updateEventSchema = createEventSchema.partial();

export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const eventIdParamSchema = z.object({
  id: z.string().uuid("Identificador de evento inválido"),
});

// Vínculo N:N Event <-> Character (participantes).
export const addParticipantSchema = z.object({
  characterId: z.string().uuid("Identificador de personagem inválido"),
});

export type AddParticipantInput = z.infer<typeof addParticipantSchema>;

export const eventPathParamsSchema = z.object({
  eventId: z.string().uuid("Identificador de evento inválido"),
});

export const participantParamsSchema = z.object({
  eventId: z.string().uuid("Identificador de evento inválido"),
  characterId: z.string().uuid("Identificador de personagem inválido"),
});