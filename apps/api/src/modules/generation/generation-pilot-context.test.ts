import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import { deleteKnowledgeSourcesForDrivers } from "../../test-utils/pilot-knowledge-cleanup.js";
import { deleteUniverseDataForUsers } from "../../test-utils/universe-cleanup.js";
import { ingestPersonaEvidenceForDriver } from "../pilot-knowledge/pilot-knowledge.persona.js";
import { upsertDriverProfileFromProvider } from "../pilot-knowledge/pilot-knowledge.profile.js";
import { createTurnContext } from "../conversation/turn-context.js";
import {
  assembleGenerationBundle,
  computeGenerationKey,
  countEmittedSections,
  type GenerationProvider,
  type ProviderInput,
} from "./generation.assembly.js";

type Fixture = {
  readonly characterId: string;
  readonly characterName: string;
  readonly driverId: string;
};

const createdUserIds: string[] = [];
const createdConversationIds: string[] = [];
let ownerId: string;
let conversationId: string;
let alice: Fixture;
let bob: Fixture;
let plain: Fixture;
let memoryId: string | null = null;

function spyProvider(capture: { input?: ProviderInput }): GenerationProvider {
  return {
    name: "spy",
    async run(input) {
      capture.input = input;
      return {
        provider: "spy",
        mode: "generated",
        text: "resposta",
        tokenStats: {
          systemPromptChars: input.systemPrompt.length,
          contextBlocks: countEmittedSections(input.systemPrompt),
        },
      };
    },
  };
}

async function bundleFor(characterId: string, options?: { providerUserPrompt?: string; withTurnContext?: boolean }) {
  const capture: { input?: ProviderInput } = {};
  const result = await assembleGenerationBundle(
    prisma,
    {
      conversationId,
      userId: ownerId,
      targetCharacterId: characterId,
      userPrompt: "Oi, tudo bem?",
      ...(options?.providerUserPrompt ? { providerUserPrompt: options.providerUserPrompt } : {}),
      ...(options?.withTurnContext
        ? {
            turnContext: createTurnContext({
              userMessage: "Pergunta do turno",
              userCharacterId: "00000000-0000-4000-8000-000000000098",
              userCharacterName: "Espectador",
              previousReplies: [
                {
                  speakerCharacterId: bob.characterId,
                  speakerName: bob.characterName,
                  senderType: "AI_CHARACTER",
                  content: "Primeira réplica",
                },
              ],
            }),
          }
        : {}),
    },
    spyProvider(capture),
  );
  return { result, input: capture.input };
}

function sectionIds(prompt: string): string[] {
  return [...prompt.matchAll(/<BEGIN \d+:([A-Z_]+)>/g)].map((match) => match[1]!);
}

function sectionText(prompt: string, id: string): string {
  const match = prompt.match(new RegExp(`<BEGIN \\d+:${id}>\\n([\\s\\S]*?)\\n<END \\d+:${id}>`));
  return match?.[1] ?? "";
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      name: "GP Pilot",
      email: `gp-pilot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@f1nw.test`,
      password: null,
      emailVerified: true,
    },
  });
  createdUserIds.push(user.id);
  ownerId = user.id;
  const universe = await prisma.universe.create({ data: { userId: user.id } });

  async function createPilot(label: string, options?: { readonly withKnowledge?: boolean }): Promise<Fixture> {
    const driver = await prisma.externalDriver.create({
      data: {
        source: "f1db",
        externalId: `gp-pilot-${label}-${Date.now()}`,
        name: `GP-${label}`,
        nationality: "NED",
        number: 33,
        contentHash: `hash-${label}`,
      },
    });
    const character = await prisma.character.create({
      data: {
        universeId: universe.id,
        controlledBy: "AI",
        name: `GP-${label}`,
        nationality: "NED",
        birthDate: new Date("1997-09-30T00:00:00.000Z"),
        driverProfile: { create: { number: 33 } },
      },
    });
    await prisma.externalBindingDriver.create({
      data: { universeId: universe.id, externalDriverId: driver.id, characterId: character.id },
    });
    if (options?.withKnowledge !== false) {
      await upsertDriverProfileFromProvider(driver.id, {
        publicName: `GP-${label}`,
        representedCountry: "Países Baixos",
        currentTeamName: `Equipe ${label}`,
        biographyFacts: { publicName: `GP-${label}`, nationality: "Países Baixos" },
      });
      await ingestPersonaEvidenceForDriver(driver.id, [
        {
          traitKey: "communicationStyle",
          proposedValue: `TRAIT-${label}-MARKER`,
          sourceKind: "OBSERVED_PUBLIC_BEHAVIOR",
          evidenceType: "TEAM_PROFILE",
          summary: `SUMMARY-${label}-MARKER`,
          confidence: 0.81,
          source: {
            provider: "TEAM_OFFICIAL",
            sourceKind: "OFFICIAL_PROFILE",
            url: `https://team.example/gp-pilot-${label}`,
            title: `Perfil ${label}`,
            license: "PROPRIETARY_REFERENCE_ONLY",
          },
        },
      ]);
    }
    return { characterId: character.id, characterName: character.name, driverId: driver.id };
  }

  alice = await createPilot("Alice");
  bob = await createPilot("Bob");
  plain = await createPilot("Plain", { withKnowledge: false });

  const conversation = await prisma.conversation.create({ data: { type: "GROUP" } });
  createdConversationIds.push(conversation.id);
  conversationId = conversation.id;
  await prisma.conversationParticipant.createMany({
    data: [alice.characterId, bob.characterId, plain.characterId].map((characterId) => ({
      conversationId,
      characterId,
    })),
  });

  const memory = await prisma.memory.create({
    data: {
      content: "MEMORY-MARKER do Universe",
      importance: "HIGH",
      source: "USER_DEFINED",
      participants: { create: [{ characterId: alice.characterId }] },
    },
  });
  memoryId = memory.id;
});

afterAll(async () => {
  if (memoryId) {
    await prisma.memory.deleteMany({ where: { id: memoryId } });
  }
  if (createdConversationIds.length > 0) {
    await prisma.conversationParticipant.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  }
  const drivers = await prisma.externalDriver.findMany({
    where: { externalId: { startsWith: "gp-pilot-" } },
    select: { id: true },
  });
  const driverIds = drivers.map((driver) => driver.id);
  await deleteKnowledgeSourcesForDrivers(prisma, driverIds);
  if (driverIds.length > 0) {
    await prisma.externalDriverEvent.deleteMany({ where: { externalDriverId: { in: driverIds } } });
    await prisma.externalDriver.deleteMany({ where: { id: { in: driverIds } } });
  }
  await deleteUniverseDataForUsers(prisma, createdUserIds);
  await prisma.universe.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("generation pilot context", () => {
  it("1) speaker Alice recebe PILOT_CONTEXT após CHARACTER_DNA e só com dados dela", async () => {
    const { result } = await bundleFor(alice.characterId);
    const ids = sectionIds(result.systemPrompt);
    expect(ids).toContain("PILOT_CONTEXT");
    if (ids.includes("CHARACTER_DNA")) {
      expect(ids.indexOf("PILOT_CONTEXT")).toBe(ids.indexOf("CHARACTER_DNA") + 1);
    } else {
      expect(ids.indexOf("PILOT_CONTEXT")).toBe(ids.indexOf("ACTIVE_SPEAKER") + 1);
    }
    expect(ids.indexOf("PILOT_CONTEXT")).toBeLessThan(ids.indexOf("WORLD_STATE"));
    const text = sectionText(result.systemPrompt, "PILOT_CONTEXT");
    expect(text).toContain("TRAIT-Alice-MARKER");
    expect(text).toContain("GP-Alice");
    expect(text).toContain("MEMORY-MARKER do Universe");
    expect(text).not.toContain("TRAIT-Bob-MARKER");
    expect(text).not.toContain("GP-Bob");
  });

  it("2) speaker Bob recebe contexto dele; Maxine/terceiros fora", async () => {
    const { result } = await bundleFor(bob.characterId);
    const text = sectionText(result.systemPrompt, "PILOT_CONTEXT");
    expect(text).toContain("TRAIT-Bob-MARKER");
    expect(text).not.toContain("TRAIT-Alice-MARKER");
  });

  it("3) evidence raw, confidence, URL e ids internos nunca entram", async () => {
    const { result } = await bundleFor(alice.characterId);
    const text = sectionText(result.systemPrompt, "PILOT_CONTEXT");
    expect(text).not.toContain("SUMMARY-Alice-MARKER");
    expect(text).not.toContain("https://");
    expect(text).not.toContain("0.81");
    expect(text).not.toContain(alice.driverId);
    expect(result.systemPrompt).not.toContain("https://team.example");
  });

  it("4) participante sem conhecimento não ganha a seção", async () => {
    const { result } = await bundleFor(plain.characterId);
    expect(sectionIds(result.systemPrompt)).not.toContain("PILOT_CONTEXT");
    expect(countEmittedSections(result.systemPrompt)).toBe(12);
    expect(result.meta.tokens.contextBlocks).toBe(12);
  });

  it("5) generationKey muda quando perfil/persona/memória mudam", async () => {
    const first = (await bundleFor(alice.characterId)).result;
    const second = (await bundleFor(alice.characterId)).result;
    expect(second.generationKey).toBe(first.generationKey);

    await upsertDriverProfileFromProvider(alice.driverId, {
      publicName: "GP-Alice",
      representedCountry: "Países Baixos",
      currentTeamName: "Equipe Nova MARKER",
      biographyFacts: { publicName: "GP-Alice", nationality: "Países Baixos" },
    });
    const third = (await bundleFor(alice.characterId)).result;
    expect(third.generationKey).not.toBe(first.generationKey);

    const memory = await prisma.memory.create({
      data: {
        content: "NOVA MEMORY-MARKER",
        importance: "CRITICAL",
        source: "USER_DEFINED",
        participants: { create: [{ characterId: alice.characterId }] },
      },
    });
    const fourth = (await bundleFor(alice.characterId)).result;
    expect(fourth.generationKey).not.toBe(third.generationKey);
    await prisma.memory.delete({ where: { id: memory.id } });
  });

  it("6) override do Universe vence no prompt e explicitamente marcado como Universo", async () => {
    await prisma.characterPersona.create({
      data: {
        characterId: alice.characterId,
        origin: "AI_CHARACTER",
        traits: {
          create: {
            key: "communicationStyle",
            value: "OVERRIDE-UNIVERSE-MARKER",
            confidence: 1,
            sourceKind: "MANUAL",
          },
        },
      },
    });
    const { result } = await bundleFor(alice.characterId);
    const text = sectionText(result.systemPrompt, "PILOT_CONTEXT");
    expect(text).toContain("OVERRIDE-UNIVERSE-MARKER");
    expect(text).not.toContain("TRAIT-Alice-MARKER");
    expect(text).toContain("Universo");
  });

  it("7) CURRENT_TURN e comportamento base permanecem preservados", async () => {
    const { result } = await bundleFor(alice.characterId, { withTurnContext: true });
    const ids = sectionIds(result.systemPrompt);
    expect(ids).toContain("CURRENT_TURN");
    expect(ids.indexOf("CURRENT_TURN")).toBeLessThan(ids.indexOf("CHARACTER_DNA"));
    expect(ids[ids.length - 1]).toBe("BEHAVIORAL_INVARIANTS");
    expect(sectionText(result.systemPrompt, "BEHAVIORAL_INVARIANTS")).toContain("Contrato de saída");
  });

  it("8) computeGenerationKey continua determinístico e sensível ao texto do speaker", async () => {
    const { result } = await bundleFor(alice.characterId);
    const same = computeGenerationKey(result.context, result.systemPrompt, result.meta, alice.characterId);
    expect(same).toBe(result.generationKey);
    const other = computeGenerationKey(result.context, result.systemPrompt, result.meta, bob.characterId);
    expect(other).not.toBe(result.generationKey);
  });
});
