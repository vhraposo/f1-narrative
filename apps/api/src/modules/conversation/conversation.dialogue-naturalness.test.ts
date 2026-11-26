import { describe, expect, it } from "vitest";

import {
  isEchoOfInterlocutor,
  validateConversationNaturalness,
} from "./conversation.dialogue-naturalness.js";

function check(
  text: string,
  overrides: Partial<Parameters<typeof validateConversationNaturalness>[0]> = {},
) {
  return validateConversationNaturalness({
    text,
    replyToContent: null,
    emotionTone: null,
    emojiAllowed: true,
    ...overrides,
  });
}

describe("F22.3 — naturalness guardrails", () => {
  it("aceita respostas curtas que repetem parte do interlocutor", () => {
    expect(isEchoOfInterlocutor("vou", "você vai?")).toBe(false);
    expect(isEchoOfInterlocutor("sim, amanhã", "você vai amanhã?")).toBe(false);
    expect(check("sim, amanhã", { replyToContent: "você vai amanhã?" })).toEqual([]);
  });

  it("detecta eco longo do interlocutor", () => {
    const reply = "eu perdi meu voo porque o aeroporto estava fechado";
    expect(isEchoOfInterlocutor(reply, reply)).toBe(true);
    expect(
      isEchoOfInterlocutor(
        "você perdeu seu voo porque o aeroporto estava fechado",
        reply,
      ),
    ).toBe(true);
    expect(check("você perdeu seu voo porque o aeroporto estava fechado", {
      replyToContent: reply,
    })).toContain("ECHO_OF_INTERLOCUTOR");
  });

  it("detecta vazamento estrutural (JSON, fence, rótulos)", () => {
    expect(check(']}😊 texto')).toContain("STRUCTURAL_LEAKAGE");
    expect(check('{"messages":["oi"]}')).toContain("STRUCTURAL_LEAKAGE");
    expect(check("```json oi")).toContain("STRUCTURAL_LEAKAGE");
    expect(check("Assistant: oi")).toContain("STRUCTURAL_LEAKAGE");
    expect(check("Resposta: oi")).toContain("STRUCTURAL_LEAKAGE");
  });

  it("detecta degeneração de emoji sem proibir emoji adequado", () => {
    expect(check("😊😊😊😊")).toContain("EMOJI_DEGENERATION");
    expect(check("😊")).toContain("EMOJI_DEGENERATION");
    expect(check("kkkk 😂")).toEqual([]);
    expect(check("oi 😊", { emojiAllowed: false })).toContain("EMOJI_DEGENERATION");
    expect(check("oi 😊", { emotionTone: "SAD" })).toContain("EMOJI_DEGENERATION");
  });

  it("detecta tom de assistente e action claim", () => {
    expect(check("Estou aqui para ajudar, hein! 🤗")).toContain("ASSISTANT_TONE");
    expect(check("Quer alguma coisa para te ajudar a se sentir melhor?")).toContain(
      "ASSISTANT_TONE",
    );
    expect(check("posso ajudar com algo?")).toContain("ASSISTANT_TONE");
    expect(check("vou verificar na previsão de tempo!")).toContain("ACTION_CLAIM");
    expect(check("não sei, mas devemos verificar na tv do tempo")).toContain("ACTION_CLAIM");
    expect(check("não acho, ainda estou vendo o tempo na internet")).toContain("ACTION_CLAIM");
    expect(check("eu vou dormir")).toEqual([]);
    expect(check("eu verificaria isso depois")).toEqual([]);
  });

  it("respeita questionMode FORBIDDEN sem bloquear OPTIONAL/REQUIRED", () => {
    expect(check("perdemos de que jogo?", { questionMode: "FORBIDDEN" })).toContain(
      "QUESTION_NOT_ALLOWED",
    );
    expect(check("tudo bem?", { questionMode: "OPTIONAL" })).toEqual([]);
    expect(check("você vai?", { questionMode: "REQUIRED" })).toEqual([]);
    expect(check("que jogo foi esse?", { questionMode: null })).toEqual([]);
  });

  it("não marca texto normal e preserva regras existentes", () => {
    expect(check("pior que sim")).toEqual([]);
    expect(check("Vamos marcar um café, eu estou livre na quinta-feira.")).toEqual([]);
  });
});
