import { describe, expect, it } from "vitest";

import { evaluateConversationEnergy } from "./conversation.energy.js";
import { deriveDialogueEmotion } from "./conversation.dialogue-emotion.js";
import { deriveDialogueTopic } from "./conversation.dialogue-topic.js";
import { buildDialogueMemoryContext } from "./conversation.dialogue-memory.js";
import {
  buildDialogueContext,
  buildDialogueKnowledgeContext,
  DialogueContextSchema,
  DialogueKnowledgeContextSchema,
  type KnowledgeMemoryInput,
} from "./conversation.dialogue-context.js";

const WORLD_DATE = new Date("2026-10-01T12:00:00.000Z");

function memoryInput(
  id: string,
  importance: "LOW" | "MEDIUM" | "HIGH",
  summary: string | null,
  content: string,
  universeId: string | null = "uni-1",
): KnowledgeMemoryInput {
  return { id, importance, summary, content, universeId };
}

function retrieved(id: string, score: number, summary: string | null, content: string) {
  return {
    id,
    summary,
    content,
    importance: "MEDIUM" as const,
    memoryType: null,
    createdAt: WORLD_DATE,
    score,
  };
}

function contextFor(input: {
  speaker: string;
  affinity: number | null;
  messages: readonly { content: string }[];
  memories: readonly ReturnType<typeof retrieved>[];
  knowledgeMemories: readonly KnowledgeMemoryInput[];
}) {
  const energy = evaluateConversationEnergy({
    message: input.messages[0]?.content ?? "",
    participantCount: 3,
    recentAiMessages: 0,
  });
  const emotion = deriveDialogueEmotion({
    energy,
    affinity: input.affinity,
    recentMessages: input.messages,
  });
  const topic = deriveDialogueTopic({ messages: input.messages, previousTopic: null });
  const memory = buildDialogueMemoryContext({
    characterId: input.speaker,
    conversationParticipantIds: ["user-a", input.speaker, "ai-outro"],
    memories: input.memories,
  });
  const knowledge = buildDialogueKnowledgeContext({
    universeId: "uni-1",
    memories: input.knowledgeMemories,
  });
  return buildDialogueContext({
    speakerCharacterId: input.speaker,
    emotion,
    topic,
    memory,
    knowledge,
    affinity: input.affinity,
  });
}

describe("F5.4 — DialogueContext por speaker e assimetria de conhecimento", () => {
  it("F5-E01 mesmo tópico, emoção diferente por speaker", () => {
    const messages = [{ content: "bom dia amigos" }];
    const close = contextFor({ speaker: "ai-kimi", affinity: 0.9, messages, memories: [], knowledgeMemories: [] });
    const distant = contextFor({ speaker: "ai-max", affinity: 0.1, messages, memories: [], knowledgeMemories: [] });
    expect(close.topic?.topicTag).toBe(distant.topic?.topicTag);
    expect(close.emotion?.tone).not.toBe(distant.emotion?.tone);
    expect(close.relationship.closeness).toBe("CLOSE");
    expect(distant.relationship.closeness).toBe("DISTANT");
  });

  it("F5-E02 mesma conversa, memórias diferentes", () => {
    const messages = [{ content: "vocês viram a corrida?" }];
    const kimi = contextFor({
      speaker: "ai-kimi",
      affinity: 0.5,
      messages,
      memories: [retrieved("m-kimi", 90, "resumo de Kimi", "c")],
      knowledgeMemories: [],
    });
    const max = contextFor({ speaker: "ai-max", affinity: 0.5, messages, memories: [], knowledgeMemories: [] });
    expect(kimi.memory.items[0]?.memoryId).toBe("m-kimi");
    expect(max.memory.items).toEqual([]);
  });

  it("F5-E03 fato privado conhecido por um speaker e não pelo outro", () => {
    const privateFact = memoryInput("fact-1", "HIGH", "Kimi sabe do segredo", "conteudo");
    const kimi = contextFor({
      speaker: "ai-kimi",
      affinity: 0.5,
      messages: [{ content: "oi" }],
      memories: [],
      knowledgeMemories: [privateFact],
    });
    const max = contextFor({
      speaker: "ai-max",
      affinity: 0.5,
      messages: [{ content: "oi" }],
      memories: [],
      knowledgeMemories: [],
    });
    expect(kimi.knowledge.knownFacts[0]?.factId).toBe("fact-1");
    expect(max.knowledge.knownFacts).toEqual([]);
  });

  it("F5-E04 fato público é igual para todos e limitação registrada", () => {
    const a = buildDialogueKnowledgeContext({ universeId: "uni-1", memories: [] });
    const b = buildDialogueKnowledgeContext({ universeId: "uni-1", memories: [] });
    expect(a.publicFacts).toEqual(b.publicFacts);
    expect(a.publicFacts).toEqual([]);
    expect(a.source).toBe("MEMORY_SCOPE");
  });

  it("F5-E05 topic shift é preservado no contexto", () => {
    const topic = deriveDialogueTopic({
      messages: [{ content: "KKKK vocês são impossíveis" }],
      previousTopic: "race",
    });
    expect(topic?.changed).toBe(true);
    expect(topic?.previousTopic).toBe("race");
    expect(topic?.topicTag).toBe("joke");
  });

  it("F5-E06 callback de memória aparece como fato conhecido", () => {
    const knowledge = buildDialogueKnowledgeContext({
      universeId: "uni-1",
      memories: [memoryInput("bomba", "HIGH", "piada da bomba d'água", "conteudo")],
    });
    expect(knowledge.knownFacts[0]?.summary).toContain("bomba");
  });

  it("F5-E07 memória irrelevante/baixa é excluída e vazia é ignorada", () => {
    const knowledge = buildDialogueKnowledgeContext({
      universeId: "uni-1",
      memories: [
        memoryInput("low", "LOW", "detalhe irrelevante", "c"),
        memoryInput("empty", "HIGH", "   ", "   "),
        memoryInput("high", "HIGH", "relevante", "c"),
      ],
    });
    expect(knowledge.knownFacts.map((fact) => fact.factId)).toEqual(["high"]);
  });

  it("F5-E08 memória de outro Universe é rejeitada", () => {
    const knowledge = buildDialogueKnowledgeContext({
      universeId: "uni-1",
      memories: [
        memoryInput("outro", "HIGH", "outro universo", "c", "uni-2"),
        memoryInput("proprio", "HIGH", "meu universo", "c", "uni-1"),
      ],
    });
    expect(knowledge.knownFacts.map((fact) => fact.factId)).toEqual(["proprio"]);
  });

  it("contexto é bounded, determinístico e serializável", () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      memoryInput(`f${index}`, "HIGH", `fato ${index}`, "c"),
    );
    const a = buildDialogueKnowledgeContext({ universeId: "uni-1", memories: many });
    const b = buildDialogueKnowledgeContext({ universeId: "uni-1", memories: many });
    expect(a.knownFacts.length).toBeLessThanOrEqual(3);
    expect(a.publicFacts.length).toBeLessThanOrEqual(3);
    expect(a).toEqual(b);
    expect(DialogueKnowledgeContextSchema.safeParse(a).success).toBe(true);

    const context = contextFor({
      speaker: "ai-kimi",
      affinity: 0.9,
      messages: [{ content: "vocês viram a corrida?" }],
      memories: [retrieved("m1", 50, "resumo", "c")],
      knowledgeMemories: [memoryInput("f1", "HIGH", "fato", "c")],
    });
    expect(DialogueContextSchema.safeParse(context).success).toBe(true);
    expect(Object.keys(context).sort()).toEqual([
      "emotion",
      "knowledge",
      "memory",
      "relationship",
      "speakerCharacterId",
      "topic",
    ]);
  });
});
