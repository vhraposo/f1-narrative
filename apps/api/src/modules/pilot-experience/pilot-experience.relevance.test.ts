import { describe, expect, it } from "vitest";

import {
  extractMentionedYear,
  scoreMemoryRelevance,
  selectRelevantMemories,
  type RelevanceMemoryInput,
} from "./pilot-experience.relevance.js";

function memory(overrides: Partial<RelevanceMemoryInput> & { id: string }): RelevanceMemoryInput {
  return {
    revision: 1,
    importance: "MEDIUM",
    memoryType: null,
    content: "conteúdo",
    summary: null,
    occurredAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    derivedKey: null,
    ...overrides,
  };
}

describe("pilot memory relevance", () => {
  it("1) extrai ano mencionado e prioriza memória do mesmo ano", () => {
    expect(extractMentionedYear("o que aconteceu em 2025?")).toBe(2025);
    expect(extractMentionedYear("sem ano")).toBeNull();

    const memories = [
      memory({ id: "m2021", content: "Título de 2021", occurredAt: new Date("2021-12-01") }),
      memory({ id: "m2025", content: "Título de 2025", occurredAt: new Date("2025-12-01") }),
    ];
    const selected = selectRelevantMemories(memories, { topic: "como foi 2025?", worldDate: new Date("2026-01-01") }, 1);
    expect(selected[0]?.id).toBe("m2025");
  });

  it("2) tópico textual e career-defining elevam o score", () => {
    const championship = memory({
      id: "champ",
      importance: "CRITICAL",
      memoryType: "CHAMPIONSHIP",
      content: "Campeão mundial em 2025.",
      occurredAt: new Date("2025-12-01"),
    });
    const small = memory({ id: "small", importance: "LOW", content: "Detalhe pequeno." });
    expect(scoreMemoryRelevance(championship, { topic: "campeonato", worldDate: new Date("2026-01-01") })).toBeGreaterThan(
      scoreMemoryRelevance(small, { topic: "campeonato", worldDate: new Date("2026-01-01") }),
    );
    const selected = selectRelevantMemories([small, championship], { topic: null, worldDate: new Date("2026-01-01") }, 2);
    expect(selected[0]?.id).toBe("champ");
  });

  it("3) recência desempata e a ordenação é determinística", () => {
    const older = memory({ id: "a", importance: "HIGH", content: "Vitória antiga", occurredAt: new Date("2024-01-01") });
    const newer = memory({ id: "b", importance: "HIGH", content: "Vitória recente", occurredAt: new Date("2026-01-01") });
    const first = selectRelevantMemories([older, newer], { topic: null, worldDate: new Date("2026-06-01") }, 2);
    const second = selectRelevantMemories([newer, older], { topic: null, worldDate: new Date("2026-06-01") }, 2);
    expect(first.map((entry) => entry.id)).toEqual(second.map((entry) => entry.id));
    expect(first[0]?.id).toBe("b");
  });

  it("4) tópico sem correspondência não inventa relevância", () => {
    const memories = [
      memory({ id: "x", content: "Campeão mundial em 2025", importance: "CRITICAL" }),
      memory({ id: "y", content: "Mudança de equipe", importance: "MEDIUM" }),
    ];
    const selected = selectRelevantMemories(memories, { topic: "clima em Mônaco", worldDate: new Date("2026-01-01") }, 2);
    expect(selected[0]?.id).toBe("x");
  });
});
