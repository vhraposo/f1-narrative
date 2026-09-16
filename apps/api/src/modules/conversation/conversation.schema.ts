import { z } from "zod";


export const conversationTypeSchema = z.enum(["GROUP", "DM"]);

export const messageSenderTypeSchema = z.enum([
  "USER_CHARACTER",
  "AI_CHARACTER",
  "SYSTEM",
]);

export const createConversationSchema = z.object({
  title: z
    .string()
    .trim()
    .max(200, "Título muito longo (máx. 200 caracteres)")
    .optional()
    .nullable(),
  type: conversationTypeSchema.optional(),
  participantIds: z
    .array(z.string().uuid("Identificador de personagem inválido"))
    .min(1, "Informe ao menos um personagem participante"),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;

export const updateConversationSchema = z.object({
  title: z
    .string()
    .trim()
    .max(200, "Título muito longo (máx. 200 caracteres)")
    .optional()
    .nullable(),
  type: conversationTypeSchema.optional(),
});

export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;

export const conversationIdParamSchema = z.object({
  id: z.string().uuid("Identificador de conversa inválido"),
});

export const conversationParticipantParamSchema = z.object({
  id: z.string().uuid("Identificador de conversa inválido"),
  characterId: z.string().uuid("Identificador de personagem inválido"),
});

export const addConversationParticipantSchema = z.object({
  characterId: z.string().uuid("Identificador de personagem inválido"),
});

export type AddConversationParticipantInput = z.infer<
  typeof addConversationParticipantSchema
>;

export const createMessageSchema = z.object({
  senderType: messageSenderTypeSchema,
  characterId: z
    .string()
    .uuid("Identificador de personagem inválido")
    .optional()
    .nullable(),
  content: z
    .string()
    .trim()
    .min(1, "Informe o conteúdo da mensagem")
    .max(5000, "Conteúdo muito longo (máx. 5000 caracteres)"),
});

export type CreateMessageInput = z.infer<typeof createMessageSchema>;

export const turnBodySchema = z.object({
  userPrompt: z
    .string()
    .trim()
    .min(1, "Informe o prompt do turno")
    .max(5000, "Prompt muito longo (máx. 5000 caracteres)"),
  ragFrameId: z
    .string()
    .uuid("Identificador de frame de RAG inválido")
    .optional(),
});

export type TurnBodyInput = z.infer<typeof turnBodySchema>;