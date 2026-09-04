import { z } from "zod";

// Esquemas de validação para o domínio de Conversation (Conversas entre
// Characters do universo).
//
// Conversation é uma entidade do universo: NÃO possui userId/ownerId. A
// autorização (ownership) é ancorada nos Characters participantes — um usuário
// só pode acessar/manipular uma Conversation se possuir (userId) ao menos UM
// dos Characters participantes. PARTICIPAÇÃO ≠ OWNERSHIP: Characters USER e AI
// podem participar livremente (basta existirem); Characters controlados por IA
// participam sem conceder acesso de manipulação.
//
// Participantes N:N via ConversationParticipant, com
// `@@unique([conversationId, characterId])` impedindo duplicação.
//
// Messages usam MessageSenderType:
//   - USER_CHARACTER: characterId obrigatório E o Character deve pertencer ao
//     usuário autenticado.
//   - AI_CHARACTER : characterId obrigatório E o Character deve ser
//     controlledBy = AI.
//   - SYSTEM       : characterId deve ser null/ausente.
//
// DM = exatamente 2 participantes; GROUP = 1 ou mais (semântica de
// ConversationType).

export const conversationTypeSchema = z.enum(["GROUP", "DM"]);

export const messageSenderTypeSchema = z.enum([
  "USER_CHARACTER",
  "AI_CHARACTER",
  "SYSTEM",
]);

// Criação de Conversation: exige ao menos um participante (Character).
// A regra DM = 2 participantes é validada no server (requer acesso ao banco):
// aqui garantimos só a presença e unicidade da lista de participants.
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

// PATCH: title e/ou type opcionais. Participantes são gerenciados pelos
// endpoints dedicados (espelha o padrão de Memory).
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

// Criação de Message. senderType obrigatório; characterId interpretado conforme
// senderType:
//   - USER_CHARACTER / AI_CHARACTER: obrigatório (uuid);
//   - SYSTEM: deve estar ausente ou null (validado no server).
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