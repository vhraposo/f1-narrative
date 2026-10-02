import { describe, expect, it } from "vitest";

import { deriveDialogueTopic, DialogueTopicContextSchema } from "./conversation.dialogue-topic.js";

describe("F5.2 — tópico derivado do diálogo", () => {
  it("identifica tópico de classificação/corrida", () => {
    const topic = deriveDialogueTopic({ messages: [{ content: "vocês viram a classificação?" }] });
    expect(topic?.topicTag).toBe("qualifying");
    expect(topic?.sourceSignals).toContain("QUALIFYING_KEYWORDS");
    expect(topic?.confidence).toBeGreaterThan(0);
  });

  it("identifica corrida quando não há classificação", () => {
    const topic = deriveDialogueTopic({ messages: [{ content: "aquela corrida foi insana" }] });
    expect(topic?.topicTag).toBe("race");
  });

  it("sem sinais retorna null", () => {
    expect(deriveDialogueTopic({ messages: [{ content: "ok" }] })).toBeNull();
    expect(deriveDialogueTopic({ messages: [] })).toBeNull();
  });

  it("detecta mudança de tópico contra o anterior", () => {
    const topic = deriveDialogueTopic({
      messages: [{ content: "KKKK vocês são impossíveis" }],
      previousTopic: "race",
    });
    expect(topic?.topicTag).toBe("joke");
    expect(topic?.previousTopic).toBe("race");
    expect(topic?.changed).toBe(true);
  });

  it("mantém changed=false quando o tópico é o mesmo", () => {
    const topic = deriveDialogueTopic({
      messages: [{ content: "a corrida vai ser complicada" }],
      previousTopic: "race",
    });
    expect(topic?.topicTag).toBe("race");
    expect(topic?.changed).toBe(false);
  });

  it("usa mensagens recentes e limita sinais a 4", () => {
    const topic = deriveDialogueTopic({
      messages: [
        { content: "KKKK que piada" },
        { content: "tô nervoso com a classificação e a chuva" },
      ],
    });
    expect(topic).not.toBeNull();
    expect(topic!.sourceSignals.length).toBeLessThanOrEqual(4);
  });

  it("deterministic replay: mesmos sinais, mesmo tópico", () => {
    const input = { messages: [{ content: "vocês viram a corrida?" }], previousTopic: "joke" as const };
    expect(deriveDialogueTopic(input)).toEqual(deriveDialogueTopic(input));
  });

  it("contexto é pequeno, serializável e sem campos extras", () => {
    const topic = deriveDialogueTopic({ messages: [{ content: "chuva na pista" }] });
    expect(Object.keys(topic!).sort()).toEqual([
      "changed",
      "confidence",
      "previousTopic",
      "sourceSignals",
      "topicTag",
    ]);
    expect(DialogueTopicContextSchema.safeParse(topic).success).toBe(true);
  });
});
