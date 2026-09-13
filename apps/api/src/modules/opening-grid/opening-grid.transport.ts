export type OpeningGridTransportErrorCode =
  | "TIMEOUT"
  | "NETWORK"
  | "HTTP"
  | "MALFORMED";

export class OpeningGridError extends Error {
  readonly code: OpeningGridTransportErrorCode;
  readonly statusCode?: number;

  constructor(code: OpeningGridTransportErrorCode, message: string, statusCode?: number) {
    super(message);
    this.name = "OpeningGridError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface OpeningGridTransportOptions {
  baseUrl: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

export class OpeningGridTransport {
  readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpeningGridTransportOptions) {
    const raw = options.baseUrl.trim();
    this.baseUrl = raw.endsWith("/") ? raw : `${raw}/`;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 1;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getJson(path: string): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    const attempts = this.maxRetries + 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await this.fetchOnce(url);
      } catch (error) {
        const retryable =
          error instanceof OpeningGridError &&
          (error.statusCode === 429 || (error.statusCode ?? 0) >= 500);
        if (!retryable || attempt === attempts - 1) {
          throw error;
        }
        await this.delay(250 * (attempt + 1));
      }
    }
    throw new OpeningGridError("NETWORK", "Falha inesperada no transporte Opening Grid.");
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
          throw new OpeningGridError(
            "TIMEOUT",
            `Timeout ao consultar ${url.toString()}.`,
          );
        }
        throw new OpeningGridError(
          "NETWORK",
          `Falha de rede ao consultar ${url.toString()}.`,
        );
      }

      if (!response.ok) {
        throw new OpeningGridError(
          "HTTP",
          `Resposta HTTP ${response.status} de ${url.toString()}.`,
          response.status,
        );
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new OpeningGridError(
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