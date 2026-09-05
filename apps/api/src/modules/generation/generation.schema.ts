import { z } from "zod";

// Schemas de validação da rota real de geração (Fase 14 STEP 39).
//
// Contrato HTTP de POST /api/conversations/:id/generate:
//   - params: id (uuid da Conversation);
//   - body:
//     userPrompt      → obrigatório, trimado e não-vazio (nunca derivado de
//                       histórico; origem explícita no request);
//     targetCharacterId → obrigatório, uuid (AI speaker explícito; nunca
//                       derivado de participantes/heurística);
//     ragFrameId      → opcional, uuid (RAG opt-in; delegado ao bundle).
//
// Segue o padrão Zod existente (safeParse + issues), sem parser paralelo.

export const generateParamsSchema = z.object({
  id: z.string().uuid("Identificador de conversa inválido"),
});

export const generateBodySchema = z.object({
  userPrompt: z
    .string()
    .trim()
    .min(1, "Informe o prompt da geração")
    .max(5000, "Prompt muito longo (máx. 5000 caracteres)"),
  targetCharacterId: z.string().uuid("Identificador de personagem inválido"),
  ragFrameId: z
    .string()
    .uuid("Identificador de frame de RAG inválido")
    .optional(),
});

export type GenerateBodyInput = z.infer<typeof generateBodySchema>;