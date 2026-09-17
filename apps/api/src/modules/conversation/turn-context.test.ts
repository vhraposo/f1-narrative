import { describe, expect, it } from "vitest";
import {
  appendTurnReply,
  createTurnContext,
  TURN_CONTEXT_VERSION,
} from "./turn-context.js";

describe("turn-context (STEP 109F)", () => {
  it("createTurnContext define os campos âncora e previousReplies vazio por default", () => {
    const turn = createTurnContext({
      userMessage: "O que acharam?",
      userCharacterId: "user-1",
      userCharacterName: "Alicya",
    });
    expect(TURN_CONTEXT_VERSION).toBe("turn-context.v1");
    expect(turn.userMessage).toBe("O que acharam?");
    expect(turn.userCharacterId).toBe("user-1");
    expect(turn.userCharacterName).toBe("Alicya");
    expect(turn.previousReplies).toEqual([]);
  });

  it("createTurnContext aceita previousReplies iniciais em ordem", () => {
    const turn = createTurnContext({
      userMessage: "x",
      userCharacterId: "user-1",
      userCharacterName: "Alicya",
      previousReplies: [
        {
          speakerCharacterId: "kimi",
          speakerName: "Kimi",
          senderType: "AI_CHARACTER",
          content: "Vi a corrida.",
        },
      ],
    });
    expect(turn.previousReplies).toHaveLength(1);
    expect(turn.previousReplies[0].speakerName).toBe("Kimi");
  });

  it("appendTurnReply é imutável: retorna novo contexto e preserva o original", () => {
    const turn = createTurnContext({
      userMessage: "x",
      userCharacterId: "user-1",
      userCharacterName: "Alicya",
    });
    const next = appendTurnReply(turn, {
      speakerCharacterId: "kimi",
      speakerName: "Kimi",
      senderType: "AI_CHARACTER",
      content: "Primeira fala.",
    });
    expect(turn.previousReplies).toEqual([]);
    expect(next.previousReplies).toHaveLength(1);
    expect(next).not.toBe(turn);
  });

  it("appendTurnReply preserva a ordem de chegada (sequência de geração)", () => {
    let turn = createTurnContext({
      userMessage: "x",
      userCharacterId: "user-1",
      userCharacterName: "Alicya",
    });
    turn = appendTurnReply(turn, {
      speakerCharacterId: "kimi",
      speakerName: "Kimi",
      senderType: "AI_CHARACTER",
      content: "Primeira fala.",
    });
    turn = appendTurnReply(turn, {
      speakerCharacterId: "lando",
      speakerName: "Lando",
      senderType: "AI_CHARACTER",
      content: "Segunda fala.",
    });
    expect(turn.previousReplies.map((r) => r.speakerName)).toEqual([
      "Kimi",
      "Lando",
    ]);
    expect(turn.previousReplies.map((r) => r.content)).toEqual([
      "Primeira fala.",
      "Segunda fala.",
    ]);
  });
});