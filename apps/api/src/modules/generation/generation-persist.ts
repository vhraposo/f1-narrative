import type { PrismaClient } from "@prisma/client";
import type { GenerationResult } from "./generation.assembly.js";

/**
 * Ponto de persistência de Message para geração real (Fase 14 STEP 36).
 *
 * Consome um `GenerationResult` JÁ RESOLVIDO e validado (Fase 14 STEP 35):
 * a `speakerCharacterId` presente no resultado é exatamente o AI speaker que
 * será gravado; NENHUMA resolução/validação de speaker é feita aqui (não
 * recalcula, não busca histórico, não seleciona participant[0], não usa fallback
 * nem heurística). Se já existir um desejado, use a função que fabrica o Message.
 *
 * Persiste COMO Message SOMENTE quando TODOS forem verdadeiros:
 *   - `result.meta.mode === "generated"`
 *   - `result.speakerCharacterId` presente
 *   - `result.text` presente e não vazio
 *   - `result.context.meta.conversationId` válido
 *   - conversation acessível ao caller (`userId` possui participant)
 *
 * Quando qualquer condição falha → NÃO faz INSERT (nem parcial).
 * NÃO persiste a `generationKey` (é identidade lógica, sem coluna nova).
 */
export type GenerationPersistDecision =
  | { persisted: true; message: GenerationMessage }
  | { persisted: false; reason: string };

export interface GenerationMessage {
  id: string;
  conversationId: string;
  senderType: "AI_CHARACTER";
  characterId: string;
  content: string;
  createdAt: Date;
}

const messageSelect = {
  id: true,
  conversationId: true,
  senderType: true,
  characterId: true,
  content: true,
  createdAt: true,
} as const;

// Converte o row persistido para o tipo público mínimo, garantindo que o
// senderType gravado é AI_CHARACTER e o characterId é o speaker (não nulo).
function toGenerationMessage(row: {
  id: string;
  conversationId: string;
  senderType: string;
  characterId: string | null;
  content: string;
  createdAt: Date;
}): GenerationMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderType: "AI_CHARACTER",
    characterId: row.characterId as string,
    content: row.content,
    createdAt: row.createdAt,
  };
}

// Resolve se a Conversation é alcançável pelo usuário (regra da Fase 11):
// usuário possui ao menos um dos Characters participantes. Reutiliza a política
// existente; não inventa nova.
async function conversationAccessibleToUser(
  db: PrismaClient,
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const membership = await db.conversationParticipant.findFirst({
    where: {
      conversationId,
      character: { userId },
    },
    select: { conversationId: true },
  });
  return membership !== null;
}

export async function persistGeneratedMessage(
  db: PrismaClient,
  result: GenerationResult,
  userId: string,
): Promise<GenerationPersistDecision> {
  const { mode } = result.meta;
  const speakerCharacterId = result.speakerCharacterId;
  const text = result.text;
  const conversationId = result.context.meta.conversationId;

  // 1) Mode: somente `generated` persiste. assembly-only/sem text → sem INSERT.
  if (mode !== "generated") {
    return { persisted: false, reason: "mode-not-generated" };
  }
  // 2) Speaker presente (identity já resolvida no STEP 35).
  if (speakerCharacterId === undefined) {
    return { persisted: false, reason: "missing-speaker" };
  }
  // 3) Texto real presente e não vazio.
  if (typeof text !== "string" || text.trim().length === 0) {
    return { persisted: false, reason: "missing-or-empty-text" };
  }
  // 4) ConversationId presente.
  if (!conversationId) {
    return { persisted: false, reason: "missing-conversation" };
  }
  // 5) Ownership: sem acesso → NÃO faz INSERT.
  const accessible = await conversationAccessibleToUser(db, conversationId, userId);
  if (!accessible) {
    return { persisted: false, reason: "no-conversation-access" };
  }

  // Persistência normal (sem deduplicação, sem unique, sem índice novo).
  const message = await db.message.create({
    data: {
      conversationId,
      senderType: "AI_CHARACTER",
      characterId: speakerCharacterId,
      content: text,
    },
    select: messageSelect,
  });

  return { persisted: true, message: toGenerationMessage(message) };
}
