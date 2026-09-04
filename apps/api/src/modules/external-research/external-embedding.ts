// ---------------------------------------------------------------------------
// External Research — Abstração de Provider de Embeddings (Fase 13 STEP 5;
// atualizado no STEP 7 com a decisão final).
//
// SERVICE-ONLY: não cria endpoint, não toca frontend/Conversation.
// Define QUAL componente transforma um Chunk em um vetor. Neste arquivo fica a
// abstração (interface, registry, identidade, validade); o provider REAL e o
// STORE são implementados nos arquivos externos do STEP 7:
//   - external-embedding-provider.ts → Cohere (embed-multilingual-v3.0, 1024)
//   - external-embedding-store.ts    → gera + persiste o vetor em ExternalChunk
//
// ## Provider Decision (decisão legítima — STEP 6/7)
//   EMBEDDING PROVIDER = COHERE
//   model      = embed-multilingual-v3.0
//   version    = v3.0
//   dimensions = 1024
//   métrica    = cosine
//
// ## Embedding Identity
//   A identidade de um embedding é determinada por:
//     contentHash + provider + model + version + dimensions
//   Mudança em qualquer campo invalida o embedding anterior.
//
// ## Schema Gap (RESOLVIDO no STEP 7)
//   O campo `embeddedContentHash` foi ADICIONADO ao schema + migration
//   (20260903021826_f13_external_vector) juntamente com `embedding
//   vector(1024)`. O gap registrado no STEP 5 está resolvido.
// ---------------------------------------------------------------------------

export const EXTERNAL_EMBEDDING_RULE = "external-embedding.v1#mode=abstract#scope=service";

/**
 * Status do provider de embeddings. Agora RESOLVIDO: o provider legítimo foi
 * decidido (Cohere embed-multilingual-v3.0, 1024 dims, cosine) e implementado
 * no STEP 7. Ver `external-embedding-provider.ts`.
 */
export const EMBEDDING_PROVIDER_STATUS = "RESOLVED" as const;

/**
 * Schema gap `embeddedContentHash` — RESOLVIDO no STEP 7: a coluna existe no
 * schema e foi criada pela migration f13_external_vector.
 */
export const EMBEDDED_CONTENT_HASH_SCHEMA_GAP = "RESOLVED" as const;

// ---------------------------------------------------------------------------
// Contrato de configuração
// ---------------------------------------------------------------------------

/**
 * Configuração de um provider de embeddings. Todos os campos são obrigatórios.
 * O provider Cohere (STEP 7) é validado com este contrato (dims=1024).
 */
export interface EmbeddingConfig {
  readonly provider: string;
  readonly model: string;
  readonly version: string;
  readonly dimensions: number;
}

export function validateEmbeddingConfig(config: EmbeddingConfig): void {
  if (!config.provider || config.provider.trim().length === 0) {
    throw new Error("Embedding config rejeitada: 'provider' é obrigatório.");
  }
  if (!config.model || config.model.trim().length === 0) {
    throw new Error("Embedding config rejeitada: 'model' é obrigatório.");
  }
  if (!config.version || config.version.trim().length === 0) {
    throw new Error("Embedding config rejeitada: 'version' é obrigatório.");
  }
  if (!Number.isInteger(config.dimensions) || config.dimensions <= 0) {
    throw new Error("Embedding config rejeitada: 'dimensions' deve ser um inteiro > 0.");
  }
}

// ---------------------------------------------------------------------------
// Embedding Provider Interface
// ---------------------------------------------------------------------------

/**
 * Interface de um provider de embeddings. Cada implementação concreta (OpenAI,
 * Cohere, etc.) fornece `embed(text) → vector`. O `NullEmbeddingProvider`
 * lança erro — serve como sentinel de "provider não configurado".
 *
 * O provider REAL decidido (Cohere embed-multilingual-v3.0, 1024 dims) é
 * implementado em `external-embedding-provider.ts`.
 */
export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly version: string;
  readonly dimensions: number;

  /**
   * Gera o embedding vetorial de um texto. Neste STEP, apenas o
   * `NullEmbeddingProvider` é implementado — sempre lança erro.
   */
  embed(input: string): Promise<number[]>;
}

// ---------------------------------------------------------------------------
// Null / Mock Provider (para testes)
// ---------------------------------------------------------------------------

/**
 * Provider sentinela que lança erro ao tentar embed. Usado como placeholder
 * quando nenhum provider real foi configurado. NÃO gera vetor sintético;
 * NÃO faz chamada externa; NÃO persiste nada.
 */
export class NullEmbeddingProvider implements EmbeddingProvider {
  readonly name = "null";
  readonly model = "none";
  readonly version = "0.0.0";
  readonly dimensions = 0;

  async embed(_input: string): Promise<number[]> { // eslint-disable-line @typescript-eslint/no-unused-vars
    throw new Error("Embedding provider not configured.");
  }
}

// ---------------------------------------------------------------------------
// Provider Registry
// ---------------------------------------------------------------------------

type ProviderFactory = (config: EmbeddingConfig) => EmbeddingProvider;

/**
 * Registra um provider pelo nome. Erro se o provider já existe ou se o
 * nome é vazio. Não há fallback silencioso.
 */
export function createProviderRegistry(): Map<string, ProviderFactory> {
  return new Map<string, ProviderFactory>();
}

/**
 * Registra um provider na registry. Lança erro se o nome já está registrado
 * ou se é vazio.
 */
export function registerProvider(
  registry: Map<string, ProviderFactory>,
  name: string,
  factory: ProviderFactory,
): void {
  if (!name || name.trim().length === 0) {
    throw new Error("Provider registry: nome do provider não pode ser vazio.");
  }
  if (registry.has(name)) {
    throw new Error(`Provider registry: '${name}' já registrado.`);
  }
  registry.set(name, factory);
}

/**
 * Obtém um provider da registry pela configuração. Lança erro se o provider
 * não está registrado (desconhecido). Não faz fallback silencioso.
 */
export function getEmbeddingProvider(
  registry: Map<string, ProviderFactory>,
  config: EmbeddingConfig,
): EmbeddingProvider {
  const factory = registry.get(config.provider);
  if (!factory) {
    throw new Error(`Embedding provider '${config.provider}' desconhecido.`);
  }
  return factory(config);
}

// ---------------------------------------------------------------------------
// Embedding Identity
// ---------------------------------------------------------------------------

/**
 * Identidade imutável e determinística de um embedding. Representa a
 * combinação exata que produziu (ou produziria) o vetor. Qualquer mudança
 * em qualquer campo invalida o embedding anterior.
 *
 * Campos:
 *   contentHash — identifica o CONTEÚDO representado (chunk contentHash)
 *   provider    — qual sistema gerou o embedding
 *   model       — qual modelo específico dentro do provider
 *   version     — versão do modelo (reproducibilidade)
 *   dimensions  — dimensão do vetor resultante
 */
export interface EmbeddingIdentity {
  readonly contentHash: string;
  readonly provider: string;
  readonly model: string;
  readonly version: string;
  readonly dimensions: number;
}

/**
 * Constrói a identidade de embedding de forma determinística e pura.
 * Mesma entrada → mesma identidade; entrada diferente → identidade diferente.
 */
export function buildEmbeddingIdentity(
  contentHash: string,
  config: EmbeddingConfig,
): EmbeddingIdentity {
  return Object.freeze({
    contentHash,
    provider: config.provider,
    model: config.model,
    version: config.version,
    dimensions: config.dimensions,
  });
}

// ---------------------------------------------------------------------------
// Embedding Validity
// ---------------------------------------------------------------------------

export interface EmbeddingValidity {
  readonly valid: boolean;
  readonly reason?: string;
}

/**
 * Verifica se um embedding (representado pela sua identidade) continua válido
 * face ao conteúdo atual de um chunk e à configuração desejada.
 *
 * Regras:
 *   - contentHash diferente  → embedding anterior inválido
 *   - provider diferente     → invalida
 *   - model diferente        → invalida
 *   - version diferente      → invalida
 *   - dimensions diferente   → invalida
 */
export function isEmbeddingValid(
  identity: EmbeddingIdentity,
  currentContentHash: string,
  currentConfig: EmbeddingConfig,
): EmbeddingValidity {
  if (identity.contentHash !== currentContentHash) {
    return Object.freeze({ valid: false, reason: "contentHash changed" });
  }
  if (identity.provider !== currentConfig.provider) {
    return Object.freeze({ valid: false, reason: "provider mismatch" });
  }
  if (identity.model !== currentConfig.model) {
    return Object.freeze({ valid: false, reason: "model mismatch" });
  }
  if (identity.version !== currentConfig.version) {
    return Object.freeze({ valid: false, reason: "version mismatch" });
  }
  if (identity.dimensions !== currentConfig.dimensions) {
    return Object.freeze({ valid: false, reason: "dimensions mismatch" });
  }
  return Object.freeze({ valid: true });
}