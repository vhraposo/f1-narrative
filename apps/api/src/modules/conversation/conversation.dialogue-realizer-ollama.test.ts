import { describe, expect, it } from "vitest";

import { OllamaProviderError } from "../generation/ollama-provider.js";
import {
  buildDialogueRealizerContext,
  LlmDialogueRealizer,
  realizerLanguageMetadata,
  type DialogueRealizerContext,
} from "./conversation.dialogue-realizer.js";
import {
  buildOllamaRealizerPrompt,
  createOllamaDialogueRealizerProviderFromEnv,
} from "./conversation.dialogue-realizer-ollama.js";

function context(overrides: Partial<DialogueRealizerContext> = {}): DialogueRealizerContext {
  return buildDialogueRealizerContext({
    speakerCharacterId: "ai-kimi",
    speakerName: "Kimi",
    intent: "REACTION",
    replyToMessageId: "msg-1",
    replyToContent: "bom dia amigos",
    recentMessages: [{ speakerName: "Alicya", content: "bom dia amigos" }],
    topic: "clima",
    emotionalTone: "PLAYFUL",
    relationshipAffinity: 0.8,
    memorySummaries: ["viagem antiga"],
    voice: { informality: 0.7, warmth: 0.6, humor: 0.5, emojiTendency: 0.4, verbosity: 0.3 },
    maxMessages: 2,
    language: "pt-BR",
    ...overrides,
  });
}

function chatResponse(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

describe("F22.2 — provider Ollama do Dialogue Realizer (stub, sem rede)", () => {
  it("factory retorna null sem modelo configurado", () => {
    expect(createOllamaDialogueRealizerProviderFromEnv({ model: "" })).toBeNull();
  });

  it("factory cria provider com nome e modelo quando configurado", () => {
    const provider = createOllamaDialogueRealizerProviderFromEnv({ model: "llama3.2:latest" });
    expect(provider?.name).toBe("ollama");
    expect(provider?.model).toBe("llama3.2:latest");
  });

  it("sucesso devolve utterance com campos decididos pelo engine", async () => {
    const provider = createOllamaDialogueRealizerProviderFromEnv({
      model: "stub",
      fetchImpl: async () => chatResponse('{"messages":["kkkk","para"]}'),
    });
    expect(provider).not.toBeNull();
    const utterance = (await provider!.realize(context())) as {
      speakerCharacterId: string;
      replyToMessageId: string | null;
      intent: string;
      messages: Array<{ text: string; fragmentIndex: number }>;
    };
    expect(utterance.speakerCharacterId).toBe("ai-kimi");
    expect(utterance.replyToMessageId).toBe("msg-1");
    expect(utterance.intent).toBe("REACTION");
    expect(utterance.messages.map((message) => message.text)).toEqual(["kkkk", "para"]);
    expect(utterance.messages.map((message) => message.fragmentIndex)).toEqual([0, 1]);
  });

  it("respeita maxMessages mesmo se o modelo devolver mais fragmentos", async () => {
    const provider = createOllamaDialogueRealizerProviderFromEnv({
      model: "stub",
      fetchImpl: async () => chatResponse('{"messages":["a","b","c"]}'),
    });
    const utterance = (await provider!.realize(context({ maxMessages: 1 }))) as {
      messages: Array<{ text: string }>;
    };
    expect(utterance.messages).toHaveLength(1);
  });

  it("conteúdo não-JSON vira invalid_json", async () => {
    const provider = createOllamaDialogueRealizerProviderFromEnv({
      model: "stub",
      fetchImpl: async () => chatResponse("texto solto"),
    });
    await expect(provider!.realize(context())).rejects.toMatchObject({
      name: "OllamaProviderError",
      category: "invalid_json",
    });
  });

  it("HTTP inválido vira erro http com status", async () => {
    const provider = createOllamaDialogueRealizerProviderFromEnv({
      model: "stub",
      fetchImpl: async () => chatResponse("{}", 500),
    });
    await expect(provider!.realize(context())).rejects.toMatchObject({
      category: "http",
      httpStatus: 500,
    });
  });

  it("conteúdo vazio vira missing_content", async () => {
    const provider = createOllamaDialogueRealizerProviderFromEnv({
      model: "stub",
      fetchImpl: async () => chatResponse(""),
    });
    await expect(provider!.realize(context())).rejects.toMatchObject({
      category: "missing_content",
    });
  });

  it("timeout aborta e vira erro timeout", async () => {
    const provider = createOllamaDialogueRealizerProviderFromEnv({
      model: "stub",
      timeoutMs: 10,
      fetchImpl: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    });
    await expect(provider!.realize(context())).rejects.toMatchObject({
      category: "timeout",
    });
  });

  it("prompt não vaza IDs internos nem metadados e usa contrato JSON", async () => {
    let body = "";
    const provider = createOllamaDialogueRealizerProviderFromEnv({
      model: "stub",
      fetchImpl: async (_input, init) => {
        body = String(init?.body ?? "");
        return chatResponse('{"messages":["oi"]}');
      },
    });
    await provider!.realize(context());
    expect(body).not.toContain("ai-kimi");
    expect(body).not.toContain("msg-1");
    expect(body).toContain("Kimi");
    expect(body).toContain("REACTION");
    expect(body).toContain("json_object");
  });

  it("LlmDialogueRealizer cai no determinístico quando o adapter falha", async () => {
    const provider = createOllamaDialogueRealizerProviderFromEnv({
      model: "stub",
      fetchImpl: async () => {
        throw new Error("sem rede");
      },
    });
    const realizer = new LlmDialogueRealizer(provider!);
    const ctx = context();
    const utterance = await realizer.realize(ctx);
    expect(realizer.lastTrace?.fallback).toBe(true);
    expect(realizer.lastTrace?.provider).toBe("ollama");
    expect(utterance.messages.length).toBeGreaterThanOrEqual(1);
  });

  it("realizerLanguageMetadata reflete sucesso e fallback", () => {
    expect(realizerLanguageMetadata(null)).toBeNull();
    expect(
      realizerLanguageMetadata({
        realizerKind: "llm",
        provider: "ollama",
        model: "llama3.2:latest",
        latencyMs: 10,
        valid: true,
        fallback: false,
        invalidReason: null,
      }),
    ).toEqual({ provider: "ollama", model: "llama3.2:latest", fallback: false });
    expect(
      realizerLanguageMetadata({
        realizerKind: "llm",
        provider: "ollama",
        model: null,
        latencyMs: 10,
        valid: false,
        fallback: true,
        invalidReason: "timeout",
      }),
    ).toEqual({ provider: "ollama", model: "unknown", fallback: true });
  });

  it("OllamaProviderError do adapter é a classe existente do projeto", async () => {
    const provider = createOllamaDialogueRealizerProviderFromEnv({
      model: "stub",
      fetchImpl: async () => chatResponse("nope"),
    });
    await expect(provider!.realize(context())).rejects.toBeInstanceOf(OllamaProviderError);
  });

  it("prompt cobre emoção, voz, memória e limite sem despejar JSON interno", () => {
    const { systemPrompt, userPrompt } = buildOllamaRealizerPrompt(context());
    expect(userPrompt).toContain("TOM EMOCIONAL");
    expect(userPrompt).toContain("VOZ");
    expect(userPrompt).toContain("MEMÓRIAS DISPONÍVEIS");
    expect(userPrompt).toContain("LIMITE");
    expect(systemPrompt).toContain("JSON");
    expect(userPrompt).not.toContain("{");
  });
});
