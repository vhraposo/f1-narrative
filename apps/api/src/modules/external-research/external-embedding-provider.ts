import {
  type EmbeddingProvider,
  type EmbeddingConfig,
  validateEmbeddingConfig,
} from "./external-embedding.js";

// ---------------------------------------------------------------------------
// External Research — Provider Cohere (Fase 13 STEP 7).
//
// Implementa o provider REAL de embeddings via API oficial Cohere, usando
// `fetch` nativo do Node (sem SDK). DECISÃO (STEP 6):
//   provider   = cohere
//   model      = embed-multilingual-v3.0
//   version    = v3.0
//   dimensions = 1024
// Métrica de similaridade (futuro) = cosine.
//
// Segurança:
//   - API key SOMENTE server-side (env COHERE_API_KEY).
//   - fail-closed: key ausente/vazia/config inválida → erro explícito.
//   - NUNCA loga a key; NUNCA inclui a key em erro/resultado; NUNCA persiste.
//   - só envia ao provider o TEXTO canônico do chunk (sem headers/tokens).
//
// Timeout/erro:
//   - HTTP timeout via AbortController (conceito de fail explícito).
//   - 4xx/5xx → erro tipado, sem retry complexo neste STEP.
//   - output validado ANTES de persistir: vetor de tamanho 1024, finito.
// ---------------------------------------------------------------------------

export const COHERE_EMBEDDING_RULE = "cohere-embedding.v1#mode=real#scope=service";

export const COHERE_PROVIDER = "cohere";
export const COHERE_MODEL = "embed-multilingual-v3.0";
export const COHERE_VERSION = "v3.0";
export const COHERE_DIMENSIONS = 1024;

export type CohereInputType = "search_document" | "search_query";

/** Input type usado para documentos (indexação). */
export const COHERE_INPUT_DOCUMENT: CohereInputType = "search_document";
/** Input type reservado para queries em um futuro STEP de retrieval. */
export const COHERE_INPUT_QUERY: CohereInputType = "search_query";

export interface CohereProviderConfig {
  /** Chave da API Cohere (server-side). Se ausente/vazia → fail-closed. */
  readonly apiKey: string;
  /** Timeout da chamada HTTP em ms. Default 30_000. */
  readonly timeoutMs?: number;
  /** Request factory injetável (testes). Default: fetch global. */
  readonly fetchImpl?: typeof fetch;
}

interface CohereEmbedResponse {
  embeddings?: { float?: number[][] };
}

/**
 * Provider de embeddings Cohere (embed-multilingual-v3.0, 1024 dims).
 * Satisfaz `EmbeddingProvider` (registry STEP 5) e adiciona `inputType`
 * (`search_document` para documentos, `search_query` para queries futuras).
 */
export class CohereEmbeddingProvider implements EmbeddingProvider {
  readonly name = COHERE_PROVIDER;
  readonly model = COHERE_MODEL;
  readonly version = COHERE_VERSION;
  readonly dimensions = COHERE_DIMENSIONS;

  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: CohereProviderConfig) {
    if (!config.apiKey || config.apiKey.trim().length === 0) {
      throw new Error("Cohere provider not configured: COHERE_API_KEY ausente ou vazia.");
    }
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  getConfig(): EmbeddingConfig {
    return {
      provider: this.name,
      model: this.model,
      version: this.version,
      dimensions: this.dimensions,
    };
  }

  /**
   * Gera o embedding de um texto (único).
   * `inputType` default `search_document`; `search_query` reservado para o
   * futuro STEP de retrieval.
   */
  async embed(input: string, inputType: CohereInputType = "search_document"): Promise<number[]> {
    const response = await this.request(input, inputType);
    return this.assertValidVector(response.embeddings?.float?.[0]);
  }

  private async request(input: string, inputType: CohereInputType): Promise<CohereEmbedResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let res: Response;
      try {
        res = await this.fetchImpl("https://api.cohere.com/v2/embed", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            input_type: inputType,
            embedding_types: ["float"],
            output_dimension: this.dimensions,
            inputs: [{ content: [{ type: "text", text: input }] }],
          }),
          signal: controller.signal,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new Error("Cohere provider timeout.", { cause: err });
        }
        throw new Error("Cohere provider network error.", { cause: err });
      }

      if (!res.ok) {
        // NUNCA incluir responsabilidade da chave no erro; faill-closed.
        throw new Error(`Cohere provider HTTP ${res.status}.`);
      }

      const body = (await res.json()) as CohereEmbedResponse;
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  private assertValidVector(vector: number[] | undefined): number[] {
    if (!Array.isArray(vector)) {
      throw new Error("Cohere provider returned response without a valid embedding.");
    }
    if (vector.length !== this.dimensions) {
      throw new Error(
        `Cohere provider dimensions mismatch: expected ${this.dimensions}, got ${vector.length}.`,
      );
    }
    for (const value of vector) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error("Cohere provider returned non-finite embedding value.");
      }
    }
    return vector;
  }
}

/**
 * Fábrica que cria um CohereEmbeddingProvider a partir do ambiente.
 * Lê COHERE_API_KEY de forma fail-closed; valida a config resultante.
 */
export function createCohereProviderFromEnv(apiKey?: string): CohereEmbeddingProvider {
  const key = apiKey ?? process.env.COHERE_API_KEY ?? "";
  const provider = new CohereEmbeddingProvider({ apiKey: key });
  // Validação do contrato (dimensões > 0, etc.) antes de retornar.
  validateEmbeddingConfig(provider.getConfig());
  return provider;
}

/**
 * Erro tipado e sanitizado para uso em logs: nunca contém a API key.
 */
export function cohereFailureMessage(err: unknown): string {
  if (err instanceof Error) {
    return `Embedding failed: ${err.message}`;
  }
  return "Embedding failed: unknown error.";
}