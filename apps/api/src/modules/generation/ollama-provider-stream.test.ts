import { describe, expect, it } from "vitest";

import { OllamaProvider } from "./ollama-provider.js";
import type { ProviderInput } from "./generation.assembly.js";

const INPUT: ProviderInput = {
  context: {} as ProviderInput["context"],
  systemPrompt: "system",
  userPrompt: "user",
};

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new globalThis.TextEncoder();
  const body = new globalThis.ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function chunk(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

function makeProvider(
  fetchImpl: typeof fetch,
  timeoutMs = 5000,
): OllamaProvider {
  return new OllamaProvider({
    baseUrl: "http://ollama.invalid",
    model: "test-model",
    timeoutMs,
    fetchImpl,
  });
}

describe("OllamaProvider.runStream", () => {
  it("consome SSE incremental, preserva ordem e envia stream:true", async () => {
    let seenBody: Record<string, unknown> | null = null;
    let seenAccept: string | null = null;
    const provider = makeProvider(async (_input, init) => {
      seenBody = JSON.parse(String(init?.body));
      const headers = new globalThis.Headers(init?.headers);
      seenAccept = headers.get("Accept");
      return sseResponse([chunk("Ola"), chunk(", "), chunk("mundo"), "data: [DONE]\n\n"]);
    });

    const deltas: string[] = [];
    const output = await provider.runStream(INPUT, {
      onDelta: (delta) => deltas.push(delta),
    });

    expect(deltas).toEqual(["Ola", ", ", "mundo"]);
    expect(output.mode).toBe("generated");
    if (output.mode === "generated") {
      expect(output.text).toBe("Ola, mundo");
    }
    expect(seenBody).toMatchObject({ model: "test-model", stream: true });
    expect(seenAccept).toBe("text/event-stream");
  });

  it("falha com malformed_response em chunk inválido e não emite após o erro", async () => {
    const provider = makeProvider(async () =>
      sseResponse([chunk("ok"), "data: {isso-nao-e-json}\n\n", chunk("depois")]),
    );

    const deltas: string[] = [];
    await expect(
      provider.runStream(INPUT, { onDelta: (delta) => deltas.push(delta) }),
    ).rejects.toMatchObject({ category: "malformed_response" });
    expect(deltas).toEqual(["ok"]);
  });

  it("falha com missing_content quando o stream termina vazio", async () => {
    const provider = makeProvider(async () => sseResponse(["data: [DONE]\n\n"]));
    await expect(
      provider.runStream(INPUT, { onDelta: () => undefined }),
    ).rejects.toMatchObject({ category: "missing_content" });
  });

  it("propaga erro HTTP do provider", async () => {
    const provider = makeProvider(async () => new Response("erro", { status: 500 }));
    await expect(
      provider.runStream(INPUT, { onDelta: () => undefined }),
    ).rejects.toMatchObject({ category: "http", httpStatus: 500 });
  });

  it("mapeia abort externo e timeout", async () => {
    const hangingFetch: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });

    const external = new AbortController();
    const provider = makeProvider(hangingFetch);
    const pending = provider.runStream(INPUT, {
      onDelta: () => undefined,
      signal: external.signal,
    });
    external.abort();
    await expect(pending).rejects.toMatchObject({ category: "abort" });

    const timeoutProvider = makeProvider(hangingFetch, 30);
    await expect(
      timeoutProvider.runStream(INPUT, { onDelta: () => undefined }),
    ).rejects.toMatchObject({ category: "timeout" });
  });
});
