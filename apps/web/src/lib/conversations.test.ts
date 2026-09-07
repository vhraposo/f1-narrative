import { describe, expect, it } from "vitest";

import {
  defaultGroupSeasonYear,
  findDefaultGroup,
  formatChatTime,
  formatListTime,
  isDefaultGroup,
  isDefaultGroupTitle,
  type Conversation,
} from "@/lib/conversations";

function group(id: string, title: string | null): Conversation {
  return {
    id,
    title,
    type: "GROUP",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    participants: [],
    messageCount: 0,
  };
}

function dm(id: string, title: string | null): Conversation {
  return {
    id,
    title,
    type: "DM",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    participants: [],
    messageCount: 0,
  };
}

describe("grupo padrão da temporada", () => {
  it("reconhece títulos canônicos (com e sem ano)", () => {
    expect(isDefaultGroupTitle("Grupo dos Pilotos")).toBe(true);
    expect(isDefaultGroupTitle("Grupo dos Pilotos · 2026")).toBe(true);
    expect(isDefaultGroupTitle("  Grupo  dos  Pilotos  ·  2026 ")).toBe(true);
    expect(isDefaultGroupTitle("Garagem Paddock")).toBe(false);
    expect(isDefaultGroupTitle(null)).toBe(false);
  });

  it("extrai o ano do sufixo (apenas quando real)", () => {
    expect(defaultGroupSeasonYear("Grupo dos Pilotos")).toBeNull();
    expect(defaultGroupSeasonYear("Grupo dos Pilotos · 2026")).toBe(2026);
    expect(defaultGroupSeasonYear("Grupo dos Pilotos · abc")).toBeNull();
  });

  it("encontra o grupo do universo quando ele existe", () => {
    const conversations = [dm("c1", null), group("g1", "Grupo dos Pilotos · 2026")];
    expect(findDefaultGroup(conversations, 2026)?.id).toBe("g1");
  });

  it("prefere o grupo da temporada atual quando há múltiplos", () => {
    const conversations = [
      group("old", "Grupo dos Pilotos · 2025"),
      group("current", "Grupo dos Pilotos · 2026"),
    ];
    expect(findDefaultGroup(conversations, 2026)?.id).toBe("current");
    expect(findDefaultGroup(conversations)?.id).toBe("old");
  });

  it("não fabrica grupo: retorna null quando não existe", () => {
    expect(findDefaultGroup([dm("c1", null), group("g1", "Garagem Paddock")], 2026)).toBeNull();
    expect(findDefaultGroup([], 2026)).toBeNull();
  });

  it("isDefaultGroup só considera GROUP de verdade", () => {
    expect(isDefaultGroup(group("g1", "Grupo dos Pilotos"))).toBe(true);
    expect(isDefaultGroup({ ...dm("c1", "Grupo dos Pilotos"), title: "Grupo dos Pilotos" })).toBe(false);
  });
});

describe("horários de chat", () => {
  it("formata data passada de outro ano como data curta", () => {
    expect(formatChatTime("2025-09-05T12:00:00.000Z")).toBe("05/09/2025");
  });

  it("formata data do mesmo ano como 05 SET", () => {
    const year = new Date().getFullYear();
    expect(formatChatTime(`${year}-09-05T12:00:00.000Z`)).toBe("05 SET");
  });

  it("não aceita data inválida", () => {
    expect(formatChatTime("nada")).toBe("");
    expect(formatListTime("nada")).toBe("");
  });

  it("formata lista do dia atual como HH:mm (sem status inventado)", () => {
    const label = formatListTime(new Date().toISOString());
    expect(label).toMatch(/^\d{2}:\d{2}$/);
  });
});