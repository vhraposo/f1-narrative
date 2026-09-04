import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// External Research — Identidades determinísticas para RAG por Conversation
// (Fase 13 STEP 17).
//
// Somente RESOLUÇÃO determinística de identidade: canonicalização de query,
// queryHash, frameKey, freshnessAnchor e snapshotKey. Funções PURAS (sem DB,
// sem HTTP, sem provider, sem relógio, sem random, sem UUID físico). A base é
// a convenção de hash do projeto: digest SHA-256 + prefixo `sha256:`.
//
// Regra de ouro: identidade lógica NUNCA depende de Date.now(), random,
// UUID físico ou ordem de inserção. Idem chaves que "mudam o resultado".
// ---------------------------------------------------------------------------

export const CONVERSATION_RAG_RULE = "conversation-rag.v1#mode=pure#scope=service";

const HASH_PREFIX = "sha256:";
const HASH_RE = /^sha256:[0-9a-f]{64}$/;

function digestHex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Canonicalização de query
// ---------------------------------------------------------------------------

/**
 * Normalização canônica MINIMAL de uma query de pesquisa:
 *   - normaliza EOLs (\r\n / \r → \n);
 *   - remove espaços/whitespace à direita por linha;
 *   - trims o total (leading/trailing).
 * NÃO colapsa espaços internos e NÃO altera acentuação/pontuação/conteúdo
 * semântico (evitar destruir semântica de busca). O hash resultante serve à
 * identidade do frame; a `queryText` ORIGINAL permanece armazenada para
 * referência/reauditoria.
 */
export function canonicalizeRagQuery(query: string): string {
  return query
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
}

/** Digest SHA-256 da query canônica, formato `sha256:<64 hex>`. */
export function computeRagQueryHash(query: string): string {
  return `${HASH_PREFIX}${digestHex(canonicalizeRagQuery(query))}`;
}

export function isRagQueryHash(value: string): boolean {
  return HASH_RE.test(value);
}

// ---------------------------------------------------------------------------
// Escopo de sources
// ---------------------------------------------------------------------------

/**
 * Lista canônica (string[] de UUIDs) a partir de um valor armazenado em
 * `Email @unique`... na verdade de `scopeSourceIds` (Json? que deve conter um
 * array de strings de UUID). Aceita: undefined/null → []; array; ou valor
 * inválido → throws. Saída: sorted-unique (determinística e JSON-normalizada).
 */
export function canonicalizeScopeSourceIds(input: unknown): readonly string[] {
  if (input == null) return [];
  if (!Array.isArray(input)) {
    throw new Error(
      "Conversation Rag: 'scopeSourceIds' deve ser um array de strings de UUID ou nulo.",
    );
  }
  const ids: string[] = [];
  for (const value of input) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error("Conversation Rag: 'scopeSourceIds' contém entrada inválida.");
    }
    ids.push(value.trim());
  }
  return Array.from(new Set(ids)).sort();
}

// ---------------------------------------------------------------------------
// Serialização canônica
// ---------------------------------------------------------------------------

/** Serializa de forma estável (ordem de chaves fixa) para hashing. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Frame Key
// ---------------------------------------------------------------------------

export interface ConversationRagFrameIdentityInput {
  readonly queryHash: string;
  readonly scopeSourceIds?: unknown;
  readonly topK: number;
  readonly threshold: number;
  readonly provider: string;
  readonly model: string;
  readonly version: string;
  readonly dimensions: number;
  readonly ruleApplied: string;
}

/**
 * Identidade determinística do frame. Considera CADA campo que altera o
 * conjunto de resultados (queryHash + escopo + config de retrieval).
 * `scopeSourceIds` entra CANONICALIZADO (sorted-unique), então o mesmo escopo
 * em qualquer ordem produz o mesmo frameKey.
 */
export function computeConversationRagFrameKey(input: ConversationRagFrameIdentityInput): string {
  const scope = canonicalizeScopeSourceIds(input.scopeSourceIds);
  const payload = canonicalJson({
    queryHash: input.queryHash,
    scopeSourceIds: scope,
    topK: input.topK,
    threshold: input.threshold,
    provider: input.provider,
    model: input.model,
    version: input.version,
    dimensions: input.dimensions,
    ruleApplied: input.ruleApplied,
  });
  return `${HASH_PREFIX}${digestHex(payload)}`;
}

// ---------------------------------------------------------------------------
// Freshness Anchor + Snapshot Key
// ---------------------------------------------------------------------------

export interface ConversationRagChunkBinding {
  readonly chunkId: string;
  readonly contentHash: string;
  readonly embeddedContentHash: string | null;
}

export interface ConversationRagFreshnessInput {
  readonly frameKey: string;
  readonly scopeSourceIds?: unknown;
  readonly topK: number;
  readonly threshold: number;
  readonly provider: string;
  readonly model: string;
  readonly version: string;
  readonly dimensions: number;
  readonly ruleApplied: string;
  readonly chunkBindings: readonly ConversationRagChunkBinding[];
}

/**
 * Anchor determinística que reflete as dependências que invalidam um resultado:
 * frameKey + retrieval config + escopo + conteúdo/embedding dos chunks
 * recuperados (contentHash / embeddedContentHash). Mesmo conjunto de chunks
 * com MESMOS hashes + mesma config → mesma anchor (CURRENT). Conteúdo /
 * embedding alterado → anchor diferente (STALE / novo snapshot).
 * NÃO usa fetchedAt (evita falsa invalidação por relógio).
 */
export function computeConversationRagFreshnessAnchor(
  input: ConversationRagFreshnessInput,
): string {
  const scope = canonicalizeScopeSourceIds(input.scopeSourceIds);
  const bindings = Array.from(input.chunkBindings)
    .filter((b) => b && b.chunkId)
    .sort((a, b) => (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0))
    .map((b) => ({
      chunkId: b.chunkId,
      contentHash: b.contentHash,
      embeddedContentHash: b.embeddedContentHash ?? null,
    }));
  const payload = canonicalJson({
    frameKey: input.frameKey,
    scopeSourceIds: scope,
    topK: input.topK,
    threshold: input.threshold,
    provider: input.provider,
    model: input.model,
    version: input.version,
    dimensions: input.dimensions,
    ruleApplied: input.ruleApplied,
    chunkBindings: bindings,
  });
  return `${HASH_PREFIX}${digestHex(payload)}`;
}

/**
 * snapshotKey = hash determinístico da MATERIALIZAÇÃO (frameKey + anchor).
 * Mesma frame + mesmo conteúdo/embedding/config → mesmo snapshotKey
 * (idempotência e determinismo §16/§17). Não usa timestamp.
 */
export function computeConversationRagSnapshotKey(
  frameKey: string,
  freshnessAnchor: string,
): string {
  const payload = canonicalJson({ frameKey, freshnessAnchor });
  return `${HASH_PREFIX}${digestHex(payload)}`;
}

export function isRagHash(value: string | undefined | null): boolean {
  return typeof value === "string" && HASH_RE.test(value);
}
