import type { PrismaClient } from "@prisma/client";
import type { EmbeddingProviderWithInputType } from "./external-embedding-store.js";
import {
  type ExternalRetrievalConfig,
  type RetrievalScope,
  DEFAULT_EXTERNAL_RETRIEVAL_CONFIG,
  EXTERNAL_RETRIEVAL_RULE,
  validateRetrievalConfig,
  validateRetrievalQuery,
  retrieveExternalContext,
} from "./external-retrieval.js";
import { toExternalRagContext, type ExternalRagContext } from "./external-rag-adapter.js";
import {
  type ConversationRagChunkBinding,
  canonicalizeRagQuery,
  computeConversationRagFrameKey,
  computeConversationRagFreshnessAnchor,
  computeConversationRagSnapshotKey,
  computeRagQueryHash,
  isRagQueryHash,
} from "./conversation-rag.js";
import {
  reconstructItemToRow,
  reconstructExternalRagContext,
} from "./conversation-rag-reconstruction.js";

// ---------------------------------------------------------------------------
// External Research — Materialização de RAG por Conversation (Fase 13 STEP 17).
//
// SERVICE-ONLY (não cria endpoint). Persiste FRAME + SNAPSHOT + SNAPSHOT_ITEM
// seguindo o pipeline:
//   Conversation → ConversationRagFrame → retrieval(queryText) →
//   ExternalRagContext → persist snapshot/items → READY/current.
//
// O retrieval continua por QUERY TEXT e consome as APIs existentes
// (`retrieveExternalContext`, `toExternalRagContext`) — NÃO duplicamos
// retrieval/adapter. Provider SEMPRE injetado (mock em testes; nunca Cohere
// real em teste). Ownership vem da Conversation (participants), sem ownerId
// redundante na materialização.
//
// Regras (idempotência/determinismo §16/§17/§18/§19):
//   - mesma frame + mesmo conteúdo/embedding/config → mesmo snapshotKey;
//   - snapshot READY com a MESMA snapshotKey → reusa (sem duplicatas);
//   - content/embedding alterado → nova anchor → novo snapshot (histórico);
//   - provider/retrieval FORA da transaction; persistência em transaction curta.
// ---------------------------------------------------------------------------

export const CONVERSATION_RAG_MATERIALIZATION_RULE =
  "conversation-rag-materialization.v1#mode=service#scope=external-research";

// ---------------------------------------------------------------------------
// DB delegate (padrão do projeto)
// ---------------------------------------------------------------------------

type RagDb = Pick<
  PrismaClient,
  | "conversationRagFrame"
  | "conversationRagSnapshot"
  | "conversationRagSnapshotItem"
  | "conversationParticipant"
  | "externalChunk"
  | "$queryRawUnsafe"
> & { $transaction: PrismaClient["$transaction"] };

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

export class ConversationRagAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversationRagAccessError";
  }
}

export class ConversationRagMaterializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversationRagMaterializationError";
  }
}

// ---------------------------------------------------------------------------
// Ownership / Authorization (reusa semântica de participants do /context)
// ---------------------------------------------------------------------------

/**
 * Verifica se o owner alcança a Conversation via participação (Character →
 * User), mesma base do `accessibleConversationId` da Fase 11. Intruder /
 * conversa inexistente → `ConversationRagAccessError` (não vaza existência).
 */
export async function assertConversationAccessible(
  db: RagDb,
  conversationId: string,
  ownerId: string,
): Promise<void> {
  const membership = await db.conversationParticipant.findFirst({
    where: { conversationId, character: { userId: ownerId } },
    select: { id: true },
  });
  if (!membership) {
    throw new ConversationRagAccessError(
      "Conversation inacessível para o owner (não é participante).",
    );
  }
}

// ---------------------------------------------------------------------------
// Frame: determinismo + upsert
// ---------------------------------------------------------------------------

export interface ConversationRagFrameInput {
  readonly query: string;
  readonly scopeSourceIds?: unknown;
  readonly topK?: number;
  readonly threshold?: number;
  readonly provider?: string;
  readonly model?: string;
  readonly version?: string;
  readonly dimensions?: number;
  readonly ruleApplied?: string;
}

export interface ResolvedFrame {
  readonly id: string;
  readonly conversationId: string;
  readonly query: string;
  readonly queryHash: string;
  readonly scopeSourceIds: unknown;
  readonly topK: number;
  readonly threshold: number;
  readonly provider: string;
  readonly model: string;
  readonly version: string;
  readonly dimensions: number;
  readonly ruleApplied: string;
  readonly frameKey: string;
}

/** Pure: resolve + valida os campos do frame a partir do input (ou defaults). */
export function resolveConversationRagFrame(
  conversationId: string,
  input: ConversationRagFrameInput,
): ResolvedFrame {
  validateRetrievalQuery(input.query);
  const config: ExternalRetrievalConfig = {
    topK: input.topK ?? DEFAULT_EXTERNAL_RETRIEVAL_CONFIG.topK,
    threshold: input.threshold ?? DEFAULT_EXTERNAL_RETRIEVAL_CONFIG.threshold,
    provider: input.provider ?? DEFAULT_EXTERNAL_RETRIEVAL_CONFIG.provider,
    model: input.model ?? DEFAULT_EXTERNAL_RETRIEVAL_CONFIG.model,
    version: input.version ?? DEFAULT_EXTERNAL_RETRIEVAL_CONFIG.version,
    dimensions: input.dimensions ?? DEFAULT_EXTERNAL_RETRIEVAL_CONFIG.dimensions,
  };
  validateRetrievalConfig(config);
  const queryHash = computeRagQueryHash(input.query);
  if (!isRagQueryHash(queryHash)) {
    throw new ConversationRagMaterializationError("Conversation Rag: queryHash inválido.");
  }
  const frameKey = computeConversationRagFrameKey({
    queryHash,
    scopeSourceIds: input.scopeSourceIds,
    topK: config.topK,
    threshold: config.threshold,
    provider: config.provider,
    model: config.model,
    version: config.version,
    dimensions: config.dimensions,
    ruleApplied: EXTERNAL_RETRIEVAL_RULE,
  });
  return {
    id: "",
    conversationId,
    query: input.query,
    queryHash,
    scopeSourceIds: input.scopeSourceIds,
    topK: config.topK,
    threshold: config.threshold,
    provider: config.provider,
    model: config.model,
    version: config.version,
    dimensions: config.dimensions,
    ruleApplied: EXTERNAL_RETRIEVAL_RULE,
    frameKey,
  };
}

/**
 * Cria (upsert) a `ConversationRagFrame` por (conversationId, frameKey).
 * Query armazenada = query ORIGINAL; scopeSourceIds armazenado canonicamente.
 */
export async function ensureConversationRagFrame(
  db: RagDb,
  frame: ResolvedFrame,
): Promise<{ id: string; created: boolean }> {
  const existing = await db.conversationRagFrame.findUnique({
    where: { conversationId_frameKey: { conversationId: frame.conversationId, frameKey: frame.frameKey } },
    select: { id: true },
  });
  if (existing) {
    return { id: existing.id, created: false };
  }
  const created = await db.conversationRagFrame.create({
    data: {
      conversationId: frame.conversationId,
      queryText: frame.query,
      queryHash: frame.queryHash,
      scopeSourceIds: frame.scopeSourceIds ?? undefined,
      topK: frame.topK,
      threshold: frame.threshold,
      provider: frame.provider,
      model: frame.model,
      version: frame.version,
      dimensions: frame.dimensions,
      ruleApplied: frame.ruleApplied,
      frameKey: frame.frameKey,
      status: "READY",
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

// ---------------------------------------------------------------------------
// Freshness anchor + snapshot key (depende dos chunks recuperados)
// ---------------------------------------------------------------------------

async function loadChunkBindings(
  db: RagDb,
  chunkIds: string[],
): Promise<ConversationRagChunkBinding[]> {
  if (chunkIds.length === 0) return [];
  const chunks = await db.externalChunk.findMany({
    where: { id: { in: chunkIds } },
    select: { id: true, contentHash: true, embeddedContentHash: true },
  });
  return chunks.map((c) => ({
    chunkId: c.id,
    contentHash: c.contentHash,
    embeddedContentHash: c.embeddedContentHash,
  }));
}

// ---------------------------------------------------------------------------
// Materialização principal
// ---------------------------------------------------------------------------

export interface MaterializeConversationRagInput {
  readonly conversationId: string;
  readonly ownerId: string;
  readonly frame: ConversationRagFrameInput;
}

export interface MaterializeResult {
  readonly frameId: string;
  readonly snapshotId: string;
  readonly snapshotKey: string;
  readonly freshnessAnchor: string;
  /** Contrato neutro de runtime reconstruído. */
  readonly context: ExternalRagContext;
  /** true se reutilizou um snapshot READY existente (idempotência). */
  readonly reused: boolean;
  readonly itemCount: number;
}

/**
 * Executa a materialização completa de um frame autorizado:
 *   1. ownership (participants);
 *   2. resolve/valida frame + cria/upserta ConversationRagFrame;
 *   3. retrieval (query text) com provider injetado;
 *   4. converte para ExternalRagContext;
 *   5. calcula freshnessAnchor + snapshotKey;
 *   6. idempotência (reusa snapshot READY com a mesma snapshotKey);
 *   7. persiste snapshot + items em transaction curta e eleva a READY.
 *
 * O retrieval ocorre FORA da transaction (§19). Nunca toca provider real em
 * teste (o provider é passado por parâmetro).
 */
export async function materializeConversationRag(
  db: RagDb,
  provider: EmbeddingProviderWithInputType,
  input: MaterializeConversationRagInput,
): Promise<MaterializeResult> {
  await assertConversationAccessible(db, input.conversationId, input.ownerId);
  const resolved = resolveConversationRagFrame(input.conversationId, input.frame);
  const frame = await ensureConversationRagFrame(db, resolved);
  const frameId = frame.id;

  const sourceIds = resolveSourceIdArray(resolved.scopeSourceIds);
  const scope: RetrievalScope =
    sourceIds.length > 0
      ? { ownerId: input.ownerId, sourceIds }
      : { ownerId: input.ownerId };

  const config: ExternalRetrievalConfig = {
    topK: resolved.topK,
    threshold: resolved.threshold,
    provider: resolved.provider,
    model: resolved.model,
    version: resolved.version,
    dimensions: resolved.dimensions,
  };

  let retrieved;
  try {
    retrieved = await retrieveExternalContext(db, provider, resolved.query, scope, config);
  } catch (error) {
    await recordFailedSnapshot(db, frameId, resolved.frameKey);
    throw error;
  }

  const rag = toExternalRagContext(retrieved);
  const chunkIds = rag.items.map((i) => i.chunkId);
  const bindings = await loadChunkBindings(db, chunkIds);
  const freshnessAnchor = computeConversationRagFreshnessAnchor({
    frameKey: resolved.frameKey,
    scopeSourceIds: resolved.scopeSourceIds,
    topK: resolved.topK,
    threshold: resolved.threshold,
    provider: resolved.provider,
    model: resolved.model,
    version: resolved.version,
    dimensions: resolved.dimensions,
    ruleApplied: resolved.ruleApplied,
    chunkBindings: bindings,
  });
  const snapshotKey = computeConversationRagSnapshotKey(resolved.frameKey, freshnessAnchor);

  const existing = await db.conversationRagSnapshot.findUnique({
    where: { frameId_snapshotKey: { frameId, snapshotKey } },
    select: { id: true, status: true },
  });
  if (existing && existing.status === "READY") {
    const ready = await loadReadySnapshot(db, frameId, snapshotKey);
    return {
      frameId,
      snapshotId: existing.id,
      snapshotKey,
      freshnessAnchor,
      context: ready,
      reused: true,
      itemCount: rag.items.length,
    };
  }

  const persisted = await persistSnapshot(db, frameId, snapshotKey, rag, freshnessAnchor);
  return {
    frameId,
    snapshotId: persisted.snapshotId,
    snapshotKey,
    freshnessAnchor,
    context: persisted.context,
    reused: false,
    itemCount: rag.items.length,
  };
}

// ---------------------------------------------------------------------------
// Persistência (transaction curta) + leitura de snapshot READY
// ---------------------------------------------------------------------------

async function persistSnapshot(
  db: RagDb,
  frameId: string,
  snapshotKey: string,
  rag: ExternalRagContext,
  freshnessAnchor: string,
): Promise<{ snapshotId: string; context: ExternalRagContext }> {
  return db.$transaction(async (tx) => {
    const snapshot = await tx.conversationRagSnapshot.create({
      data: {
        frameId,
        snapshotKey,
        status: "READY",
        retrievedAt: new Date(),
        freshnessAnchor,
      },
      select: { id: true },
    });
    const itemsData = rag.items.map((item, index) => ({
      snapshotId: snapshot.id,
      chunkId: item.chunkId,
      score: item.score,
      distance: item.distance,
      order: index,
      citation: item.citation,
    }));
    if (itemsData.length > 0) {
      await tx.conversationRagSnapshotItem.createMany({
        data: itemsData,
      });
    }
    return { snapshotId: snapshot.id, context: rag };
  });
}

async function recordFailedSnapshot(
  db: RagDb,
  frameId: string,
  frameKey: string,
): Promise<void> {
  const anchor = computeConversationRagFreshnessAnchor({
    frameKey,
    scopeSourceIds: undefined,
    topK: 0,
    threshold: 0,
    provider: "",
    model: "",
    version: "",
    dimensions: 0,
    ruleApplied: CONVERSATION_RAG_MATERIALIZATION_RULE,
    chunkBindings: [],
  });
  const snapshotKey = computeConversationRagSnapshotKey(frameKey, anchor);
  await db.conversationRagSnapshot.create({
    data: {
      frameId,
      snapshotKey,
      status: "FAILED",
      retrievedAt: new Date(),
      freshnessAnchor: anchor,
    },
  });
}

async function loadReadySnapshot(
  db: RagDb,
  frameId: string,
  snapshotKey: string,
): Promise<ExternalRagContext> {
  const snapshot = await db.conversationRagSnapshot.findUnique({
    where: { frameId_snapshotKey: { frameId, snapshotKey } },
    select: {
      id: true,
      frame: {
        select: {
          provider: true,
          model: true,
          version: true,
          dimensions: true,
          ruleApplied: true,
        },
      },
      items: {
        select: {
          id: true,
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
              document: { select: { sourceId: true, title: true } },
            },
          },
        },
      },
    },
  });
  if (!snapshot || !snapshot.frame) {
    throw new ConversationRagMaterializationError(
      "Conversation Rag: snapshot READY inexistente para reconstrução.",
    );
  }
  const rows = snapshot.items
    .map((item) =>
      reconstructItemToRow(item.order, {
        chunkId: item.chunk?.id ?? "",
        score: item.score,
        distance: item.distance,
        citation: item.citation,
        chunk: {
          documentId: item.chunk?.documentId ?? "",
          text: item.chunk?.text ?? "",
          orderOriginal: item.chunk?.orderOriginal ?? 0,
        },
        document: {
          sourceId: item.chunk?.document?.sourceId ?? "",
          title: item.chunk?.document?.title ?? "",
        },
      }),
    )
    .filter((row) => row.chunkId.length > 0);
  return reconstructExternalRagContext(
    {
      provider: snapshot.frame.provider,
      model: snapshot.frame.model,
      version: snapshot.frame.version,
      dimensions: snapshot.frame.dimensions,
      ruleApplied: snapshot.frame.ruleApplied,
    },
    rows,
  );
}

function resolveSourceIdArray(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}

export { canonicalizeRagQuery };

export const CONVERSATION_RAG_ACCESS_RULE = CONVERSATION_RAG_MATERIALIZATION_RULE;
