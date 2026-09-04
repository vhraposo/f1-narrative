import { describe, expect, it } from "vitest";
import type { AssembledContext } from "../context/context.assembly.js";
import { nullProvider, type ProviderInput } from "./generation.assembly.js";
import {
  OllamaProvider,
  OllamaProviderError,
  OLLAMA_PROVIDER,
  ollamaChatCompletionsUrl,
} from "./ollama-provider.js";

// ---------------------------------------------------------------------------
// Fase 14 STEP 31 — Ollama Provider real (unitário). NUNCA faz chamadas reais
// ao Ollama: fetchImpl é injetado. O provider é puro — não lê Prisma/DB/RAG e
// não toca `context`; `input.context` abaixo é um placeholder tipado por cast.
// ---------------------------------------------------------------------------

function unitInput(systemPrompt: string, userPrompt: string): ProviderInput {
  return {
    // O provider NÃO lê context (isolation STEP 31 item 15/17); placeholder.
    context: {
      recentMessages: [],
    } as unknown as AssembledContext,
    systemPrompt,
    userPrompt,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function providerWith(
  fetchImpl: typeof fetch,
  opts: { timeoutMs?: number; model?: string; baseUrl?: string } = {},
): OllamaProvider {
  return new OllamaProvider({
    model: opts.model ?? "test-model",
    timeoutMs: opts.timeoutMs ?? 5000,
    baseUrl: opts.baseUrl ?? "http://localhost:11434",
    fetchImpl,
  });
}

const SYSP = "system prompt secreto-TOKEN";
const USERP = "user prompt secreto-TOKEN";

type SeenInit = { body: string; signal?: unknown; headers?: Record<string, string> };
type SeenRequest = { url: string; init: SeenInit };

function captureRequest(
  onFetch: (url: string, init: SeenInit) => Promise<Response>,
): { spy: typeof fetch; get: () => SeenRequest } {
  let seen: SeenRequest = { url: "", init: { body: "" } };
  const spy = (async (input: unknown, init?: unknown) => {
    const url = String(input);
    const seenInit = (init ?? {}) as SeenInit;
    seen = { url, init: seenInit };
    return onFetch(url, seenInit);
  }) as typeof fetch;
  return { spy, get: () => seen };
}

const OK_COMPLETION = {
  choices: [{ message: { role: "assistant", content: "resposta do modelo" } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

describe("OllamaProvider - resposta normalizada", () => {
  it("A) configuração válida cria um OllamaProvider", () => {
    const p = new OllamaProvider({ model: "m", timeoutMs: 1000 });
    expect(p.name).toBe(OLLAMA_PROVIDER);
  });

  it("B) base URL é usada para compor o endpoint /v1/chat/completions", async () => {
    const rec = captureRequest(() => Promise.resolve(jsonResponse(OK_COMPLETION)));
    const p = providerWith(rec.spy, { baseUrl: "http://localhost:11434" });
    await p.run(unitInput(SYSP, USERP));
    expect(rec.get().url).toBe("http://localhost:11434/v1/chat/completions");
  });

  it("C) model é enviado no body", async () => {
    const rec = captureRequest(() => Promise.resolve(jsonResponse(OK_COMPLETION)));
    const p = providerWith(rec.spy, { model: "llama3.2" });
    await p.run(unitInput(SYSP, USERP));
    expect(JSON.parse(rec.get().init.body).model).toBe("llama3.2");
  });

  it("E) systemPrompt vai como role system (preservado)", async () => {
    const rec = captureRequest(() => Promise.resolve(jsonResponse(OK_COMPLETION)));
    const p = providerWith(rec.spy);
    await p.run(unitInput(SYSP, USERP));
    expect(JSON.parse(rec.get().init.body).messages[0]).toEqual({
      role: "system",
      content: SYSP,
    });
  });

  it("F) userPrompt vai como role user (preservado)", async () => {
    const rec = captureRequest(() => Promise.resolve(jsonResponse(OK_COMPLETION)));
    const p = providerWith(rec.spy);
    await p.run(unitInput(SYSP, USERP));
    expect(JSON.parse(rec.get().init.body).messages[1]).toEqual({
      role: "user",
      content: USERP,
    });
  });

  it("G) roles system/user corretas e ordem correta", async () => {
    const rec = captureRequest(() => Promise.resolve(jsonResponse(OK_COMPLETION)));
    const p = providerWith(rec.spy);
    await p.run(unitInput(SYSP, USERP));
    const messages = JSON.parse(rec.get().init.body).messages as Array<{ role: string }>;
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(messages.length).toBe(2);
  });

  it("H) stream=false", async () => {
    const rec = captureRequest(() => Promise.resolve(jsonResponse(OK_COMPLETION)));
    const p = providerWith(rec.spy);
    await p.run(unitInput(SYSP, USERP));
    expect(JSON.parse(rec.get().init.body).stream).toBe(false);
  });

  it("I) resposta válida retorna mode=generated", async () => {
    const rec = captureRequest(() => Promise.resolve(jsonResponse(OK_COMPLETION)));
    const p = providerWith(rec.spy);
    const out = await p.run(unitInput(SYSP, USERP));
    expect(out.mode).toBe("generated");
    expect(out.provider).toBe(OLLAMA_PROVIDER);
  });

  it("J) text preservado de choices[0].message.content", async () => {
    const rec = captureRequest(() => Promise.resolve(jsonResponse(OK_COMPLETION)));
    const p = providerWith(rec.spy);
    const out = await p.run(unitInput(SYSP, USERP));
    if (out.mode === "generated") {
      expect(out.text).toBe("resposta do modelo");
    } else {
      throw new Error("esperava generated");
    }
  });

  it("K) usage presente não quebra (tokenStats determinístico preservado)", async () => {
    const rec = captureRequest(() => Promise.resolve(jsonResponse(OK_COMPLETION)));
    const p = providerWith(rec.spy);
    const out = await p.run(unitInput(SYSP, USERP));
    if (out.mode === "generated") {
      expect(out.tokenStats.systemPromptChars).toBe(SYSP.length);
      expect(typeof out.tokenStats.contextBlocks).toBe("number");
    }
  });

  it("L) usage ausente funciona (sem inventar números)", async () => {
    const completionNoUsage = { choices: [{ message: { role: "assistant", content: "ok" } }] };
    const rec = captureRequest(() => Promise.resolve(jsonResponse(completionNoUsage)));
    const p = providerWith(rec.spy);
    const out = await p.run(unitInput(SYSP, USERP));
    if (out.mode === "generated") {
      expect(out.text).toBe("ok");
      expect(out.tokenStats.systemPromptChars).toBe(SYSP.length);
    }
  });
});

describe("OllamaProvider - validação de resposta", () => {
  it("M) malformed JSON -> invalid_json", async () => {
    const badFetch = (async () => {
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("bad");
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const p = new OllamaProvider({ model: "m", timeoutMs: 1000, fetchImpl: badFetch });
    await expect(p.run(unitInput(SYSP, USERP))).rejects.toMatchObject({
      category: "invalid_json",
    });
  });

  it("N) choices ausente -> missing_choices", async () => {
    const rec = captureRequest(() => Promise.resolve(jsonResponse({ foo: 1 })));
    const p = providerWith(rec.spy);
    await expect(p.run(unitInput(SYSP, USERP))).rejects.toMatchObject({
      category: "missing_choices",
    });
  });

  it("N2) choices vazio -> missing_choices", async () => {
    const rec = captureRequest(() => Promise.resolve(jsonResponse({ choices: [] })));
    const p = providerWith(rec.spy);
    await expect(p.run(unitInput(SYSP, USERP))).rejects.toMatchObject({
      category: "missing_choices",
    });
  });

  it("O) message ausente -> missing_message", async () => {
    const rec = captureRequest(() => Promise.resolve(jsonResponse({ choices: [{}] })));
    const p = providerWith(rec.spy);
    await expect(p.run(unitInput(SYSP, USERP))).rejects.toMatchObject({
      category: "missing_message",
    });
  });

  it("P) content ausente -> missing_content", async () => {
    const rec = captureRequest(() =>
      Promise.resolve(jsonResponse({ choices: [{ message: {} }] })),
    );
    const p = providerWith(rec.spy);
    await expect(p.run(unitInput(SYSP, USERP))).rejects.toMatchObject({
      category: "missing_content",
    });
  });

  it("Q) content não-string -> invalid_content", async () => {
    const rec = captureRequest(() =>
      Promise.resolve(jsonResponse({ choices: [{ message: { content: 123 } }] })),
    );
    const p = providerWith(rec.spy);
    await expect(p.run(unitInput(SYSP, USERP))).rejects.toMatchObject({
      category: "invalid_content",
    });
  });

  it("R) HTTP 400 -> http com status", async () => {
    const rec = captureRequest(() => Promise.resolve(jsonResponse({ error: "x" }, 400)));
    const p = providerWith(rec.spy);
    await expect(p.run(unitInput(SYSP, USERP))).rejects.toMatchObject({
      category: "http",
      httpStatus: 400,
    });
  });

  it("S) HTTP 404 -> http", async () => {
    const rec = captureRequest(() => Promise.resolve(jsonResponse({ error: "no" }, 404)));
    const p = providerWith(rec.spy);
    await expect(p.run(unitInput(SYSP, USERP))).rejects.toMatchObject({
      category: "http",
      httpStatus: 404,
    });
  });

  it("T) HTTP 500 -> http", async () => {
    const rec = captureRequest(() => Promise.resolve(jsonResponse({ error: "boom" }, 500)));
    const p = providerWith(rec.spy);
    await expect(p.run(unitInput(SYSP, USERP))).rejects.toMatchObject({
      category: "http",
      httpStatus: 500,
    });
  });
});

describe("OllamaProvider - transport e erro", () => {
  it("U) timeout aborta com AbortController (fetch não responde)", async () => {
    const hangingFetch = (async (_input: unknown, init?: unknown) => {
      const signal = (init as { signal?: { addEventListener: (t: string, fn: () => void) => void } })
        .signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    }) as unknown as typeof fetch;
    const p = new OllamaProvider({ model: "m", timeoutMs: 20, fetchImpl: hangingFetch });
    await expect(p.run(unitInput(SYSP, USERP))).rejects.toMatchObject({ category: "timeout" });
  });

  it("V) connection/network error -> network", async () => {
    const failingFetch = (async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
    const p = new OllamaProvider({ model: "m", timeoutMs: 1000, fetchImpl: failingFetch });
    await expect(p.run(unitInput(SYSP, USERP))).rejects.toMatchObject({ category: "network" });
  });

  it("W) AbortError externo -> abort (não confundido com timeout)", async () => {
    const abortFetch = (async () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    }) as unknown as typeof fetch;
    const p = new OllamaProvider({ model: "m", timeoutMs: 1000, fetchImpl: abortFetch });
    await expect(p.run(unitInput(SYSP, USERP))).rejects.toMatchObject({ category: "abort" });
  });

  it("Y/X) erro não expõe prompts completos nem segredos", async () => {
    const systemSecret = "SYSTEM-SECRET-VALUE-123";
    const userSecret = "USER-SECRET-VALUE-456";
    const rec = captureRequest(() => Promise.resolve(jsonResponse({ error: "x" }, 500)));
    const p = providerWith(rec.spy);
    const sysp = `system ${systemSecret} ${SYSP}`;
    const userp = `user ${userSecret} ${USERP}`;
    let err: unknown;
    try {
      await p.run(unitInput(sysp, userp));
    } catch (e) {
      err = e;
    }
    const msg = (err as OllamaProviderError).message;
    expect(msg).not.toContain(systemSecret);
    expect(msg).not.toContain(userSecret);
    expect(msg).not.toContain(SYSP);
    expect(msg).not.toContain(USERP);
    expect((err as OllamaProviderError).category).toBe("http");
    expect((err as OllamaProviderError).httpStatus).toBe(500);
    expect((err as OllamaProviderError).provider).toBe(OLLAMA_PROVIDER);
  });

  it("config inválido: model vazio -> configuration_invalid", () => {
    expect(() => new OllamaProvider({ model: "", timeoutMs: 1000 })).toThrow(OllamaProviderError);
  });

  it("config inválido: timeout <=0 -> configuration_invalid", () => {
    expect(() => new OllamaProvider({ model: "m", timeoutMs: 0 })).toThrow(OllamaProviderError);
  });

  it("config inválido: base URL inválida -> configuration_invalid", () => {
    expect(() => new OllamaProvider({ model: "m", timeoutMs: 1000, baseUrl: "não-url" })).toThrow(
      OllamaProviderError,
    );
  });

  it("missing userPrompt na geração real -> missing_user_prompt (sem derivar de histórico)", async () => {
    const rec = captureRequest(() => Promise.resolve(jsonResponse({ choices: [] })));
    const p = providerWith(rec.spy);
    await expect(
      p.run({
        context: { recentMessages: [] } as unknown as AssembledContext,
        systemPrompt: SYSP,
        userPrompt: undefined,
      }),
    ).rejects.toMatchObject({ category: "missing_user_prompt" });
  });

  it("NUNCA envia secrets/ids/objetos RAG no body (só model+messages+stream)", async () => {
    const rec = captureRequest(() =>
      Promise.resolve(jsonResponse({ choices: [{ message: { content: "ok" } }] })),
    );
    const p = providerWith(rec.spy);
    await p.run(unitInput(SYSP, USERP));
    const body = rec.get().init.body;
    expect(body).not.toContain("Authorization");
    expect(body).not.toContain("conversationId");
    const obj = JSON.parse(body) as Record<string, unknown>;
    expect(Object.keys(obj).sort()).toEqual(["messages", "model", "stream"]);
  });
});

describe("NullProvider independente", () => {
  it("Z) NullProvider continua assembly-only, sem texto", async () => {
    const out = await nullProvider.run({
      context: { recentMessages: [] } as unknown as AssembledContext,
      systemPrompt: SYSP,
      userPrompt: USERP,
    });
    expect(out.mode).toBe("assembly-only");
    if (out.mode === "assembly-only") {
      expect("text" in out).toBe(false);
    }
  });
});

describe("OllamaProvider - URL helper", () => {
  it("normaliza base URL com trailing slash", () => {
    expect(ollamaChatCompletionsUrl("http://localhost:11434/")).toBe(
      "http://localhost:11434/v1/chat/completions",
    );
    expect(ollamaChatCompletionsUrl("http://localhost:11434")).toBe(
      "http://localhost:11434/v1/chat/completions",
    );
  });
});
