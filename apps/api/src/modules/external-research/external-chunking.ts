import { createHash } from "node:crypto";
import { type PrismaClient, type ExternalDocumentStatus } from "@prisma/client";
import { canonicalExternalContent } from "./external-ingest.js";

// ---------------------------------------------------------------------------
// External Research — Chunking de ExternalDocument → ExternalChunk[]
// (Fase 13 STEP 4).
//
// SERVICE-ONLY: não cria endpoint, não toca frontend/Conversation.
// Chunking DETERMINÍSTICO baseado em unidades semânticas (parágrafos).
// NÃO executa embeddings, vector ops, retrieval ou RAG. O contrato termina em
// Document → Chunk[]. contentHash de cada chunk = SHA-256 do texto canônico.
//
// ## Status
//   NEW  → READY   (transição idempotente após chunking bem-sucedido)
//   READY→ READY   (reprocessamento do MESMO conteúdo reutiliza, sem duplicar)
//   READY→ NEW     (nunca; sem downgrade automático)
//
// ## Rechunk de conteúdo alterado
//   Decisão explícita do STEP: quando os chunks existentes NÃO correspondem ao
//   contentHash atual do Document, o serviço SUBSTITUI atomicamente os chunks
//   antigos pelos novos (deleteMany + create numa transação). Não há
//   versionamento formal de chunk no schema; por isso a substituição é
//   atômica e nunca apaga nada fora de transação nem deixa Document READY com
//   chunks incompletos. (Isto é uma variação deliberada sobre "rejeitar por
//   padrão": o usuário confirmou substituição atômica.)
// ---------------------------------------------------------------------------

export const EXTERNAL_CHUNKING_RULE = "external-chunking.v1#mode=manual#scope=service";

export const CHUNK_DEFAULT_MAX_SIZE = 1000;
export const CHUNK_DEFAULT_OVERLAP = 0;

const HASH_PREFIX = "sha256:";
const HASH_RE = /^sha256:[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

export interface ExternalChunkingOptions {
  /** Tamanho máximo (em caracteres/code points) por chunk. Default 1000. */
  maxSize?: number;
  /** Sobreposição entre chunks consecutivos de um parágrafo grande. Default 0. */
  overlap?: number;
}

export interface ExternalChunkSummary {
  id: string;
  documentId: string;
  orderOriginal: number;
  contentHash: string;
}

export interface ChunkingResult {
  document: {
    id: string;
    status: ExternalDocumentStatus;
    contentHash: string;
  };
  chunks: ExternalChunkSummary[];
  created: number;
  reused: number;
  ruleApplied: string;
}

// ---------------------------------------------------------------------------
// Tipos de banco (padrão de delegates do projeto)
// ---------------------------------------------------------------------------

type ChunkTx = Pick<PrismaClient, "externalDocument" | "externalChunk">;

type ChunkDb = ChunkTx & { $transaction: PrismaClient["$transaction"] };

interface ValidOptions {
  maxSize: number;
  overlap: number;
}

function validateOptions(options: ExternalChunkingOptions | undefined): ValidOptions {
  const maxSize = options?.maxSize ?? CHUNK_DEFAULT_MAX_SIZE;
  const overlap = options?.overlap ?? CHUNK_DEFAULT_OVERLAP;
  if (!Number.isInteger(maxSize) || maxSize < 1) {
    throw new Error("Chunking rejeitado: 'maxSize' deve ser um inteiro >= 1.");
  }
  if (!Number.isInteger(overlap) || overlap < 0) {
    throw new Error("Chunking rejeitado: 'overlap' deve ser um inteiro >= 0.");
  }
  if (overlap >= maxSize) {
    throw new Error("Chunking rejeitado: 'overlap' deve ser menor que 'maxSize'.");
  }
  return { maxSize, overlap };
}

// ---------------------------------------------------------------------------
// Normalização + Chunk Hash (SHA-256)
// ---------------------------------------------------------------------------

/**
 * Normalização de parágrafo: opera sobre o conteúdo canônico (STEP 3) e
 * colapsa runs de linhas em branco para exatamente uma linha em branco por
 * separação de parágrafo (\n\n). Alteração apenas de whitespace; não toca
 * pontuação, espaços internos ou ordem. Garante um invariante reconstrutível:
 * para overlap = 0, `chunks.join("\n\n") === normParagraphContent(content)`.
 */
export function normParagraphContent(content: string): string {
  return canonicalExternalContent(content)
    .split(/\n\n+/)
    .filter((block) => block.length > 0)
    .join("\n\n");
}

/**
 * Digest SHA-256 do texto canônico de um chunk, formato `sha256:<64 hex>`.
 * O hash representa SOMENTE o conteúdo do chunk — independe de documentId,
 * orderOriginal, timestamps, UUID ou metadata de embedding.
 * Mesmo texto canônico → mesmo hash; texto diferente → hash diferente.
 */
export function computeChunkContentHash(text: string): string {
  const canonical = canonicalExternalContent(text);
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `${HASH_PREFIX}${digest}`;
}

// ---------------------------------------------------------------------------
// Subdivisão de parágrafo grande (determinística, com overlap opcional)
// ---------------------------------------------------------------------------

// Onde podemos cortar com segurança: fim de sentença > whitespace > hard cut.
function findBestCut(codes: string[], start: number, end: number): number {
  // Preferir o limite mais à frente (chunk mais cheio), procurando de end-1 → start.
  for (let i = end - 1; i > start; i--) {
    const ch = codes[i];
    if (ch === "." || ch === "!" || ch === "?") {
      const next = codes[i + 1];
      if (next === undefined || next === " " || next === "\n" || next === "\t") {
        return i + 1;
      }
    }
  }
  for (let i = end - 1; i > start; i--) {
    const ch = codes[i];
    if (ch === " " || ch === "\t" || ch === "\n") {
      return i + 1;
    }
  }
  // Hard cut no limite do window (código verifica que não há loop).
  return end;
}

/**
 * Subdivide um único parágrafo (já canônico) em pedaços de no máximo `maxSize`
 * code points. Determinístico; preserva todos os caracteres; se `overlap > 0`,
 * o início de cada pedaço repete `overlap` caracteres do pedaço anterior.
 */
function subdivideParagraph(text: string, maxSize: number, overlap: number): string[] {
  const codes = Array.from(text);
  const n = codes.length;
  const pieces: string[] = [];
  let start = 0;
  while (start < n) {
    const windowEnd = Math.min(start + maxSize, n);
    let cut: number;
    if (overlap === 0) {
      cut = windowEnd < n ? findBestCut(codes, start, windowEnd) : windowEnd;
    } else {
      cut = windowEnd; // overlap > 0: progresso fixo por maxSize; sem backtracking
    }
    if (cut <= start) {
      cut = start + 1; // garantia anti-loop (preserva caracteres)
    }
    pieces.push(codes.slice(start, cut).join(""));
    const next = overlap === 0 ? cut : cut - overlap;
    if (next <= start) {
      start = cut; // garantia de progresso
    } else {
      start = next;
    }
  }
  return pieces;
}

/**
 * Gera os textos canônicos dos chunks de um conteúdo (política da FASE 13):
 * 1) normaliza/colapsa parágrafos; 2) separa por linha em branco; 3) remove
 * blocos vazios; 4) preserva ordem; 5) subdivide parágrafos que excedem
 * `maxSize`. Para overlap = 0, `chunks.join("\n\n") === normParagraphContent`.
 */
export function splitDocumentIntoChunks(
  content: string,
  options?: ExternalChunkingOptions,
): string[] {
  const { maxSize, overlap } = validateOptions(options);
  const normalized = normParagraphContent(content);
  if (normalized.length === 0) {
    return [];
  }
  const paragraphs = normalized.split("\n\n");
  const chunks: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) continue;
    if (paragraph.length <= maxSize) {
      chunks.push(paragraph);
    } else {
      chunks.push(...subdivideParagraph(paragraph, maxSize, overlap));
    }
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Consistência (validação pura antes de persistir)
// ---------------------------------------------------------------------------

function assertValidTargets(targets: string[], content: string, overlap: number): void {
  if (targets.length === 0) {
    return; // conteúdo vazio → nenhum chunk (caso F)
  }
  // orderOriginal é o índice (contínuo a partir de 0) → sempre contínuo.
  for (const t of targets) {
    if (t.length === 0 || !computeChunkContentHash(t).match(HASH_RE)) {
      throw new Error("Chunking falhou: hash de chunk inválido.");
    }
  }
  if (overlap === 0) {
    const reconstructed = targets.join("\n\n");
    if (reconstructed !== normParagraphContent(content)) {
      throw new Error("Chunking falhou: reconstrução do conteúdo não corresponde à política.");
    }
  }
}

// ---------------------------------------------------------------------------
// Orquestração principal
// ---------------------------------------------------------------------------

/**
 * Chunk um ExternalDocument existente de forma determinística e idempotente.
 * - MESMO conteúdo com chunks presentes  → reutiliza (created=0, reused=n).
 * - Conteúdo alterado (chunks incompatíveis) → substituição ATÔMICA.
 * - `status`: NEW → READY; READY permanece READY; nunca downgrade.
 * Tudo dentro de transação: nunca termina com READY + chunks incompletos.
 */
export async function chunkExternalDocument(
  db: ChunkDb,
  documentId: string,
  options?: ExternalChunkingOptions,
): Promise<ChunkingResult> {
  const { maxSize, overlap } = validateOptions(options);

  const doc = await db.externalDocument.findUnique({
    where: { id: documentId },
    select: { id: true, content: true, contentHash: true, status: true },
  });
  if (!doc) {
    throw new Error(`Chunking rejeitado: Document '${documentId}' não encontrado.`);
  }

  // Política totalmente determinada a partir do conteúdo + opções; validação
  // pura acontece ANTES de qualquer write (nada é deletado em caso de erro).
  const targets = splitDocumentIntoChunks(doc.content, { maxSize, overlap });
  assertValidTargets(targets, doc.content, overlap);

  const result = await db.$transaction(async (tx) => {
    const existing = await tx.externalChunk.findMany({
      where: { documentId },
      orderBy: { orderOriginal: "asc" },
      select: { id: true, documentId: true, orderOriginal: true, contentHash: true },
    });

    const match =
      existing.length === targets.length &&
      existing.every((c, i) => c.orderOriginal === i && c.contentHash === computeChunkContentHash(targets[i]));

    let chunks: ExternalChunkSummary[];
    let created: number;
    let reused: number;

    if (match) {
      chunks = existing;
      created = 0;
      reused = existing.length;
    } else {
      await tx.externalChunk.deleteMany({ where: { documentId } });
      let order = 0;
      for (const text of targets) {
        await tx.externalChunk.create({
          data: {
            documentId,
            text,
            orderOriginal: order,
            contentHash: computeChunkContentHash(text),
          },
          select: { id: true, documentId: true, orderOriginal: true, contentHash: true },
        });
        order += 1;
      }
      const persisted = await tx.externalChunk.findMany({
        where: { documentId },
        orderBy: { orderOriginal: "asc" },
        select: { id: true, documentId: true, orderOriginal: true, contentHash: true },
      });
      chunks = persisted;
      created = persisted.length;
      reused = 0;
    }

    const status: ExternalDocumentStatus = targets.length === 0 ? doc.status : "READY";
    if (status !== doc.status) {
      await tx.externalDocument.update({
        where: { id: doc.id },
        data: { status },
      });
    }

    return { chunks, created, reused, status };
  });

  return {
    document: { id: doc.id, status: result.status, contentHash: doc.contentHash },
    chunks: result.chunks,
    created: result.created,
    reused: result.reused,
    ruleApplied: EXTERNAL_CHUNKING_RULE,
  };
}