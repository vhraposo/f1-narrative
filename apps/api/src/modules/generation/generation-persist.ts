import type { Prisma, PrismaClient } from "@prisma/client";
import type { GenerationResult } from "./generation.assembly.js";
import { buildMessageContextJson } from "./generation-context-snapshot.js";

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
 * `contextJson` (Message) carrega o snapshot/metadata do contexto usado na
 * geração (STEP 108 FASE 4); o `generationKey` entra nesse JSON, sem coluna nova.
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
  contextJson: Prisma.JsonValue | null;
  createdAt: Date;
}

const messageSelect = {
  id: true,
  conversationId: true,
  senderType: true,
  characterId: true,
  content: true,
  contextJson: true,
  createdAt: true,
} as const;

function toGenerationMessage(row: {
  id: string;
  conversationId: string;
  senderType: string;
  characterId: string | null;
  content: string;
  contextJson: Prisma.JsonValue | null;
  createdAt: Date;
}): GenerationMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderType: "AI_CHARACTER",
    characterId: row.characterId as string,
    content: row.content,
    contextJson: row.contextJson,
    createdAt: row.createdAt,
  };
}

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

  if (mode !== "generated") {
    return { persisted: false, reason: "mode-not-generated" };
  }
  if (speakerCharacterId === undefined) {
    return { persisted: false, reason: "missing-speaker" };
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    return { persisted: false, reason: "missing-or-empty-text" };
  }
  if (!conversationId) {
    return { persisted: false, reason: "missing-conversation" };
  }
  const accessible = await conversationAccessibleToUser(db, conversationId, userId);
  if (!accessible) {
    return { persisted: false, reason: "no-conversation-access" };
  }

  const message = await db.message.create({
    data: {
      conversationId,
      senderType: "AI_CHARACTER",
      characterId: speakerCharacterId,
      content: text,
      contextJson: buildMessageContextJson(result) as unknown as Prisma.InputJsonValue,
    },
    select: messageSelect,
  });

  await db.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  return { persisted: true, message: toGenerationMessage(message) };
}
