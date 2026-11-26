export type JolpicaTransportErrorCode =
  | "TIMEOUT"
  | "NETWORK"
  | "HTTP"
  | "MALFORMED";

export class JolpicaError extends Error {
  readonly code: JolpicaTransportErrorCode;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;

  constructor(
    code: JolpicaTransportErrorCode,
    message: string,
    statusCode?: number,
    retryAfterMs?: number,
  ) {
    super(message);
    this.name = "JolpicaError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(10_000, Math.round(seconds * 1000));
  }
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    return Math.min(10_000, Math.max(0, date - Date.now()));
  }
  return undefined;
}

export const DEFAULT_JOLPICA_USER_AGENT =
  "f1-narrative-universe/5.0 (+https://github.com/vhraposo/f1-narrative-universe)";

export interface JolpicaTransportOptions {
  baseUrl: string;
  timeoutMs?: number;
  maxRetries?: number;
  minIntervalMs?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
}

export class JolpicaTransport {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly minIntervalMs: number;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private lastRequestAt = 0;

  constructor(options: JolpicaTransportOptions) {
    const raw = options.baseUrl.trim();
    this.baseUrl = raw.endsWith("/") ? raw : `${raw}/`;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 1;
    this.minIntervalMs = Math.max(0, options.minIntervalMs ?? 0);
    this.userAgent = options.userAgent?.trim() || DEFAULT_JOLPICA_USER_AGENT;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getJson(path: string): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    const attempts = this.maxRetries + 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        await this.pace();
        return await this.fetchOnce(url);
      } catch (error) {
        const retryable =
          error instanceof JolpicaError &&
          (error.statusCode === 429 ||
            error.statusCode === 408 ||
            (error.statusCode ?? 0) >= 500);
        if (!retryable || attempt === attempts - 1) {
          throw error;
        }
        const retryAfter =
          error instanceof JolpicaError ? error.retryAfterMs : undefined;
        const fallback =
          error instanceof JolpicaError && error.statusCode === 429
            ? 1000
            : 250 * (attempt + 1);
        await this.delay(retryAfter ?? fallback);
      }
    }
    throw new JolpicaError("NETWORK", "Falha inesperada no transporte Jolpica.");
  }

  private async fetchOnce(url: URL): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url.toString(), {
          headers: {
            Accept: "application/json",
            "User-Agent": this.userAgent,
          },
          signal: controller.signal,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new JolpicaError(
            "TIMEOUT",
            `Timeout ao consultar ${url.toString()}.`,
          );
        }
        throw new JolpicaError(
          "NETWORK",
          `Falha de rede ao consultar ${url.toString()}.`,
        );
      }

      if (!response.ok) {
        throw new JolpicaError(
          "HTTP",
          `Resposta HTTP ${response.status} de ${url.toString()}.`,
          response.status,
          parseRetryAfter(response.headers.get("retry-after")),
        );
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new JolpicaError(
          "MALFORMED",
          `Resposta não-JSON de ${url.toString()}.`,
        );
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  private async pace(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (wait > 0) {
      await this.delay(wait);
    }
    this.lastRequestAt = Date.now();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}