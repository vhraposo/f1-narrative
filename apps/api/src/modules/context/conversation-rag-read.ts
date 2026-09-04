import type { PrismaClient } from "@prisma/client";
import {
  computeConversationRagFreshnessAnchor,
  type ConversationRagChunkBinding,
} from "../external-research/conversation-rag.js";
import {
  reconstructExternalRagContext,
  reconstructItemToRow,
} from "../external-research/conversation-rag-reconstruction.js";
import { assertConversationAccessible } from "../external-research/conversation-rag-materialization.js";
import type { ExternalRagContext } from "../external-research/external-rag-adapter.js";

// ---------------------------------------------------------------------------
// External Research — Read Service de RAG materializado por Conversation
// (Fase 13 STEP 18).
//
// SERVICE-ONLY READ-ONLY. Localiza, valida e reconstrói o ExternalRagContext
// materializado para uma Conversation. NÃO executa retrieval, materialization,
// mutation, provider, embedding. Somente SELECTs + computação pura de
// freshness. Provider = ZERO; HTTP externo = ZERO.
// ---------------------------------------------------------------------------

export const CONVERSATION_RAG_READ_RULE =
  "conversation-rag-read.v1#mode=service#scope=context";

// ---------------------------------------------------------------------------
// Contrato de retorno
// ---------------------------------------------------------------------------

export interface ConversationRagReadFrame {
  readonly frameId: string;
  readonly snapshotId: string | null;
  readonly freshness: "CURRENT" | "STALE" | "NO_SNAPSHOT";
  readonly externalRag: ExternalRagContext | null;
}

export interface ConversationRagReadResult {
  readonly conversationId: string;
  readonly frames: readonly ConversationRagReadFrame[];
}

// ---------------------------------------------------------------------------
// Read service principal
// ---------------------------------------------------------------------------

/**
 * Localiza e reconstrói o ExternalRagContext materializado para uma
 * Conversation. Retorna TODOS os frames com seu melhor snapshot (o mais
 * recente READY por frame), preservando a distinção frame/snapshot/runtime.
 *
 * - ownership via participants (Character → User);
 * - freshness validada recomputando o anchor a partir dos dados persistidos;
 * - stale NÃO é corrigido (somente classificado);
 * - snapshot sem frames → array vazio;
 * - frame sem snapshot READY → NO_SNAPSHOT;
 * - snapshot READY com freshness inconsistente → STALE.
 *
 * Determinismo: frameId ASC, snapshot retrievedAt DESC (mais recente primero).
 */
export async function readConversationRag(
  db: PrismaClient,
  conversationId: string,
  ownerId: string,
): Promise<ConversationRagReadResult> {
  await assertConversationAccessible(db, conversationId, ownerId);

  const frames = await db.conversationRagFrame.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });

  if (frames.length === 0) {
    return { conversationId, frames: [] };
  }

  const readFrames: ConversationRagReadFrame[] = [];

  for (const frame of frames) {
    const snapshot = await db.conversationRagSnapshot.findFirst({
      where: { frameId: frame.id, status: "READY" },
      orderBy: { retrievedAt: "desc" },
      select: {
        id: true,
        freshnessAnchor: true,
      },
    });

    if (!snapshot) {
      readFrames.push({
        frameId: frame.id,
        snapshotId: null,
        freshness: "NO_SNAPSHOT",
        externalRag: null,
      });
      continue;
    }

    // Carrega items com provenance (chunk → document) — 1 query por frame.
    const items = await db.conversationRagSnapshotItem.findMany({
      where: { snapshotId: snapshot.id },
      orderBy: { order: "asc" },
      select: {
        order: true,
        score: true,
        distance: true,
        citation: true,
        chunk: {
          select: {
            id: true,
            documentId: true,
            text: true,
            orderOriginal: true,
            contentHash: true,
            embeddedContentHash: true,
            document: {
              select: { sourceId: true, title: true },
            },
          },
        },
      },
    });

    // Filtra items cujo chunk ou document foi removido (RESTRICT não garante
    // em todos os cenários de cascade; defensivo).
    const validItems = items.filter(
      (item) => item.chunk !== null && item.chunk.document !== null,
    );

    // Recomputa freshnessAnchor a partir dos dados persistidos.
    const bindings: ConversationRagChunkBinding[] = validItems.map((item) => ({
      chunkId: item.chunk!.id,
      contentHash: item.chunk!.contentHash,
      embeddedContentHash: item.chunk!.embeddedContentHash,
    }));

    const currentAnchor = computeConversationRagFreshnessAnchor({
      frameKey: frame.frameKey,
      scopeSourceIds: frame.scopeSourceIds,
      topK: frame.topK,
      threshold: frame.threshold,
      provider: frame.provider,
      model: frame.model,
      version: frame.version,
      dimensions: frame.dimensions,
      ruleApplied: frame.ruleApplied,
      chunkBindings: bindings,
    });

    const freshness =
      currentAnchor === snapshot.freshnessAnchor ? "CURRENT" : "STALE";

    // Reconstrói ExternalRagContext (função pura do STEP 17).
    const rows = validItems.map((item, index) =>
      reconstructItemToRow(index, {
        chunkId: item.chunk!.id,
        score: item.score,
        distance: item.distance,
        citation: item.citation,
        chunk: {
          documentId: item.chunk!.documentId,
          text: item.chunk!.text,
          orderOriginal: item.chunk!.orderOriginal,
        },
        document: {
          sourceId: item.chunk!.document!.sourceId,
          title: item.chunk!.document!.title,
        },
      }),
    );

    const externalRag = reconstructExternalRagContext(
      {
        provider: frame.provider,
        model: frame.model,
        version: frame.version,
        dimensions: frame.dimensions,
        ruleApplied: frame.ruleApplied,
      },
      rows,
    );

    readFrames.push({
      frameId: frame.id,
      snapshotId: snapshot.id,
      freshness,
      externalRag,
    });
  }

  return { conversationId, frames: readFrames };
}
