import { describe, expect, it } from "vitest";

import { DialogueUtteranceSchema, type DialogueUtterance } from "./conversation.dialogue.js";
import {
  buildDialogueRealizerContext,
  DialogueRealizerContextSchema,
  validateRealizerResult,
  type DialogueRealizerContext,
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
