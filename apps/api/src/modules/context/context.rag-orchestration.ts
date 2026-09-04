import type { ExternalRagContext } from "../external-research/external-rag-adapter.js";
import { withExternalRag, type AssembledContext } from "./context.assembly.js";

// ---------------------------------------------------------------------------
// External Research — Orchester de Context Assembly com RAG materializado
// (Fase 13 STEP 13).
//
// Fronteira PURA e DETERMINÍSTICA entre um `ExternalRagContext` JÁ materializado
// pelo pipeline (retrieval STEP 9 → adapter STEP 10) e o `AssembledContext`
// (STEP 11/12).
//
// RESPONSABILIDADE ÚNICA:
//   Aplicar a validação ESTRUTURAL MÍNIMA da fronteira e delegar a anexação ao
//   contrato já existente `withExternalRag(...)` (STEP 11). NÃO duplica a
//   lógica de anexação; é um "wrapper fino" (Reuse-first, STEP 13 §17/§19).
//
// DEPENDENCY FIREWALL:
//   - NENHUM banco (sem PrismaClient, sem SQL, sem $queryRaw/$executeRaw);
//   - NENHUM HTTP/provider/Cohere/retrieval;
//   - NENHUM re-rank, dedup, cálculo vetorial, score, distance;
//   - NENHUMA revalidação de provider/model/version/dimensions/vector/contentHash/
//     threshold/topK/ranking — essas responsabilidades pertencem aos STEPs 9/10.
//
// A única validação AQUI é estrutural e apenas confirma que a fronteira recebeu
// um contrato com a forma esperada. Presente-porém-malformado NUNCA vira
// "ausência": falha de forma determinística (FAIL-FAST), para não mascarar
// corrupção entre retrieval/adapter/context.
// ---------------------------------------------------------------------------

/**
 * Regra do erro de contrato da fronteira de orquestração. Inclui o motivo para
 * diagnóstico determinístico; não lança stack de rede/provider.
 */
export class ExternalRagContractError extends Error {
  override readonly name = "ExternalRagContractError";
  constructor(message: string) {
    super(message);
  }
}

/**
 * Validação ESTRUTURAL MÍNIMA de um `ExternalRagContext` na fronteira.
 *
 * SUCESSO (retorna `true`): um objeto com `sourceType === "external"` e
 * `items` sendo um `Array` (mesmo que vazio — empty-RAG é válido e preservado).
 *
 * FALHA (retorna `false`): qualquer outra forma. NUNCA corrige nem transforma
 * a entrada; apenas sinaliza que o valor não é um contrato aceitável.
 *
 * NÃO valida campos internos (provider/model/version/dimensions/vector/score/
 * distance/contentHash) — isso já foi feito pelos STEPs 9/10.
 */
export function isValidRagBoundary(value: unknown): value is ExternalRagContext {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return v.sourceType === "external" && Array.isArray(v.items);
}

/**
 * Orchester da fronteira RAG → Context Assembly (Fase 13 STEP 13).
 *
 * Sem RAG (undefined/null) → contexto sem `externalRag` (delega a
 * `withExternalRag(assembled, undefined)`), byte-a-byte igual ao pré-RAG.
 *
 * Com RAG válido → anexa VERBATIM via `withExternalRag`, preservando ordem,
 * provenance, citation, score, distance e todos os metadados, SEM transformação.
 *
 * Com RAG presente porém ESTRUTURALMENTE INVÁLIDO → lança `ExternalRagContractError`
 * (FAIL-FAST determinístico). NUNCA converte para ausência nem ignora.
 *
 * Imutável: cria um NOVO objeto; a entrada nunca é mutada. Pura/determinística:
 * mesmo input → mesmo output serializado.
 */
export function assembleContextWithExternalRag<C extends AssembledContext>(
  assembled: C,
  externalRag?: ExternalRagContext | null,
): C {
  if (externalRag == null) {
    // undefined | null → sem RAG (a chave é removida; o pré-RAG é preservado).
    return withExternalRag(assembled, undefined);
  }
  if (!isValidRagBoundary(externalRag)) {
    // PRESENTE-PORÉM-MALFORMADO → NÃO é ausência. Fail-fast de contrato.
    throw new ExternalRagContractError(
      "ExternalRagContext estruturalmente inválido na fronteira de orchestration: " +
        "esperado objeto com sourceType === 'external' e items como Array. " +
        "NÃO será convertido para ausência para não mascarar corrupção de contrato.",
    );
  }
  // Válido → anexa verbatim, sem re-rank/dedup/transformação.
  return withExternalRag(assembled, externalRag);
}
