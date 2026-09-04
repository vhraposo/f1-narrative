import { createHash } from "node:crypto";
import {
  type PrismaClient,
  type Prisma,
  type ExternalSourceType,
  type ExternalSourceVisibility,
  type ExternalDocumentStatus,
} from "@prisma/client";

// ---------------------------------------------------------------------------
// External Research — Ingestão de Source → Document (Fase 13 STEP 3).
//
// SERVICE-ONLY: não cria endpoint, não toca o frontend nem Conversation.
// Ingestão DETERMINÍSTICA e SEGURA de uma ExternalSource e seu primeiro
// ExternalDocument. NÃO executa chunking, embeddings, retrieval ou RAG —
// o contrato termina em Source → Document. contentHash (SHA-256) representa
// o conteúdo canônico do documento, não sua identidade administrativa.
// ---------------------------------------------------------------------------

export const EXTERNAL_INGEST_RULE = "external-ingest.v1#mode=manual#scope=service";

export const INGEST_SENSITIVE_RE =
  /\b(authorization|bearer|x-api-key|api[-_]?key|client[-_]?secret|password|private[-_]?key)\b\s*[:=]\s*\S+/i;

// ---------------------------------------------------------------------------
// Contrato de input
// ---------------------------------------------------------------------------

export interface ExternalDocumentIngestInput {
  title: string;
  sourceType: ExternalSourceType;
  visibility: ExternalSourceVisibility;
  /** PRIVATE exige ownerId; PUBLIC/SHARED podem ter ownerId (opcional). */
  ownerId?: string | null;
  url: string;
  content: string;
  publishedAt?: Date | null;
}

export interface IngestSourceSummary {
  id: string;
  url: string;
  visibility: ExternalSourceVisibility;
  ownerId: string | null;
}

export interface IngestDocumentSummary {
  id: string;
  contentHash: string;
  status: ExternalDocumentStatus;
}

export interface IngestResult {
  source: IngestSourceSummary;
  document: IngestDocumentSummary;
  createdSource: boolean;
  createdDocument: boolean;
  contentHash: string;
  ruleApplied: string;
}

// ---------------------------------------------------------------------------
// Tipos de banco (seguindo o padrão de delegates do projeto)
// ---------------------------------------------------------------------------

/** Cliente transacional usado dentro de `$transaction` (só os delegates de ingestão). */
type IngestTx = Pick<PrismaClient, "externalSource" | "externalDocument">;

type IngestDb = IngestTx & { $transaction: PrismaClient["$transaction"] };

// ---------------------------------------------------------------------------
// Canonicalização + contentHash (SHA-256)
// ---------------------------------------------------------------------------

/**
 * Normalização canônica do conteúdo de um documento.
 * - Normaliza EOLs (\r\n / \r → \n).
 * - Remove espaços/whitespace à direita por linha (formatação não-semântica).
 * - PRESERVA pontuação e ordem de parágrafos; NÃO colapsa espaços internos
 *   (não destruir semântica).
 * Exclui qualquer metadado administrativo (ownerId, visibility, sourceType,
 * url, publishedAt, fetchedAt, timestamps, UUIDs).
 */
export function canonicalExternalContent(content: string): string {
  return content
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
}

/**
 * Digest SHA-256 do conteúdo canônico, formato estável `sha256:<hex>`.
 * Mesmo conteúdo → mesmo hash; conteúdo diferente → hash diferente.
 * Independe de relógio, processo, UUID ou metadado administrativo.
 */
export function computeDocumentContentHash(content: string): string {
  const canonical = canonicalExternalContent(content);
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `sha256:${digest}`;
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

function isValidAbsoluteUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // Credenciais embutidas (basic auth) nunca são armazenadas como identidade
  // de fonte — rejeitar user:pass@host.
  if (parsed.username || parsed.password) {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

function rejectIfSensitive(text: string, field: string): void {
  if (INGEST_SENSITIVE_RE.test(text)) {
    throw new Error(`Ingestão rejeitada: '${field}' contém material sensível não permitido.`);
  }
}

function validateIngestInput(input: ExternalDocumentIngestInput): void {
  if (!input.title || input.title.trim().length === 0) {
    throw new Error("Ingestão rejeitada: 'title' é obrigatório.");
  }
  if (!input.content || input.content.trim().length === 0) {
    throw new Error("Ingestão rejeitada: 'content' não pode ser vazio.");
  }
  if (!input.url || !isValidAbsoluteUrl(input.url)) {
    throw new Error("Ingestão rejeitada: 'url' inválida para uma fonte externa.");
  }
  // PRIVATE exige ownerId (escopo de acesso). Sem dono, seria inacessível.
  if (input.visibility === "PRIVATE" && !input.ownerId) {
    throw new Error("Ingestão rejeitada: fonte PRIVATE exige ownerId.");
  }
  rejectIfSensitive(input.content, "content");
  rejectIfSensitive(input.url, "url");
}

// ---------------------------------------------------------------------------
// Source: create/reuse (identidade = url + owner/visibility scope)
// ---------------------------------------------------------------------------

interface ResolvedSource {
  source: {
    id: string;
    url: string;
    visibility: ExternalSourceVisibility;
    ownerId: string | null;
  };
  created: boolean;
}

/**
 * Localiza ou cria uma ExternalSource.
 * Identidade natural: `url` + `ownerId` (incl. null). Isso impede que uma
 * fonte PRIVATE de um usuário seja fundida com a de outro usuário apenas por
 * compartilhar a mesma URL, e mantém PUBLIC (owner null) separado de qualquer
 * owner. (SHARED segue o escopo por ownerId até existir ACL real.)
 */
async function resolveSource(
  tx: IngestTx,
  input: ExternalDocumentIngestInput,
): Promise<ResolvedSource> {
  const existing = await tx.externalSource.findFirst({
    where: { url: input.url, ownerId: input.ownerId ?? null },
    select: { id: true, url: true, visibility: true, ownerId: true },
  });
  if (existing) {
    return { source: existing, created: false };
  }
  const created = await tx.externalSource.create({
    data: {
      url: input.url,
      title: input.title,
      sourceType: input.sourceType,
      visibility: input.visibility,
      ownerId: input.ownerId ?? null,
    },
    select: { id: true, url: true, visibility: true, ownerId: true },
  });
  return { source: created, created: true };
}

// ---------------------------------------------------------------------------
// Document: create/reuse (dedupe por sourceId + contentHash)
// ---------------------------------------------------------------------------

/**
 * Cria ou reusa um ExternalDocument por `@@unique([sourceId, contentHash])`.
 * Estratégia segura contra race: findUnique + create tratando a violação de
 * unicidade (P2002) como reuso — não depende só de findFirst→create.
 */
async function resolveDocument(
  tx: IngestTx,
  sourceId: string,
  input: ExternalDocumentIngestInput,
  contentHash: string,
): Promise<{ id: string; contentHash: string; status: ExternalDocumentStatus; created: boolean }> {
  const where = { sourceId_contentHash: { sourceId, contentHash } } satisfies Prisma.ExternalDocumentWhereUniqueInput;

  const existing = await tx.externalDocument.findUnique({
    where,
    select: { id: true, contentHash: true, status: true },
  });
  if (existing) {
    return { ...existing, created: false };
  }

  const status: ExternalDocumentStatus = "NEW";
  try {
    const created = await tx.externalDocument.create({
      data: {
        sourceId,
        title: input.title,
        content: input.content,
        contentHash,
        status,
        publishedAt: input.publishedAt ?? null,
      },
      select: { id: true, contentHash: true, status: true },
    });
    return { ...created, created: true };
  } catch (err) {
    // Outro processo criou o mesmo (sourceId, contentHash) primeiro → reuso.
    if ((err as Prisma.PrismaClientKnownRequestError)?.code === "P2002") {
      const reused = await tx.externalDocument.findUniqueOrThrow({
        where,
        select: { id: true, contentHash: true, status: true },
      });
      return { ...reused, created: false };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Orquestração principal
// ---------------------------------------------------------------------------

/**
 * Ingestão manual de uma Source + seu primeiro Document. Determinística em
 * resultado semântico (mesma entrada → mesmo hash e mesmas decisões de
 * create/reuse); timestamps de persistência vêm do banco e não fazem parte do
 * contrato lógico. READ do banco para lookup; WRITE apenas das entidades
 * ExternalSource/ExternalDocument criadas.
 */
export async function ingestExternalDocument(
  db: IngestDb,
  input: ExternalDocumentIngestInput,
): Promise<IngestResult> {
  validateIngestInput(input);
  const contentHash = computeDocumentContentHash(input.content);

  const result = await db.$transaction(async (tx) => {
    const src = await resolveSource(tx, input);
    const doc = await resolveDocument(tx, src.source.id, input, contentHash);
    return { src, doc };
  });

  return {
    source: result.src.source,
    document: result.doc,
    createdSource: result.src.created,
    createdDocument: result.doc.created,
    contentHash,
    ruleApplied: EXTERNAL_INGEST_RULE,
  };
}