import { describe, expect, it } from "vitest";
import {
  COHERE_DIMENSIONS,
  COHERE_INPUT_DOCUMENT,
  COHERE_INPUT_QUERY,
  COHERE_MODEL,
  COHERE_PROVIDER,
  COHERE_VERSION,
  CohereEmbeddingProvider,
  createCohereProviderFromEnv,
  cohereFailureMessage,
} from "./external-embedding-provider.js";

// Testes de UNIDADE do provider Cohere (Fase 13 STEP 7).
// NUNCA fazem chamada HTTP real: injetamos `fetchImpl` para simular respostas
// da API (sucesso, dimensÃ£o errada, NaN, 4xx, 5xx, timeout).

function vec(dims: number, fill: number): number[] {
  return Array.from({ length: dims }, () => fill);
}

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function okBody(vector: number[]) {
  return {
    embeddings: { float: [vector] },
    id: "req-1",
    response_type: "embeddings_floats",
  };
}

function makeFetch(reply: (init: RequestInit, url: string) => Response | Promise<Response>) {
  return async (info: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = String(info);
    return reply(init ?? {}, url);
  };
}

function providerWith(): {
  provider: CohereEmbeddingProvider;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const fetcher = makeFetch((init) => {
    const body = JSON.parse(String(init.body));
    requests.push({
      url: "https://api.cohere.com/v2/embed",
      method: (init.method ?? "POST").toUpperCase(),
      headers: (init.headers ?? {}) as Record<string, string>,
      body,
    });
    return new Response(JSON.stringify(okBody(vec(COHERE_DIMENSIONS, 0.1))), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { provider: new CohereEmbeddingProvider({ apiKey: "sk-test-123", fetchImpl: fetcher }), requests };
}

describe("CohereEmbeddingProvider", () => {
  it("A) identidade do provider Ã© cohere / embed-multilingual-v3.0 / v3.0 / 1024", () => {
    const p = new CohereEmbeddingProvider({ apiKey: "sk-test", fetchImpl: fetch });
    expect(p.name).toBe(COHERE_PROVIDER);
    expect(p.model).toBe(COHERE_MODEL);
    expect(p.version).toBe(COHERE_VERSION);
    expect(p.dimensions).toBe(COHERE_DIMENSIONS);
    expect(p.getConfig()).toEqual({
      provider: "cohere",
      model: "embed-multilingual-v3.0",
      version: "v3.0",
      dimensions: 1024,
    });
  });

  it("B) falha fechada se API key ausente ou vazia (nunca fallback)", () => {
    expect(() => new CohereEmbeddingProvider({ apiKey: "" })).toThrow(/COHERE_API_KEY/);
    expect(() => new CohereEmbeddingProvider({ apiKey: "   " })).toThrow(/COHERE_API_KEY/);
    expect(() => createCohereProviderFromEnv(undefined)).toThrow(/COHERE_API_KEY/);
  });

  it("C) embed vÃ¡lido retorna vetor de 1024 dimensÃµes", async () => {
    const { provider } = providerWith();
    const v = await provider.embed("um texto qualquer");
    expect(v).toHaveLength(COHERE_DIMENSIONS);
  });

  it("D) envia input_type=search_document para docs e search_query para queries", async () => {
    const { provider, requests } = providerWith();
    await provider.embed("doc", COHERE_INPUT_DOCUMENT);
    await provider.embed("query", COHERE_INPUT_QUERY);
    expect(requests).toHaveLength(2);
    expect(requests[0].body).toMatchObject({ input_type: "search_document" });
    expect(requests[1].body).toMatchObject({ input_type: "search_query" });
  });

  it("E) envia model, embedding_types float e output_dimension 1024", async () => {
    const { provider, requests } = providerWith();
    await provider.embed("x", COHERE_INPUT_DOCUMENT);
    expect(requests[0].body).toMatchObject({
      model: COHERE_MODEL,
      embedding_types: ["float"],
      output_dimension: 1024,
    });
  });

  it("F) Authorization Bearer Ã© enviado com a key (server-side)", async () => {
    const { provider, requests } = providerWith();
    await provider.embed("x", COHERE_INPUT_DOCUMENT);
    const auth = requests[0].headers.Authorization ?? requests[0].headers.authorization;
    expect(auth).toBe("Bearer sk-test-123");
  });

  it("G) rejeita dimensÃ£o diferente de 1024 (gate de dimensÃ£o)", async () => {
    const fetcher = makeFetch(() =>
      new Response(JSON.stringify(okBody(vec(8, 1))), { status: 200 }),
    );
    const p = new CohereEmbeddingProvider({ apiKey: "sk", fetchImpl: fetcher });
    await expect(p.embed("x", COHERE_INPUT_DOCUMENT)).rejects.toThrow(/dimensions mismatch/);
  });

  it("H) rejeita valor nÃ£o-finito (NaN / Infinity)", async () => {
    const bad = Array.from({ length: COHERE_DIMENSIONS }, (_, i) => (i === 3 ? NaN : 0.5));
    const fetcher = makeFetch(() =>
      new Response(JSON.stringify(okBody(bad)), { status: 200 }),
    );
    const p = new CohereEmbeddingProvider({ apiKey: "sk", fetchImpl: fetcher });
    await expect(p.embed("x", COHERE_INPUT_DOCUMENT)).rejects.toThrow(/non-finite/);
  });

  it("I) rejeita resposta sem embedding vÃ¡lido", async () => {
    const fetcher = makeFetch(() =>
      new Response(JSON.stringify({ embeddings: { float: [] } }), { status: 200 }),
    );
    const p = new CohereEmbeddingProvider({ apiKey: "sk", fetchImpl: fetcher });
    await expect(p.embed("x", COHERE_INPUT_DOCUMENT)).rejects.toThrow(/without a valid embedding/);
  });

  it("J) HTTP 4xx e 5xx â†’ erro explÃ­cito", async () => {
    for (const status of [400, 401, 429, 500, 503]) {
      const fetcher = makeFetch(() =>
        new Response("erro", { status }),
      );
      const p = new CohereEmbeddingProvider({ apiKey: "sk", fetchImpl: fetcher });
      await expect(p.embed("x", COHERE_INPUT_DOCUMENT)).rejects.toThrow(`HTTP ${status}`);
    }
  });

  it("K) timeout (abort) â†’ erro explÃ­cito 'timeout'", async () => {
    const fetcher = makeFetch(() => {
      const ctrl = new AbortController();
      ctrl.abort();
      return Promise.reject(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      );
    });
    const p = new CohereEmbeddingProvider({ apiKey: "sk", fetchImpl: fetcher, timeoutMs: 5 });
    await expect(p.embed("x", COHERE_INPUT_DOCUMENT)).rejects.toThrow(/timeout/);
  });

  it("L) network error â†’ erro sanitizado (nunca vaza a key)", async () => {
    const fetcher = makeFetch(() => Promise.reject(new Error("ECONNRESET")));
    const p = new CohereEmbeddingProvider({ apiKey: "sk-super-secret", fetchImpl: fetcher });
    const msg = cohereFailureMessage(await p.embed("x", COHERE_INPUT_DOCUMENT).catch((e) => e));
    expect(msg).not.toContain("sk-super-secret");
    expect(msg).toMatch(/Embedding failed/);
  });

  it("M) mensagem de erro sanitizada nÃ£o contÃ©m a key", () => {
    const msg = cohereFailureMessage(new Error("http 401"));
    expect(msg).not.toContain("sk-");
  });
});
