import { describe, expect, it } from "vitest";

import { DialogueUtteranceSchema, type DialogueIntent, type DialogueUtterance } from "./conversation.dialogue.js";
import {
  buildDialogueRealizerContext,
  createDialogueRealizer,
  DeterministicDialogueRealizer,
  DialogueRealizerContextSchema,
  INTENT_REALIZATION_POLICY,
  isGenericText,
  LlmDialogueRealizer,
  resolveDialogueRealizerKind,
  validateRealizerResult,
  type DialogueRealizerContext,
  type DialogueRealizerProvider,
} from "./conversation.dialogue-realizer.js";

function context(overrides: Partial<DialogueRealizerContext> = {}): DialogueRealizerContext {
  return buildDialogueRealizerContext({
    speakerCharacterId: "ai-kimi",
    speakerName: "Kimi",
    intent: "REACTION",
    replyToMessageId: "msg-1",
    replyToContent: "bom dia amigos",
    recentMessages: [{ speakerName: "Alicya", content: "bom dia amigos" }],
    topic: null,
    emotionalTone: "PLAYFUL",
    relationshipAffinity: 0.8,
    memorySummaries: [],
    voice: { informality: 0.7, warmth: 0.6, humor: 0.5, emojiTendency: 0.4, verbosity: 0.3 },
    maxMessages: 1,
    language: "pt-BR",
    ...overrides,
  });
}

function utterance(overrides: Partial<DialogueUtterance> = {}): DialogueUtterance {
  return { ...validUtterance(), ...overrides };
}

function validUtterance(): DialogueUtterance {
  return {
    speakerCharacterId: "ai-kimi",
    replyToMessageId: "msg-1",
    intent: "REACTION",
    messages: [{ text: "kkkk", fragmentIndex: 0 }],
  };
}

describe("F3.1 — contrato do Dialogue Realizer", () => {
  it("contexto válido é aceito e preserva allowlist", () => {
    const parsed = DialogueRealizerContextSchema.safeParse(context());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.language).toBe("pt-BR");
      expect(parsed.data.memorySummaries.length).toBeLessThanOrEqual(3);
    }
  });

  it("contexto sem language pt-BR é rejeitado", () => {
    const raw = { ...context(), language: "en-US" };
    expect(DialogueRealizerContextSchema.safeParse(raw).success).toBe(false);
  });

  it("saída válida passa na validação de integridade", () => {
    const result = validateRealizerResult(utterance(), {
      speakerCharacterId: "ai-kimi",
      intent: "REACTION",
      replyToMessageId: "msg-1",
      maxMessages: 1,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("saída vazia é rejeitada", () => {
    const result = validateRealizerResult(utterance({ messages: [] }), {
      speakerCharacterId: "ai-kimi",
      intent: "REACTION",
      replyToMessageId: "msg-1",
      maxMessages: 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("EMPTY_OUTPUT");
  });

  it("fragmentos acima do maxMessages são rejeitados", () => {
    const result = validateRealizerResult(
      utterance({
        messages: [
          { text: "kkkk", fragmentIndex: 0 },
          { text: "pera", fragmentIndex: 1 },
        ],
      }),
      {
        speakerCharacterId: "ai-kimi",
        intent: "REACTION",
        replyToMessageId: "msg-1",
        maxMessages: 1,
      },
    );
    expect(result.errors).toContain("MAX_MESSAGES_EXCEEDED");
  });

  it("speaker divergente é rejeitado", () => {
    const result = validateRealizerResult(utterance({ speakerCharacterId: "ai-max" }), {
      speakerCharacterId: "ai-kimi",
      intent: "REACTION",
      replyToMessageId: "msg-1",
      maxMessages: 1,
    });
    expect(result.errors).toContain("SPEAKER_MISMATCH");
  });

  it("replyTo incompatível é rejeitado", () => {
    const result = validateRealizerResult(utterance({ replyToMessageId: "msg-999" }), {
      speakerCharacterId: "ai-kimi",
      intent: "REACTION",
      replyToMessageId: "msg-1",
      maxMessages: 1,
    });
    expect(result.errors).toContain("REPLY_TO_MISMATCH");
  });

  it("intent incompatível é rejeitado", () => {
    const result = validateRealizerResult(utterance({ intent: "ANSWER" }), {
      speakerCharacterId: "ai-kimi",
      intent: "REACTION",
      replyToMessageId: "msg-1",
      maxMessages: 1,
    });
    expect(result.errors).toContain("INTENT_MISMATCH");
  });

  it("texto vazio, JSON e fragmentIndex fora de ordem são rejeitados", () => {
    const empty = validateRealizerResult(
      utterance({ messages: [{ text: "   ", fragmentIndex: 0 }] }),
      { speakerCharacterId: "ai-kimi", intent: "REACTION", replyToMessageId: "msg-1", maxMessages: 1 },
    );
    expect(empty.errors).toContain("EMPTY_TEXT");
    const json = validateRealizerResult(
      utterance({ messages: [{ text: '{"a":1}', fragmentIndex: 0 }] }),
      { speakerCharacterId: "ai-kimi", intent: "REACTION", replyToMessageId: "msg-1", maxMessages: 1 },
    );
    expect(json.errors).toContain("JSON_TEXT");
    const index = validateRealizerResult(
      utterance({ messages: [{ text: "oi", fragmentIndex: 2 }] }),
      { speakerCharacterId: "ai-kimi", intent: "REACTION", replyToMessageId: "msg-1", maxMessages: 1 },
    );
    expect(index.errors).toContain("FRAGMENT_INDEX_INVALID");
  });

  it("schema roundtrip do utterance mantém os campos", () => {
    const parsed = DialogueUtteranceSchema.parse(utterance());
    expect(parsed).toEqual(utterance());
  });

  it("resultado sem schema é INVALID_SCHEMA", () => {
    const result = validateRealizerResult({ nope: true }, {
      speakerCharacterId: "ai-kimi",
      intent: "REACTION",
      replyToMessageId: "msg-1",
      maxMessages: 1,
    });
    expect(result.errors).toEqual(["INVALID_SCHEMA"]);
  });
});

const realizer = new DeterministicDialogueRealizer();
const NON_SILENT_INTENTS: DialogueIntent[] = [
  "ANSWER",
  "QUESTION",
  "REACTION",
  "JOKE",
  "TEASE",
  "SUPPORT",
  "DISAGREE",
  "FOLLOW_UP",
  "TOPIC_CHANGE",
  "INTERRUPTION",
  "CALLBACK",
];

async function realizeFor(intent: DialogueIntent, overrides: Partial<DialogueRealizerContext> = {}) {
  return realizer.realize(context({ intent, ...overrides }));
}

describe("F3.2 — DeterministicDialogueRealizer", () => {
  it("todos os intents produzem fala curta, pt-BR, sem JSON e sem genericidade", async () => {
    for (const intent of NON_SILENT_INTENTS) {
      const utterance = await realizeFor(intent, { maxMessages: 3 });
      expect(utterance.messages.length).toBeGreaterThanOrEqual(1);
      for (const message of utterance.messages) {
        expect(message.text.trim().length).toBeGreaterThan(0);
        expect(message.text.length).toBeLessThanOrEqual(INTENT_REALIZATION_POLICY[intent].maxChars);
        expect(message.text.startsWith("{")).toBe(false);
        expect(isGenericText(message.text)).toBe(false);
        expect(/^[\p{L}\p{N}\s.,!?;:'"()\-—…#@]+$/u.test(message.text.replace(/(?:😂|❤️|😭)/gu, ""))).toBe(true);
      }
    }
  });

  it("REACTION é muito curta e QUESTION termina em pergunta", async () => {
    const reaction = await realizeFor("REACTION");
    expect(reaction.messages[0]!.text.length).toBeLessThanOrEqual(40);
    const question = await realizeFor("QUESTION");
    expect(question.messages[0]!.text.endsWith("?")).toBe(true);
  });

  it("maxMessages = 1 nunca fragmenta, mesmo com risada", async () => {
    const utterance = await realizeFor("JOKE", { maxMessages: 1 });
    expect(utterance.messages.length).toBe(1);
  });

  it("maxMessages > 1 permite fragmentação com fragmentIndex sequencial", async () => {
    const utterance = await realizeFor("JOKE", {
      maxMessages: 2,
      voice: { informality: 0.8, warmth: 0.5, humor: 0.9, emojiTendency: 0, verbosity: 0.8 },
    });
    expect(utterance.messages.length).toBeLessThanOrEqual(2);
    utterance.messages.forEach((message, index) => {
      expect(message.fragmentIndex).toBe(index);
    });
  });

  it("maxMessages = 3 é respeitado em todos os intents", async () => {
    for (const intent of NON_SILENT_INTENTS) {
      const utterance = await realizeFor(intent, {
        maxMessages: 3,
        voice: { informality: 0.9, warmth: 0.9, humor: 0.9, emojiTendency: 1, verbosity: 1 },
      });
      expect(utterance.messages.length).toBeLessThanOrEqual(3);
    }
  });

  it("speaker, intent e replyTo são preservados e passam na integridade", async () => {
    for (const intent of NON_SILENT_INTENTS) {
      const utterance = await realizeFor(intent, { maxMessages: 2 });
      const result = validateRealizerResult(utterance, {
        speakerCharacterId: "ai-kimi",
        intent,
        replyToMessageId: "msg-1",
        maxMessages: 2,
      });
      expect(result.valid).toBe(true);
    }
  });

  it("voz diferente produz resultado diferente (informalidade)", async () => {
    const dry = await realizeFor("ANSWER", {
      voice: { informality: 0.1, warmth: 0.2, humor: 0.1, emojiTendency: 0, verbosity: 0.2 },
    });
    const informal = await realizeFor("ANSWER", {
      voice: { informality: 0.9, warmth: 0.6, humor: 0.6, emojiTendency: 0, verbosity: 0.4 },
    });
    expect(dry.messages[0]!.text).not.toBe(informal.messages[0]!.text);
  });

  it("relationship modula a fala sem mudar o speaker", async () => {
    const close = await realizeFor("REACTION", { relationshipAffinity: 0.9, replyToContent: "oi" });
    const distant = await realizeFor("REACTION", { relationshipAffinity: 0.1, replyToContent: "oi" });
    expect(close.speakerCharacterId).toBe("ai-kimi");
    expect(distant.speakerCharacterId).toBe("ai-kimi");
    expect(close.messages[0]!.text).not.toBe(distant.messages[0]!.text);
  });

  it("afinidade alta libera emoji quando a voz permite; baixa mantém neutro", async () => {
    const warm = await realizeFor("REACTION", {
      relationshipAffinity: 0.9,
      replyToContent: "oi",
      voice: { informality: 0.5, warmth: 0.5, humor: 0.5, emojiTendency: 0.4, verbosity: 0.3 },
    });
    const cold = await realizeFor("REACTION", {
      relationshipAffinity: 0.1,
      replyToContent: "oi",
      voice: { informality: 0.5, warmth: 0.5, humor: 0.5, emojiTendency: 0.4, verbosity: 0.3 },
    });
    expect(warm.messages[0]!.text).toContain("😂");
    expect(cold.messages[0]!.text).not.toContain("😂");
  });

  it("replyTo com pergunta usa respostas de pergunta em REACTION", async () => {
    const utterance = await realizeFor("REACTION", {
      relationshipAffinity: null,
      replyToContent: "você acha que ganha hoje?",
    });
    expect(INTENT_REALIZATION_POLICY.REACTION.questionPhrases).toContain(utterance.messages[0]!.text);
  });

  it("deterministic replay: mesmo contexto, mesma saída", async () => {
    const first = await realizeFor("SUPPORT", { maxMessages: 2, relationshipAffinity: 0.5 });
    const second = await realizeFor("SUPPORT", { maxMessages: 2, relationshipAffinity: 0.5 });
    expect(first).toEqual(second);
  });

  it("SILENCE não inventa texto", async () => {
    const utterance = await realizeFor("SILENCE");
    expect(utterance.messages).toEqual([]);
    expect(utterance.speakerCharacterId).toBe("ai-kimi");
  });

  it("nenhuma frase da política é genérica ou corporativa", () => {
    for (const policy of Object.values(INTENT_REALIZATION_POLICY)) {
      for (const phrase of [...policy.phrases, ...(policy.neutralPhrases ?? []), ...(policy.questionPhrases ?? [])]) {
        expect(isGenericText(phrase)).toBe(false);
      }
    }
  });
});

function validUtteranceFor(context: DialogueRealizerContext) {
  return {
    speakerCharacterId: context.speakerCharacterId,
    replyToMessageId: context.replyToMessageId,
    intent: context.intent,
    messages: [{ text: "kkkk", fragmentIndex: 0 }],
  };
}

function providerReturning(value: unknown): DialogueRealizerProvider {
  return { name: "stub-realizer", model: "stub-1", async realize() { return value; } };
}

function providerFailing(): DialogueRealizerProvider {
  return { name: "failing-realizer", async realize() { throw new Error("provider indisponível"); } };
}

describe("F3.3 — provider do Dialogue Realizer", () => {
  it("flag default é deterministic; off e llm reconhecidos", () => {
    expect(resolveDialogueRealizerKind(undefined)).toBe("deterministic");
    expect(resolveDialogueRealizerKind("")).toBe("deterministic");
    expect(resolveDialogueRealizerKind("off")).toBe("off");
    expect(resolveDialogueRealizerKind("llm")).toBe("llm");
  });

  it("provider ausente cai para deterministic mesmo com kind llm", () => {
    expect(createDialogueRealizer("llm").kind).toBe("deterministic");
    expect(createDialogueRealizer("off").kind).toBe("deterministic");
  });

  it("provider presente com kind llm cria LlmDialogueRealizer", () => {
    expect(createDialogueRealizer("llm", providerReturning(validUtteranceFor(context()))).kind).toBe("llm");
  });

  it("output estruturado válido é aceito com trace sem fallback", async () => {
    const ctx = context();
    const realizer = new LlmDialogueRealizer(providerReturning(validUtteranceFor(ctx)));
    const utterance = await realizer.realize(ctx);
    expect(utterance).toEqual(validUtteranceFor(ctx));
    expect(realizer.lastTrace?.valid).toBe(true);
    expect(realizer.lastTrace?.fallback).toBe(false);
    expect(realizer.lastTrace?.provider).toBe("stub-realizer");
  });

  it("provider que lança erro usa fallback determinístico", async () => {
    const ctx = context();
    const realizer = new LlmDialogueRealizer(providerFailing());
    const utterance = await realizer.realize(ctx);
    const expected = await new DeterministicDialogueRealizer().realize(ctx);
    expect(utterance).toEqual(expected);
    expect(realizer.lastTrace?.fallback).toBe(true);
    expect(realizer.lastTrace?.invalidReason).toBe("PROVIDER_ERROR");
  });

  it("schema inválido, speaker, intent, replyTo, texto vazio e fragmentos demais caem no fallback", async () => {
    const cases: Array<[unknown, string]> = [
      [{ nope: true }, "INVALID_SCHEMA"],
      [{ ...validUtteranceFor(context()), speakerCharacterId: "ai-max" }, "SPEAKER_MISMATCH"],
      [{ ...validUtteranceFor(context()), intent: "ANSWER" }, "INTENT_MISMATCH"],
      [{ ...validUtteranceFor(context()), replyToMessageId: "msg-999" }, "REPLY_TO_MISMATCH"],
      [{ ...validUtteranceFor(context()), messages: [{ text: "  ", fragmentIndex: 0 }] }, "EMPTY_TEXT"],
      [
        {
          ...validUtteranceFor(context()),
          messages: [
            { text: "kkkk", fragmentIndex: 0 },
            { text: "pera", fragmentIndex: 1 },
          ],
        },
        "MAX_MESSAGES_EXCEEDED",
      ],
    ];
    for (const [raw, expectedReason] of cases) {
      const realizer = new LlmDialogueRealizer(providerReturning(raw));
      await realizer.realize(context());
      expect(realizer.lastTrace?.fallback).toBe(true);
      expect(realizer.lastTrace?.invalidReason).toBe(expectedReason);
    }
  });

  it("SILENCE não chama o provider", async () => {
    let calls = 0;
    const provider: DialogueRealizerProvider = {
      name: "counting",
      async realize() {
        calls += 1;
        return validUtteranceFor(context({ intent: "SILENCE" }));
      },
    };
    const utterance = await new LlmDialogueRealizer(provider).realize(context({ intent: "SILENCE" }));
    expect(calls).toBe(0);
    expect(utterance.messages).toEqual([]);
  });

  it("replay determinístico do fallback", async () => {
    const first = new LlmDialogueRealizer(providerFailing());
    const second = new LlmDialogueRealizer(providerFailing());
    const ctx = context({ intent: "SUPPORT", maxMessages: 2 });
    expect(await first.realize(ctx)).toEqual(await second.realize(ctx));
  });

  it("contexto do provider usa allowlist e não contém secrets", async () => {
    let received: Record<string, unknown> | null = null;
    const provider: DialogueRealizerProvider = {
      name: "capture",
      async realize(ctx) {
        received = ctx as unknown as Record<string, unknown>;
        return validUtteranceFor(ctx);
      },
    };
    const raw = { ...context(), apiKey: "sk-secret", authorization: "Bearer x" };
    const parsed = DialogueRealizerContextSchema.parse(raw);
    await new LlmDialogueRealizer(provider).realize(parsed);
    expect(received).not.toBeNull();
    expect(Object.keys(received!).sort()).toEqual(
      [
        "emotion",
        "emotionalTone",
        "intent",
        "language",
        "maxMessages",
        "memoryContext",
        "memorySummaries",
        "recentMessages",
        "relationshipAffinity",
        "replyToContent",
        "replyToMessageId",
        "speakerCharacterId",
        "speakerName",
        "topic",
        "topicContext",
        "voice",
      ].sort(),
    );
    expect(JSON.stringify(received)).not.toContain("sk-secret");
  });
});
