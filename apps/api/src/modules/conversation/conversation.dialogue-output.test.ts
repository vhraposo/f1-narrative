import { describe, expect, it } from "vitest";

import type { DialogueUtterance } from "./conversation.dialogue.js";
import {
  buildDialogueRealizerContext,
  type DialogueRealizerContext,
} from "./conversation.dialogue-realizer.js";
import { validateDialogueOutput } from "./conversation.dialogue-output.js";

function context(overrides: Partial<DialogueRealizerContext> = {}): DialogueRealizerContext {
  return buildDialogueRealizerContext({
    speakerCharacterId: "ai-kimi",
    speakerName: "Kimi",
    intent: "REACTION",
    replyToMessageId: "msg-1",
    replyToContent: "bom dia amigos",
    recentMessages: [],
    topic: null,
    emotionalTone: "PLAYFUL",
    relationshipAffinity: 0.6,
    memorySummaries: [],
    voice: { informality: 0.6, warmth: 0.5, humor: 0.5, emojiTendency: 0.4, verbosity: 0.3 },
    maxMessages: 1,
    language: "pt-BR",
    ...overrides,
  });
}

function utterance(overrides: Partial<DialogueUtterance> = {}): DialogueUtterance {
  return {
    speakerCharacterId: "ai-kimi",
    replyToMessageId: "msg-1",
    intent: "REACTION",
    messages: [{ text: "kkkk", fragmentIndex: 0 }],
    ...overrides,
  };
}

function run(overrides: Partial<DialogueUtterance> = {}, ctx: Partial<DialogueRealizerContext> = {}, options: {
  previousMessageContent?: string | null;
  stopped?: boolean;
  replyToKnown?: boolean;
  replyToIsFuture?: boolean;
} = {}) {
  const realizerContext = context(ctx);
  return validateDialogueOutput({
    context: realizerContext,
    utterance: utterance({ intent: realizerContext.intent, replyToMessageId: realizerContext.replyToMessageId, ...overrides }),
    ...options,
  });
}

describe("F4.1 — Output Validator", () => {
  it("output válido é aceito e normalizado", () => {
    const result = run({ messages: [{ text: "  kkkk   demais  ", fragmentIndex: 0 }] });
    expect(result.valid).toBe(true);
    expect(result.fallbackRequired).toBe(false);
    expect(result.normalized?.messages[0]?.text).toBe("kkkk demais");
  });

  it("texto vazio, JSON e metadata no texto são rejeitados", () => {
    expect(run({ messages: [{ text: "   ", fragmentIndex: 0 }] }).violations).toContain("EMPTY_TEXT");
    expect(run({ messages: [{ text: '{"a":1}', fragmentIndex: 0 }] }).violations).toContain("JSON_TEXT");
    expect(
      run({ messages: [{ text: "como uma ia, eu diria isso", fragmentIndex: 0 }] }).violations,
    ).toContain("META_TEXT");
  });

  it("anti-generic rejeita linguagem corporativa", () => {
    const result = run({ messages: [{ text: "Entendo perfeitamente sua situação.", fragmentIndex: 0 }] });
    expect(result.violations).toContain("GENERIC_TEXT");
    expect(result.fallbackRequired).toBe(true);
  });

  it("anti-monólogo usa limite por intent", () => {
    const longReaction = run({ messages: [{ text: "a".repeat(120), fragmentIndex: 0 }] });
    expect(longReaction.violations).toContain("MONOLOGUE");
    const longAnswer = run(
      { messages: [{ text: "b".repeat(300), fragmentIndex: 0 }] },
      { intent: "ANSWER" },
    );
    expect(longAnswer.violations).not.toContain("MONOLOGUE");
    expect(longAnswer.valid).toBe(true);
  });

  it("duplicação imediata é rejeitada", () => {
    const result = run({ messages: [{ text: "bom dia", fragmentIndex: 0 }] }, {}, {
      previousMessageContent: "bom dia",
    });
    expect(result.violations).toContain("DUPLICATE_IMMEDIATE");
  });

  it("QUESTION sem interrogação é rejeitada", () => {
    const result = run({ messages: [{ text: "sim claro", fragmentIndex: 0 }] }, { intent: "QUESTION" });
    expect(result.violations).toContain("QUESTION_WITHOUT_QUESTION");
  });

  it("SILENCE com texto é rejeitado; SILENCE vazio é aceito", () => {
    const withText = run({ messages: [{ text: "oi", fragmentIndex: 0 }] }, { intent: "SILENCE" });
    expect(withText.violations).toContain("SILENCE_WITH_TEXT");
    const empty = run({ messages: [] }, { intent: "SILENCE" });
    expect(empty.valid).toBe(true);
  });

  it("STOP com output adicional é rejeitado", () => {
    const result = run({}, {}, { stopped: true });
    expect(result.violations).toContain("STOP_WITH_OUTPUT");
  });

  it("replyTo desconhecido e futuro são rejeitados", () => {
    expect(run({}, {}, { replyToKnown: false }).violations).toContain("REPLY_TO_UNKNOWN");
    expect(run({}, {}, { replyToIsFuture: true }).violations).toContain("REPLY_TO_FUTURE");
  });

  it("speaker, intent, replyTo e fragment overflow estruturais são rejeitados", () => {
    expect(run({ speakerCharacterId: "ai-max" }).violations).toContain("SPEAKER_MISMATCH");
    expect(run({ intent: "ANSWER" }).violations).toContain("INTENT_MISMATCH");
    expect(run({ replyToMessageId: "msg-9" }).violations).toContain("REPLY_TO_MISMATCH");
    const overflow = run({
      messages: [
        { text: "kkkk", fragmentIndex: 0 },
        { text: "pera", fragmentIndex: 1 },
      ],
    });
    expect(overflow.violations).toContain("FRAGMENT_OVERFLOW");
  });

  it("deterministic replay do validator", () => {
    const a = run({ messages: [{ text: "  kkkk ", fragmentIndex: 0 }] });
    const b = run({ messages: [{ text: "  kkkk ", fragmentIndex: 0 }] });
    expect(a).toEqual(b);
  });
});
