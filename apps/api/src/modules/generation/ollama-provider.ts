import {
  type GenerationProvider,
  type ProviderInput,
  type ProviderOutput,
  type TokenStats,
  countEmittedSections,
} from "./generation.assembly.js";

// ---------------------------------------------------------------------------
// Generation — Ollama Provider real (Fase 14 STEP 31).
//
// ADAPTER ISOLADO sobre a abstração `GenerationProvider`. Usa a API
// OpenAI-compatible do Ollama (`POST /v1/chat/completions`), `fetch` nativo +
// `AbortController`, SEM retry, SEM fallback, SEM streaming, SEM persistência,
// SEM acesso a DB/RAG.
//
// Segurança:
//   - Recebe input JÁ resolvido (systemPrompt + userPrompt). NUNCA consulta
//     Prisma/Conversation/Message/DB e NUNCA reinterpreta histórico/RAG.
//   - Não envia secrets, ids de DB, objetos RAG crus, vector/embedding.
//   - Erros/logs NUNCA contêm Authorization/api keys/credentials/prompts
//     completos/RAG content. Sanitiza credenciais de URL.
//   - Fail-closed: config inválida → erro explícito no construtor.
//
// Seleção: NÃO é o default do /craft (que segue NullProvider). Selecionável
// apenas via DI (passar na factory/orquestração), nunca via query param HTTP.
// ---------------------------------------------------------------------------

export const OLLAMA_PROVIDER = "ollama";

export const OLLAMA_BASE_URL = "http://localhost:11434";

/** Categorias de falha explícitas (itens 11/20). */
export type OllamaErrorCategory =
  | "configuration_invalid"
  | "timeout"
  | "abort"
  | "network"
  | "http"
  | "invalid_json"
  | "malformed_response"
  | "missing_choices"
  | "missing_message"
  | "missing_content"
  | "invalid_content"
  | "missing_user_prompt";

/**
 * Erro explícito do Ollama. `message` é SEMPRE sanitizado: contém provider,
 * categoria, HTTP status e URL sem credenciais — jamais secrets/prompts/body.
 */
export class OllamaProviderError extends Error {
  readonly category: OllamaErrorCategory;
  readonly httpStatus?: number;
  readonly provider = OLLAMA_PROVIDER;

  constructor(category: OllamaErrorCategory, detail: string, httpStatus?: number) {
    super(`Ollama provider ${category}${httpStatus ? ` (HTTP ${httpStatus})` : ""}: ${detail}`);
    this.name = "OllamaProviderError";
    this.category = category;
    this.httpStatus = httpStatus;
  }
}

export interface OllamaProviderConfig {
  /** Base URL do servidor Ollama (ex.: http://localhost:11434). Configurável. */
  readonly baseUrl?: string;
  /** Modelo a usar (ex.: llama3.2). Obrigatório. */
  readonly model: string;
  /** Timeout HTTP em ms. Obrigatório (>0). */
  readonly timeoutMs: number;
  /** Request factory injetável (testes). Default: fetch global. */
  readonly fetchImpl?: typeof fetch;
}

interface OllamaChatCompletion {
  choices?: Array<{
    message?: { role?: unknown; content?: unknown };
  }>;
  usage?: unknown;
}

function stripCredentials(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.username = "";
    u.password = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return rawUrl;
  }
}

/** Semântica do endpoint OpenAI-compatible usado (itens 1). */
export function ollamaChatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
}

/**
 * Provider real de geração via Ollama (OpenAI-compatible). Puro em relação ao
 * domínio de negócio: recebe systemPrompt + userPrompt e devolve texto.
 */
export class OllamaProvider implements GenerationProvider {
  readonly name = OLLAMA_PROVIDER;

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OllamaProviderConfig) {
    if (!config.model || config.model.trim().length === 0) {
      throw new OllamaProviderError(
        "configuration_invalid",
        "OLLAMA_MODEL ausente ou vazio. Modelo é obrigatório.",
      );
    }
    if (!config.timeoutMs || !Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0) {
      throw new OllamaProviderError(
        "configuration_invalid",
        "Timeout inválido. OLLAMA_TIMEOUT_MS deve ser maior que zero.",
      );
    }
    let baseUrl = config.baseUrl ?? OLLAMA_BASE_URL;
    try {
      // nova URL apenas para validar; mantemos a string original (sem creds em erro)
      new URL(baseUrl);
    } catch {
      throw new OllamaProviderError(
        "configuration_invalid",
        "OLLAMA_BASE_URL inválida. Deve ser uma URL válida.",
      );
    }
    this.baseUrl = baseUrl;
    this.model = config.model;
    this.timeoutMs = config.timeoutMs;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  getEndpointsForLogging(): { baseUrl: string; completions: string } {
    return {
      baseUrl: stripCredentials(this.baseUrl),
      completions: stripCredentials(ollamaChatCompletionsUrl(this.baseUrl)),
    };
  }

  async run(input: ProviderInput): Promise<ProviderOutput> {
    // Geração real exige o input atual do usuário (contrato STEP 30). NUNCA
    // derivar de recentMessages/histórico no provider.
    if (
      input.userPrompt === undefined ||
      input.userPrompt.trim().length === 0
    ) {
      throw new OllamaProviderError(
        "missing_user_prompt",
        "Geração real requer um userPrompt explícito e não vazio.",
      );
    }

    const completion = await this.request(input.systemPrompt, input.userPrompt);
    const text = this.extractText(completion);

    const tokenStats = this.tokenStats(input.systemPrompt);
    return {
      provider: this.name,
      mode: "generated",
      text,
      tokenStats,
    };
  }

  // -------------------------------------------------------------------------
  // Transport (fetch nativo + AbortController, padrão Cohere)
  // -------------------------------------------------------------------------
  private async request(systemPrompt: string, userPrompt: string): Promise<OllamaChatCompletion> {
    const endpoint = ollamaChatCompletionsUrl(this.baseUrl);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      let res: Response;
      try {
        res = await this.fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            stream: false,
          }),
          signal: controller.signal,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          if (timedOut) {
            throw new OllamaProviderError(
              "timeout",
              "A requisição atingiu o timeout e foi cancelada.",
              undefined,
            );
          }
          throw new OllamaProviderError("abort", "A requisição foi abortada.", undefined);
        }
        throw new OllamaProviderError(
          "network",
          "Falha de conexão/network ao acessar o servidor Ollama.",
          undefined,
        );
      }

      if (!res.ok) {
        // NUNCA incluir body/envio sensível no erro; só status + categoria.
        throw new OllamaProviderError("http", "Resposta não-2xx do servidor Ollama.", res.status);
      }

      let parsed: unknown;
      try {
        parsed = await res.json();
      } catch {
        throw new OllamaProviderError("invalid_json", "Resposta não é JSON válido.", undefined);
      }

      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new OllamaProviderError(
          "malformed_response",
          "Resposta JSON não é o objeto esperado.",
          undefined,
        );
      }
      return parsed as OllamaChatCompletion;
    } finally {
      clearTimeout(timer);
    }
  }

  // -------------------------------------------------------------------------
  // Parsing da resposta OpenAI-compatible (itens 7/8)
  // -------------------------------------------------------------------------
  private extractText(completion: OllamaChatCompletion): string {
    const choices = completion.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new OllamaProviderError("missing_choices", "Resposta sem `choices`.", undefined);
    }
    const first = choices[0];
    if (first === null || typeof first !== "object" || first.message === undefined) {
      throw new OllamaProviderError("missing_message", "choice sem `message`.", undefined);
    }
    const content = first.message.content;
    if (content === undefined || content === null) {
      throw new OllamaProviderError("missing_content", "message sem `content`.", undefined);
    }
    if (typeof content !== "string") {
      throw new OllamaProviderError("invalid_content", "`content` não é string.", undefined);
    }
    // Contrato (STEP 28): mode="generated" exige text string; sem nova política
    // de string vazia neste STEP — valida-se apenas o tipo/presença.
    return content;
  }

  // tokenStats preserve o contrato determinístico (mesma fórmula do NullProvider);
  // NÃO mapeia usage nativo do Ollama (incompatível com TokenStats não-runtime).
  private tokenStats(systemPrompt: string): TokenStats {
    return {
      systemPromptChars: systemPrompt.length,
      contextBlocks: countEmittedSections(systemPrompt),
    };
  }
}

/**
 * Fábrica a partir do ambiente. Segue a convenção do provider Cohere (lê
 * process.env na factory, sem tornar o Ollama necessário no startup): lê
 * OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT_MS. Fail-closed se MODEL/TIMEOUT
 * ausentes. Ollama NÃO é default do /craft — usado via DI.
 */
export function createOllamaProviderFromEnv(): OllamaProvider {
  const baseUrl = process.env.OLLAMA_BASE_URL;
  const model = process.env.OLLAMA_MODEL;
  const timeoutRaw = process.env.OLLAMA_TIMEOUT_MS;

  const timeoutMs =
    timeoutRaw !== undefined && timeoutRaw.trim().length > 0
      ? Number(timeoutRaw)
      : 30_000;

  if (!model || model.trim().length === 0) {
    throw new OllamaProviderError(
      "configuration_invalid",
      "OLLAMA_MODEL não configurado no ambiente.",
    );
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new OllamaProviderError(
      "configuration_invalid",
      "OLLAMA_TIMEOUT_MS inválido no ambiente.",
    );
  }

  return new OllamaProvider({ baseUrl, model, timeoutMs });
}
