import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import { composePilotContextPromptBlock } from "./pilot-context.prompt.js";
import { resolvePilotContext } from "./pilot-context.resolver.js";

const PREFIX = "pc-mem";
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];

afterAll(async () => {
  await prisma.memoryCharacter.deleteMany({
    where: { character: { name: { startsWith: PREFIX } } },
  });
  await prisma.memory.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
  await prisma.pilotExperience.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
  await prisma.character.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.universe.deleteMany({ where: { id: { in: createdUniverseIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

async function createFixture(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `${PREFIX}-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@f1nw.test`,
      name: `Owner ${label}`,
    },
  });
  createdUserIds.push(user.id);
  const universe = await prisma.universe.create({ data: { userId: user.id, status: "READY" } });
  createdUniverseIds.push(universe.id);
  const character = await prisma.character.create({
    data: {
      universeId: universe.id,
      controlledBy: "AI",
      name: `${PREFIX} ${label}`,
      nationality: "BRA",
      birthDate: new Date("2000-01-01T00:00:00.000Z"),
      driverProfile: { create: { number: 7 } },
    },
  });
  return { user, universe, character };
}

async function createDerivedMemory(input: {
  universeId: string;
  characterId: string;
  content: string;
  importance: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  memoryType: string | null;
  revision?: number;
  status?: "ACTIVE" | "ARCHIVED" | "SUPERSEDED" | "INVALIDATED";
  occurredAt?: Date | null;
  derivedKey?: string | null;
}) {
  const experience = await prisma.pilotExperience.create({
    data: {
      universeId: input.universeId,
      characterId: input.characterId,
      experienceType: "CHAMPIONSHIP",
      source: "STANDING",
      sourceKey: `${PREFIX}-${Math.random().toString(36).slice(2, 9)}`,
      salience: input.importance,
      title: "Experiência base",
      occurredAt: input.occurredAt ?? null,
    },
  });
  return prisma.memory.create({
    data: {
      universeId: input.universeId,
      derivation: "RULE_DERIVED",
      status: input.status ?? "ACTIVE",
      revision: input.revision ?? 1,
      importance: input.importance,
      source: "GENERATED_EVENT",
      memoryType: input.memoryType as never,
      content: input.content,
      summary: null,
      derivedKey: input.derivedKey ?? null,
      experienceId: experience.id,
      participants: { create: [{ characterId: input.characterId }] },
    },
  });
}

describe("pilot context memories", () => {
  it("1) inclui ACTIVE do speaker e exclui inválidas/arquivadas/terceiros/outro Universe", async () => {
    const fixture = await createFixture("scope");
    const other = await createFixture("other");
    await createDerivedMemory({
      universeId: fixture.universe.id,
      characterId: fixture.character.id,
      content: "MEM-ATIVA do speaker",
      importance: "HIGH",
      memoryType: "CHAMPIONSHIP",
    });
    await createDerivedMemory({
      universeId: fixture.universe.id,
      characterId: fixture.character.id,
      content: "MEM-INVALIDA",
      importance: "CRITICAL",
      memoryType: "SPORTING_VICTORY",
      status: "INVALIDATED",
    });
    await createDerivedMemory({
      universeId: fixture.universe.id,
      characterId: fixture.character.id,
      content: "MEM-ARQUIVADA",
      importance: "HIGH",
      memoryType: "TEAM_CHANGE",
      status: "ARCHIVED",
    });
    await createDerivedMemory({
      universeId: other.universe.id,
      characterId: other.character.id,
      content: "MEM-TERCEIRO",
      importance: "CRITICAL",
      memoryType: "CHAMPIONSHIP",
    });
    await prisma.memory.create({
      data: {
        universeId: other.universe.id,
        derivation: "RULE_DERIVED",
        status: "ACTIVE",
        importance: "CRITICAL",
        source: "GENERATED_EVENT",
        content: "MEM-OUTRO-UNIVERSE-DO-SPEAKER",
        participants: { create: [{ characterId: fixture.character.id }] },
      },
    });

    const view = await resolvePilotContext({ speakerCharacterId: fixture.character.id });
    if (!view) throw new Error("unreachable");
    const contents = view.memories.map((memory) => memory.content);
    expect(contents.some((content) => content.includes("MEM-ATIVA"))).toBe(true);
    expect(contents.some((content) => content.includes("MEM-INVALIDA"))).toBe(false);
    expect(contents.some((content) => content.includes("MEM-ARQUIVADA"))).toBe(false);
    expect(contents.some((content) => content.includes("MEM-TERCEIRO"))).toBe(false);
    expect(contents.some((content) => content.includes("MEM-OUTRO-UNIVERSE-DO-SPEAKER"))).toBe(false);
  });

  it("2) relevância por tópico ordena a memória do ano citado primeiro", async () => {
    const fixture = await createFixture("topic");
    await createDerivedMemory({
      universeId: fixture.universe.id,
      characterId: fixture.character.id,
      content: "Título de 2021",
      importance: "HIGH",
      memoryType: "CHAMPIONSHIP",
      occurredAt: new Date("2021-12-01"),
    });
    await createDerivedMemory({
      universeId: fixture.universe.id,
      characterId: fixture.character.id,
      content: "Título de 2025",
      importance: "HIGH",
      memoryType: "CHAMPIONSHIP",
      occurredAt: new Date("2025-12-01"),
    });
    const view = await resolvePilotContext({
      speakerCharacterId: fixture.character.id,
      topic: "o que aconteceu em 2025?",
    });
    if (!view) throw new Error("unreachable");
    expect(view.memories[0]?.content).toContain("2025");
    const block = composePilotContextPromptBlock(view);
    expect(block.text).toContain("[CHAMPIONSHIP]");
    expect(block.text).not.toContain("MEM-");
    expect(block.text).not.toContain("derivedKey");
  });

  it("3) fingerprint muda com revisão de memória (sem depender de timestamp)", async () => {
    const fixture = await createFixture("fingerprint");
    const memory = await createDerivedMemory({
      universeId: fixture.universe.id,
      characterId: fixture.character.id,
      content: "Memória versionada",
      importance: "HIGH",
      memoryType: "SPORTING_VICTORY",
    });
    const first = await resolvePilotContext({ speakerCharacterId: fixture.character.id });
    const second = await resolvePilotContext({ speakerCharacterId: fixture.character.id });
    if (!first || !second) throw new Error("unreachable");
    expect(first.fingerprint).toBe(second.fingerprint);

    await prisma.memory.update({
      where: { id: memory.id },
      data: { revision: 2, updatedByRevisionAt: new Date() },
    });
    const third = await resolvePilotContext({ speakerCharacterId: fixture.character.id });
    if (!third) throw new Error("unreachable");
    expect(third.fingerprint).not.toBe(first.fingerprint);
  });

  it("4) memória manual legada (universeId null) permanece utilizável", async () => {
    const fixture = await createFixture("legacy");
    await prisma.memory.create({
      data: {
        derivation: "MANUAL",
        status: "ACTIVE",
        importance: "MEDIUM",
        source: "USER_DEFINED",
        content: "MEM-LEGADA-MANUAL",
        participants: { create: [{ characterId: fixture.character.id }] },
      },
    });
    const view = await resolvePilotContext({ speakerCharacterId: fixture.character.id });
    if (!view) throw new Error("unreachable");
    expect(view.memories.some((memory) => memory.content.includes("MEM-LEGADA-MANUAL"))).toBe(true);
    expect(view.memories[0]?.memoryType).toBeNull();
    expect(view.memories[0]?.revision).toBe(1);
  });
});
