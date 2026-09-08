import { describe, expect, it, vi } from "vitest";
import { JolpicaError, JolpicaTransport } from "./jolpica.transport.js";

const BASE = "https://mock.invalid/f1/";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("JolpicaTransport", () => {
  it("retorna o JSON parseado em caso de sucesso", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true, value: 42 }));
    const transport = new JolpicaTransport({ baseUrl: BASE, fetchImpl });
    const body = await transport.getJson("1975.json");
    expect(body).toEqual({ ok: true, value: 42 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refaz uma única vez em 500/5xx e consome a tentativa válida", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse("boom", 503))
      .mockResolvedValueOnce(jsonResponse({ retried: true }));
    const transport = new JolpicaTransport({
      baseUrl: BASE,
      timeoutMs: 1000,
      maxRetries: 1,
      fetchImpl,
    });
    const body = await transport.getJson("1975/constructors.json");
    expect(body).toEqual({ retried: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("esgota as tentativas em falhas 5xx sem retry infinito", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse("boom", 500));
    const transport = new JolpicaTransport({
      baseUrl: BASE,
      timeoutMs: 1000,
      maxRetries: 1,
      fetchImpl,
    });
    await expect(transport.getJson("1975.json")).rejects.toMatchObject({
      name: "JolpicaError",
      code: "HTTP",
      statusCode: 500,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("não refaz em 404 (não retryável)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse("missing", 404));
    const transport = new JolpicaTransport({
      baseUrl: BASE,
      timeoutMs: 1000,
      maxRetries: 1,
      fetchImpl,
    });
    await expect(transport.getJson("1999.json")).rejects.toMatchObject({
      name: "JolpicaError",
      code: "HTTP",
      statusCode: 404,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("aborta com timeout quando a resposta demora demais", async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
        });
      });
    const transport = new JolpicaTransport({
      baseUrl: BASE,
      timeoutMs: 20,
      fetchImpl,
    });
    await expect(transport.getJson("1975.json")).rejects.toMatchObject({
      name: "JolpicaError",
      code: "TIMEOUT",
    });
  });

  it("mapeia falha de rede para NETWORK", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const transport = new JolpicaTransport({ baseUrl: BASE, fetchImpl });
    await expect(transport.getJson("1975.json")).rejects.toMatchObject({
      name: "JolpicaError",
      code: "NETWORK",
    });
  });

  it("mapeia resposta não-JSON para MALFORMED", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html></html>", { status: 200 }));
    const transport = new JolpicaTransport({ baseUrl: BASE, fetchImpl });
    await expect(transport.getJson("1975.json")).rejects.toMatchObject({
      name: "JolpicaError",
      code: "MALFORMED",
    });
  });

  it("lança erro tipado JolpicaError", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse("boom", 500));
    const transport = new JolpicaTransport({ baseUrl: BASE, fetchImpl });
    try {
      await transport.getJson("x.json");
    } catch (error) {
      expect(error).toBeInstanceOf(JolpicaError);
    }
  });
});