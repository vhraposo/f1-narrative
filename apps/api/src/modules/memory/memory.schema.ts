import { z } from "zod";

// Esquemas de validação para o domínio de Memory (Memória narrativa).
//
// Memory é uma memória persistente do universo: pode envolver múltiplos
// Characters (via MemoryCharacter, N:N) e ter origem opcional em um Event.
//
// Ownership vs Participação:
// Memory não armazena userId (seria um campo novo, não previsto). A autorização
// é ancorada nos Characters participantes: um usuário só pode criar/manipular
// uma Memory se possuir (userId) ao menos UM dos Characters que participam dela
// — ownership indireta, decidida pela participação, não pela criação (mesmo
// princípio de EventCharacter, aplicado de forma invertida).
//
// PARTICIPAÇÃO ≠ OWNERSHIP. Uma Memory pode envolver Characters USER e AI;
// personagens controlados por IA (CharacterController = AI, userId null) podem
// participar livremente sem conceder acesso de manipulação. O usuário NÃO
// precisa possuir cada participante — precisa possuir pelo menos um.
//
// Para ancorar a ownership, a criação de Memory exige ao menos um characterId
// próprio no corpo (ver createMemorySchema). Os demais characterIds podem ser
// AI ou de qualquer origem (basta existirem). O modelo no banco segue "0..N"
// (MemoryCharacter suporta 0..N); a API garante >= 1 para que toda Memory
// criada seja sempre alcançável pelo seu dono.
//
// Regras:
// - content: obrigatório (trim + min 1);
// - summary/context/emotionalImpact: opcionais;
// - importance: enum MemoryImportance (LOW/MEDIUM/HIGH/CRITICAL);
// - source: enum CanonSource (CANON/USER_DEFINED/GENERATED_EVENT/EXTERNAL_INFORMATION);
// - eventId: opcional; deve referenciar um Event existente (validado no server);
// - createdAt/updatedAt são controlados pelo Prisma (não editáveis);
// - NÃO há embedding/vector/RAG nesta fase; retrieval é determinístico.

export const memoryImportanceSchema = z.enum([
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
]);

export const memorySourceSchema = z.enum([
  "CANON",
  "USER_DEFINED",
  "GENERATED_EVENT",
  "EXTERNAL_INFORMATION",
]);

// context é um objeto JSON livre, análogo a payload (Event) e dimensions
// (Relationship). Não inventamos estrutura rígida: o Prisma armazena como Json.
const contextSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => value !== undefined && value !== null, {
    message: "Contexto deve ser um objeto JSON",
  });

export const createMemorySchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Informe o conteúdo da memória")
    .max(5000, "Conteúdo muito longo (máx. 5000 caracteres)"),
  summary: z
    .string()
    .trim()
    .max(1000, "Resumo muito longo (máx. 1000 caracteres)")
    .optional()
    .nullable(),
  context: contextSchema.optional().nullable(),
  importance: memoryImportanceSchema.optional(),
  source: memorySourceSchema.optional(),
  emotionalImpact: z
    .number()
    .int("Deve ser um número inteiro")
    .min(-10, "Impacto emocional mínimo -10")
    .max(10, "Impacto emocional máximo 10")
    .optional()
    .nullable(),
  eventId: z.string().uuid("Identificador de evento inválido").optional().nullable(),
  // Participantes iniciais obrigatórios: ao menos um precisa pertencer ao usuário
  // para ancorar a ownership da Memory (toda Memory é alcançável pelo seu criador).
  characterIds: z
    .array(z.string().uuid("Identificador de personagem inválido"))
    .min(1, "Informe ao menos um personagem participante"),
});

export type CreateMemoryInput = z.infer<typeof createMemorySchema>;

// PATCH: campos parciais opcionais. numberOf characterIds não é editado aqui;
// participantes são gerenciados pelos endpoints dedicados.
export const updateMemorySchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Informe o conteúdo da memória")
    .max(5000, "Conteúdo muito longo (máx. 5000 caracteres)")
    .optional(),
  summary: z
    .string()
    .trim()
    .max(1000, "Resumo muito longo (máx. 1000 caracteres)")
    .optional()
    .nullable(),
  context: contextSchema.optional().nullable(),
  importance: memoryImportanceSchema.optional(),
  source: memorySourceSchema.optional(),
  emotionalImpact: z
    .number()
    .int("Deve ser um número inteiro")
    .min(-10, "Impacto emocional mínimo -10")
    .max(10, "Impacto emocional máximo 10")
    .optional()
    .nullable(),
  eventId: z.string().uuid("Identificador de evento inválido").optional().nullable(),
});

export type UpdateMemoryInput = z.infer<typeof updateMemorySchema>;

// Query de listagem: filtros determinísticos limitados aos campos/enums reais.
export const memoryListQuerySchema = z.object({
  importance: memoryImportanceSchema.optional(),
  eventId: z.string().uuid("Identificador de evento inválido").optional(),
});

export type MemoryListQuery = z.infer<typeof memoryListQuerySchema>;

export const memoryIdParamSchema = z.object({
  id: z.string().uuid("Identificador de memória inválido"),
});

export const memoryCharacterIdParamSchema = z.object({
  characterId: z.string().uuid("Identificador de personagem inválido"),
});

export const memoryParticipantCharacterIdParamSchema = z.object({
  id: z.string().uuid("Identificador de memória inválido"),
  characterId: z.string().uuid("Identificador de personagem inválido"),
});

export const memoryAddParticipantSchema = z.object({
  characterId: z.string().uuid("Identificador de personagem inválido"),
});

export type AddMemoryParticipantInput = z.infer<typeof memoryAddParticipantSchema>;