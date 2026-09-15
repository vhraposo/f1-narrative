export type OpenF1ErrorCode =
  | "TIMEOUT"
  | "NETWORK"
  | "HTTP"
  | "MALFORMED";

export class OpenF1Error extends Error {
  readonly code: OpenF1ErrorCode;
  readonly statusCode?: number;

  constructor(code: OpenF1ErrorCode, message: string, statusCode?: number) {
    super(message);
    this.name = "OpenF1Error";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface OpenF1TransportOptions {
  baseUrl: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

export class OpenF1Transport {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenF1TransportOptions) {
    const raw = options.baseUrl.trim();
    this.baseUrl = raw.endsWith("/") ? raw : `${raw}/`;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 1;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getJson(query: string): Promise<unknown> {
    const url = new URL(query, this.baseUrl);
    const attempts = this.maxRetries + 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await this.fetchOnce(url);
      } catch (error) {
        const retryable =
          error instanceof OpenF1Error &&
          (error.statusCode === 429 || (error.statusCode ?? 0) >= 500);
        if (!retryable || attempt === attempts - 1) {
          throw error;
        }
        await this.delay(250 * (attempt + 1));
      }
    }
    throw new OpenF1Error("NETWORK", "Falha inesperada no transporte OpenF1.");
  }

  private async fetchOnce(url: URL): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url.toString(), {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new OpenF1Error(
            "TIMEOUT",
            `Timeout ao consultar ${url.toString()}.`,
          );
        }
        throw new OpenF1Error(
          "NETWORK",
          `Falha de rede ao consultar ${url.toString()}.`,
        );
      }

      if (!response.ok) {
        throw new OpenF1Error(
          "HTTP",
          `Resposta HTTP ${response.status} de ${url.toString()}.`,
          response.status,
        );
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new OpenF1Error(
          "MALFORMED",
          `Resposta não-JSON de ${url.toString()}.`,
        );
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}