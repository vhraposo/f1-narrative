import { type PrismaClient } from "@prisma/client";
import { type EmbeddingConfig } from "./external-embedding.js";
import {
  type EmbeddingIntegrityState,
  COHERE_EMBEDDING_CONFIG,
  type EmbeddingIntegrityReport,
  verifyExternalDocumentEmbeddings,
} from "./external-embedding-integrity.js";
import {
  type EmbeddingProviderWithInputType,
  embedExternalDocumentChunks,
} from "./external-embedding-store.js";

// ---------------------------------------------------------------------------
// External Research — Repair CONTROLADO de Embeddings (Fase 13 STEP 8a).
//
// SERVICE-ONLY e document-scoped: NÃO cria endpoint; NÃO implementa repair
// global/all/source-wide/collection-wide/tenant-wide.
//
// Fluxo:
//   AUDIT ─► PLAN ─► DRY-RUN (padrão) ─► EXPLICIT APPLY (TEST only) ─► RE-AUDIT
//
// DECISÕES (fechadas):
//   - Escopo: `documentId` obrigatório (recusa ausência).
//   - Dry-run é o comportamento padrão (`apply !== true`): audita + planeja,
//     NÃO escreve, NÃO chama provider, NÃO altera vector/metadata.
//   - Apply apenas com `apply: true` E database reconhecidamente de TEST.
//   - Provider sempre mock em testes; NUNCA Cohere real neste STEP.
//   - Config divergente (provider/model/version/metadata-dims) só é re-embed
//     quando config explícita for fornecida no request.
//   - NUNCA resize/truncation/padding de vector; nunca "consertar" vector à mão.
//
// SAFETY GATE (DEV):
//   Apply executa `SELECT current_database()` e só prossegue se o banco estiver
//   na allowlist explícita de TEST (default `f1_narrative_test`). Qualquer outro
//   banco (DEV `f1_narrative`, desconhecido) → rejeita apply. Dry-run continua
//   readonly e é sempre permitido.
//
// REUSO: a persistência de vetores usa `embedExternalDocumentChunks` (STEP 7);
// este módulo apenas prepara (limpa) os chunks afetados numa transação curta e
// coopera com o store idempotente. Nenhuma chamada externa dentro de transação.
// ---------------------------------------------------------------------------

export const EXTERNAL_EMBEDDING_REPAIR_RULE =
  "external-embedding-repair.v1#mode=controlled#scope=document";

/** Allowlist PADRÃO de bancos autorizados a APPLY (QA). */
export const REPAIR_APPLY_ALLOWED_DATABASES: readonly string[] = ["f1_narrative_test"];

// ---------------------------------------------------------------------------
// Contratos
// ---------------------------------------------------------------------------

export interface EmbeddingRepairRequest {
  /** Documento-alvo. Obrigatório; nunca "global". */
  documentId: string;
  /** Config alvo para re-embed. Ausente = usa a default (exige configuração explícita p/ divergências). */
  config?: EmbeddingConfig;
  /** Se `true`, executa o repair (apenas em TEST). Default false (dry-run). */
  apply?: boolean;
}

export type EmbeddingRepairAction =
  | "EMBED"
  | "RE-EMBED"
  | "RE-EMBED_REQUIRED"
  | "SKIPPED_EXPLICIT_CONFIG_REQUIRED"
  | "NONE";

export type EmbeddingRepairStatus = "dry-run" | "success" | "partial" | "failed";

export interface EmbeddingRepairActionItem {
  chunkId: string;
  reasons: EmbeddingIntegrityState[];
  action: EmbeddingRepairAction;
}

export interface EmbeddingRepairTotals {
  examined: number;
  valid: number;
  repairable: number;
  skipped: number;
}

export interface EmbeddingPostAuditSummary {
  totalChunks: number;
  validEmbeddings: number;
  invalidEmbeddings: number;
  allValid: boolean;
}

export interface EmbeddingRepairResult {
  documentId: string;
  dryRun: boolean;
  status: EmbeddingRepairStatus;
  actions: EmbeddingRepairActionItem[];
  totals: EmbeddingRepairTotals;
  postAudit: EmbeddingPostAuditSummary;
  ruleApplied: string;
}

// ---------------------------------------------------------------------------
// Db: precisa de SELECT (auditoria + safety gate) E de escrita curta (clear +
// store idempotente). O gate de segurança garante que escrita só ocorre em TEST.
// ---------------------------------------------------------------------------

export type RepairDb = Pick<
  PrismaClient,
  "externalChunk" | "$transaction" | "$executeRawUnsafe" | "$queryRawUnsafe"
>;

// ---------------------------------------------------------------------------
// Mapeamento razão → ação (puro/determinístico)
// ---------------------------------------------------------------------------

const CONFIG_SENSITIVE_REASONS: readonly EmbeddingIntegrityState[] = [
  "PROVIDER_MISMATCH",
  "MODEL_MISMATCH",
  "VERSION_MISMATCH",
  "METADATA_DIMENSION_MISMATCH",
] as const;

/**
 * Converte as razões de um chunk em UMA ação. Regras:
 *   - Divergência de configuração → `RE-EMBED_REQUIRED` se config explícita;
 *     caso contrário `SKIPPED_EXPLICIT_CONFIG_REQUIRED` (skip seguro).
 *   - MISSING_VECTOR → EMBED.
 *   - Demais (hash/hash-ausente/dims-vector/invalid) → RE-EMBED.
 *   - NUNCA resize/truncation/padding.
 */
export function mapReasonsToAction(
  reasons: readonly EmbeddingIntegrityState[],
  configProvided: boolean,
): EmbeddingRepairAction {
  if (reasons.length === 0) return "NONE";
  const hasConfigSensitive = CONFIG_SENSITIVE_REASONS.some((r) => reasons.includes(r));
  if (hasConfigSensitive) {
    return configProvided ? "RE-EMBED_REQUIRED" : "SKIPPED_EXPLICIT_CONFIG_REQUIRED";
  }
  if (reasons.includes("MISSING_VECTOR")) return "EMBED";
  return "RE-EMBED";
}

// ---------------------------------------------------------------------------
// Safety gate: aplica apenas em base de TEST reconhecida
// ---------------------------------------------------------------------------

async function assertApplyAllowed(db: RepairDb, allowlist: readonly string[]): Promise<void> {
  let rows: Array<{ current_database: string }>;
  try {
    rows = await db.$queryRawUnsafe<Array<{ current_database: string }>>(
      "SELECT current_database()",
    );
  } catch {
    throw new Error("Embedding repair apply bloqueado: impossível identificar o database.");
  }
  const dbName = rows?.[0]?.current_database ?? "";
  if (!dbName || !allowlist.includes(dbName)) {
    throw new Error(
      `Embedding repair apply bloqueado: database '${
        dbName || "(desconhecido)"
      }' não está autorizado para APPLY. Somente databases de TEST.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Preparação (clear) — transação curta, sem chamadas externas
// ---------------------------------------------------------------------------

async function clearChunkEmbeddings(db: RepairDb, chunkIds: string[]): Promise<void> {
  if (chunkIds.length === 0) return;
  await db.$transaction(async (tx) => {
    for (const id of chunkIds) {
      await tx.$executeRawUnsafe(
        `UPDATE "ExternalChunk" SET
           "embedding" = NULL,
           "embeddedContentHash" = NULL,
           "embeddingProvider" = NULL,
           "embeddingModel" = NULL,
           "embeddingVersion" = NULL,
           "embeddingDimensions" = NULL
         WHERE "id" = $1::uuid`,
        id,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Serviço principal
// ---------------------------------------------------------------------------

export async function repairExternalDocumentEmbeddings(
  db: RepairDb,
  provider: EmbeddingProviderWithInputType,
  request: EmbeddingRepairRequest,
  options?: { allowlist?: readonly string[] },
): Promise<EmbeddingRepairResult> {
  if (!request.documentId || request.documentId.trim().length === 0) {
    throw new Error("Embedding repair rejeitado: 'documentId' é obrigatório (reparo é document-scoped).");
  }
  const configProvided = request.config !== undefined;
  const effectiveConfig = request.config ?? COHERE_EMBEDDING_CONFIG;
  const dryRun = request.apply !== true;
  const allowlist = options?.allowlist ?? REPAIR_APPLY_ALLOWED_DATABASES;

  // AUDIT (readonly)
  const pre: EmbeddingIntegrityReport = await verifyExternalDocumentEmbeddings(
    db,
    request.documentId,
    effectiveConfig,
  );

  // PLAN (determinístico; ordenado por chunkId)
  const actions: EmbeddingRepairActionItem[] = pre.chunks
    .filter((c) => c.status === "invalid")
    .map((c) => ({
      chunkId: c.chunkId,
      reasons: [...c.reasons],
      action: mapReasonsToAction(c.reasons, configProvided),
    }))
    .sort((a, b) => (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0));

  const skipped = actions.filter((a) => a.action === "SKIPPED_EXPLICIT_CONFIG_REQUIRED").length;
  const totals: EmbeddingRepairTotals = {
    examined: pre.totalChunks,
    valid: pre.validEmbeddings,
    repairable: actions.length - skipped,
    skipped,
  };

  // DRY-RUN (padrão): nada é escrito; provider não é chamado.
  if (dryRun) {
    return {
      documentId: request.documentId,
      dryRun: true,
      status: "dry-run",
      actions,
      totals,
      postAudit: {
        totalChunks: pre.totalChunks,
        validEmbeddings: pre.validEmbeddings,
        invalidEmbeddings: pre.invalidEmbeddings,
        allValid: pre.invalidEmbeddings === 0,
      },
      ruleApplied: EXTERNAL_EMBEDDING_REPAIR_RULE,
    };
  }

  // APPLY: somente em TEST (safety gate ANTES de qualquer escrita).
  await assertApplyAllowed(db, allowlist);

  const executable = actions.filter((a) => a.action !== "SKIPPED_EXPLICIT_CONFIG_REQUIRED");
  if (executable.length > 0) {
    // Preparação (curta): limpa os chunks afetados para o store idempotente
    // re-embedá-los sob a config efetiva. Sem chamada externa na transação.
    await clearChunkEmbeddings(db, executable.map((a) => a.chunkId));
    // Persistência real (provider fora de transação; store usa transações curtas).
    await embedExternalDocumentChunks(db, request.documentId, effectiveConfig, provider);
  }

  // RE-AUDIT
  const post = await verifyExternalDocumentEmbeddings(db, request.documentId, effectiveConfig);
  const invalidAfter = post.chunks.filter((c) => c.status === "invalid");
  const skippedIds = new Set(
    actions.filter((a) => a.action === "SKIPPED_EXPLICIT_CONFIG_REQUIRED").map((a) => a.chunkId),
  );
  const allValid = invalidAfter.length === 0;
  const onlySkippedRemain =
    invalidAfter.length > 0 && invalidAfter.every((c) => skippedIds.has(c.chunkId));

  const status: EmbeddingRepairStatus = allValid ? "success" : onlySkippedRemain ? "partial" : "failed";

  return {
    documentId: request.documentId,
    dryRun: false,
    status,
    actions,
    totals,
    postAudit: {
      totalChunks: post.totalChunks,
      validEmbeddings: post.validEmbeddings,
      invalidEmbeddings: post.invalidEmbeddings,
      allValid,
    },
    ruleApplied: EXTERNAL_EMBEDDING_REPAIR_RULE,
  };
}