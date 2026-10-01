import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import type { AssembledContext, ContextParticipant } from "../context/context.assembly.js";
import type { ExternalRagContext } from "../external-research/external-rag-adapter.js";
import { createTurnContext } from "../conversation/turn-context.js";
import {
  SECTION_IDS,
  assembleGenerationBundle,
  composeSystemPrompt,
  countEmittedSections,
  type GenerationProvider,
  type ProviderInput,
  type GenerationResult,
} from "./generation.assembly.js";
import {
  composePersonaPromptBlock,
  type SpeakerPersonaPromptInput,
} from "../persona/persona.prompt.js";

const ALICE_ID = "00000000-0000-4000-8000-0000000000a1";
const KIMI_ID = "00000000-0000-4000-8000-0000000000b2";
const MAX_ID = "00000000-0000-4000-8000-0000000000c3";

function participant(over: Partial<ContextParticipant>): ContextParticipant {
  return {
    characterId: "",
    name: "",
    nationality: "BR",
    controlledBy: "AI",
    isAIParticipant: true,
    ...over,
  };
}

const ALICE = participant({
  characterId: ALICE_ID,
  name: "Alicya",
  dna: { personality: "ousada", speechStyle: "frases curtas" },
  biography: "Pilota veterana da equipe Vermelho.",
});

const KIMI = participant({
  characterId: KIMI_ID,
  name: "Kimi",
  dna: {},
  biography: null,
});

const MAX = participant({
  characterId: MAX_ID,
  name: "Max",
  controlledBy: "USER",
  isAIParticipant: false,
  dna: {},
  biography: null,
});

function mkContext(over: Partial<AssembledContext> = {}): AssembledContext {
  return {
    meta: {
      version: "context.v1",
      conversationId: "00000000-0000-4000-8000-000000000010",
      conversationType: "GROUP",
      participantCharacterIds: [ALICE_ID, KIMI_ID, MAX_ID].sort(),
      assembledAt: "2026-01-01T00:00:00.000Z",
      ruleApplied: "context.v1-policy:msgs=50#mem=15#evt=10#rel=10#news=8",
    },
    participants: [ALICE, KIMI, MAX],
    activeSpeaker: { characterId: MAX_ID, senderType: "USER_CHARACTER" },
    temporal: {
      worldDate: null,
      currentSeasonId: null,
      currentRaceId: null,
      currentSession: null,
      phaseMarker: null,
    },
    recentMessages: [],
    memories: [],
    events: [],
    relationships: [],
    motorsport: null,
    news: [],
    omitted: { oldestMessagesTruncated: 0, memoriesOmitted: 0, reasons: [] },
    ...over,
  };
}

function sectionText(prompt: string, id: string): string {
  const match = prompt.match(
    new RegExp(`<BEGIN \\d+:${id}>\\n([\\s\\S]*?)\\n<END \\d+:${id}>`),
  );
  return match?.[1] ?? "";
}

function sectionIds(prompt: string): string[] {
  return [...prompt.matchAll(/<BEGIN \d+:([A-Z_]+)>/g)].map((match) => match[1]!);
}

const PERSONA_A: SpeakerPersonaPromptInput = {
  summary: "Resumo da persona A.",
  traits: [
    { key: "humor", value: "Seco", confidence: 1 },
    { key: "communicationStyle", value: "Direto", confidence: 1 },
  ],
};

describe("generation persona — prompt block (puro)", () => {
  it("1) summary renderiza", () => {
    const block = composePersonaPromptBlock({ summary: "Calmo sob pressão", traits: [] });
    expect(block.text).toContain("Resumo: Calmo sob pressão");
    expect(block.text).toContain("tendências interpretativas");
    expect(block.omittedReasons).toEqual([]);
  });

  it("2) traits renderizam com labels do registry", () => {
    const block = composePersonaPromptBlock({
      summary: null,
      traits: [
        { key: "humor", value: "Sarcástico", confidence: 1 },
        { key: "communicationStyle", value: "Direto", confidence: 1 },
      ],
    });
    expect(block.text).toContain("- Humor: Sarcástico");
    expect(block.text).toContain("- Estilo de comunicação: Direto");
  });

  it("3) summary + traits juntos", () => {
    const block = composePersonaPromptBlock(PERSONA_A);
    expect(block.text).toContain("Resumo: Resumo da persona A.");
    expect(block.text).toContain("- Humor: Seco");
    expect(block.text).toContain("- Estilo de comunicação: Direto");
  });

  it("4) persona vazia não gera bloco", () => {
    expect(composePersonaPromptBlock({ summary: null, traits: [] }).text).toBe("");
    expect(
      composePersonaPromptBlock({ summary: "   ", traits: [{ key: "humor", value: "   ", confidence: 1 }] }).text,
    ).toBe("");
  });

  it("5) ordenação usa sortPersonaTraits (prioridade do registry)", () => {
    const block = composePersonaPromptBlock({
      summary: null,
      traits: [
        { key: "interests", value: "Música", confidence: 1 },
        { key: "humor", value: "Seco", confidence: 1 },
        { key: "communicationStyle", value: "Direto", confidence: 1 },
      ],
    });
    const lines = block.text.split("\n").filter((line) => line.startsWith("- "));
    expect(lines).toEqual([
      "- Estilo de comunicação: Direto",
      "- Humor: Seco",
      "- Interesses: Música",
    ]);
  });

  it("6) confidence numérica não aparece no bloco", () => {
    const block = composePersonaPromptBlock({
      summary: null,
      traits: [{ key: "humor", value: "Seco", confidence: 0.424242 }],
    });
    expect(block.text).not.toContain("0.424242");
    expect(block.text).not.toContain("confidence");
    expect(block.text).not.toContain("confiança");
  });

  it("7) cap do summary + reason persona-summary-truncated", () => {
    const block = composePersonaPromptBlock({ summary: "x".repeat(1000), traits: [] });
    expect(block.text).toContain("x".repeat(600));
    expect(block.text).not.toContain("x".repeat(601));
    expect(block.omittedReasons).toContain("persona-summary-truncated");
  });

  it("8) cap do valor + reason persona-traits-truncated", () => {
    const block = composePersonaPromptBlock({
      summary: null,
      traits: [{ key: "humor", value: "y".repeat(300), confidence: 1 }],
    });
    expect(block.text).toContain("y".repeat(200));
    expect(block.text).not.toContain("y".repeat(201));
    expect(block.omittedReasons).toContain("persona-traits-truncated");
  });

  it("9) máximo de 12 traits + reason", () => {
    const traits = Array.from({ length: 13 }, (_, index) => ({
      key: `k${String(index + 1).padStart(2, "0")}`,
      value: `valor ${index + 1}`,
      confidence: 1,
    }));
    const block = composePersonaPromptBlock({ summary: null, traits });
    const lines = block.text.split("\n").filter((line) => line.startsWith("- "));
    expect(lines).toHaveLength(12);
    expect(block.omittedReasons).toContain("persona-traits-truncated");
  });

  it("10) bloco total ≤ 2000 chars + reason persona-block-truncated", () => {
    const traits = Array.from({ length: 12 }, (_, index) => ({
      key: `b${String(index + 1).padStart(2, "0")}`,
      value: "z".repeat(200),
      confidence: 1,
    }));
    const block = composePersonaPromptBlock({
      summary: "s".repeat(600),
      traits,
    });
    expect(block.text.length).toBeLessThanOrEqual(2000);
    expect(block.omittedReasons).toContain("persona-block-truncated");
  });
});

describe("generation persona — slot CHARACTER_DNA (puro)", () => {
  it("11) persona entra no slot existente CHARACTER_DNA (sem nova seção)", () => {
    const baseline = composeSystemPrompt(mkContext(), ALICE_ID);
    const withPersona = composeSystemPrompt(mkContext(), ALICE_ID, undefined, "Resumo: X");
    expect(sectionText(withPersona, "CHARACTER_DNA")).toContain("Resumo: X");
    expect(countEmittedSections(withPersona)).toBe(countEmittedSections(baseline));
    expect(SECTION_IDS).toContain("CHARACTER_DNA");
    for (const id of sectionIds(withPersona)) {
      expect(SECTION_IDS).toContain(id);
    }
    expect(new Set(sectionIds(withPersona)).size).toBe(sectionIds(withPersona).length);
  });

  it("12) persona > dna (dna legado não aparece quando persona existe)", () => {
    const ctx = mkContext();
    const prompt = composeSystemPrompt(ctx, ALICE_ID, undefined, "Resumo: Persona vence");
    expect(prompt).toContain("Resumo: Persona vence");
    expect(prompt).not.toContain("Personality: ousada");
    expect(prompt).not.toContain("Pilota veterana");
  });

  it("13) dna > biography no fallback legado (ambos preservados)", () => {
    const prompt = composeSystemPrompt(mkContext(), ALICE_ID);
    expect(prompt).toContain("Personality: ousada");
    expect(prompt).toContain("Biografia (resumo): Pilota veterana");
    expect(prompt.indexOf("Personality: ousada")).toBeLessThan(
      prompt.indexOf("Biografia (resumo):"),
    );
  });

  it("14) biography fallback quando dna vazio", () => {
    const ctx = mkContext({
      participants: [
        participant({ characterId: KIMI_ID, name: "Kimi", dna: {}, biography: "Só biografia." }),
      ],
    });
    const prompt = composeSystemPrompt(ctx, KIMI_ID);
    expect(sectionText(prompt, "CHARACTER_DNA")).toContain("Biografia (resumo): Só biografia.");
  });

  it("15) sem identidade nenhuma → seção omitida", () => {
    const prompt = composeSystemPrompt(mkContext(), MAX_ID);
    expect(prompt).not.toContain("CHARACTER_DNA>");
  });

  it("16) sem persona o prompt é o comportamento anterior (determinístico)", () => {
    const a = composeSystemPrompt(mkContext(), ALICE_ID);
    const b = composeSystemPrompt(mkContext(), ALICE_ID, undefined, undefined);
    expect(a).toBe(b);
  });

  it("17) CURRENT_TURN continua presente junto da persona", () => {
    const turn = createTurnContext({
      userMessage: "Pergunta",
      userCharacterId: MAX_ID,
      userCharacterName: "Max",
      previousReplies: [
        {
          speakerCharacterId: KIMI_ID,
          speakerName: "Kimi",
          senderType: "AI_CHARACTER",
          content: "Fala anterior",
        },
      ],
    });
    const prompt = composeSystemPrompt(mkContext(), ALICE_ID, turn, "Resumo: Persona");
    expect(prompt).toContain("CURRENT_TURN>");
    expect(prompt).toContain("Resumo: Persona");
  });

  it("18) EXTERNAL_CONTEXT (RAG) continua presente junto da persona", () => {
    const rag: ExternalRagContext = {
      sourceType: "external",
      provider: "cohere",
      model: "embed-multilingual-v3.0",
      version: "v3.0",
      dimensions: 1024,
      ruleApplied: "external-retrieval.v1",
      items: [
        {
          sourceId: "src-1",
          documentId: "doc-1",
          chunkId: "c1",
          title: "Documento",
          content: "Conteúdo externo",
          orderOriginal: 0,
          score: 0.9,
          distance: 0.1,
          citation: "Fonte",
        } as ExternalRagContext["items"][number],
      ],
    };
    const prompt = composeSystemPrompt(mkContext({ externalRag: rag }), ALICE_ID, undefined, "Resumo: Persona");
    expect(prompt).toContain("EXTERNAL_CONTEXT>");
    expect(prompt).toContain("Resumo: Persona");
  });

});

type TestUser = { id: string };

let owner: TestUser;
let conversationId: string;
let aiAId: string;
let aiBId: string;
let aiCId: string;
let aiDId: string;
let aiEId: string;
let aiFId: string;

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdConversationIds: string[] = [];
const createdMemoryIds: string[] = [];
const createdRelationshipIds: string[] = [];

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

async function bundleFor(characterId: string): Promise<GenerationResult> {
  return assembleGenerationBundle(prisma, {
    conversationId,
    userId: owner.id,
    targetCharacterId: characterId,
  });
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      name: "GP Persona",
      email: `gp-persona-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@f1nw.test`,
      password: null,
      emailVerified: true,
    },
  });
  createdUserIds.push(user.id);
  owner = { id: user.id };

  async function createAi(label: string, data: { dna?: object; biography?: string | null } = {}) {
    const character = await prisma.character.create({
      data: {
        name: `GP-${label}`,
        nationality: "BR",
        birthDate: new Date("1999-01-01"),
        controlledBy: "AI",
        dna: data.dna ?? {},
        biography: data.biography ?? null,
      },
    });
    createdCharacterIds.push(character.id);
    return character;
  }

  const aiA = await createAi("A", { dna: { personality: "DNA-A-MARCADOR" }, biography: "BIO-A-MARCADOR" });
  const aiB = await createAi("B");
  const aiC = await createAi("C", { dna: { personality: "DNA-C-LEGADO" }, biography: "BIO-C-LEGADO" });
  const aiD = await createAi("D", { biography: "BIO-D-SO" });
  const aiE = await createAi("E");
  const aiF = await createAi("F");
  aiAId = aiA.id;
  aiBId = aiB.id;
  aiCId = aiC.id;
  aiDId = aiD.id;
  aiEId = aiE.id;
  aiFId = aiF.id;

  const conversation = await prisma.conversation.create({ data: { type: "GROUP" } });
  createdConversationIds.push(conversation.id);
  conversationId = conversation.id;
  await prisma.conversationParticipant.createMany({
    data: [aiA, aiB, aiC, aiD, aiE, aiF].map((character) => ({
      conversationId,
      characterId: character.id,
    })),
  });

  const personaA = await prisma.characterPersona.create({
    data: {
      characterId: aiA.id,
      origin: "AI_CHARACTER",
      schemaVersion: "persona.v1",
      summary: "PERSONA-A-SUMMARY",
      traits: {
        create: [
          { key: "humor", value: "PERSONA-A-TRAIT-HUMOR", confidence: 1, sourceKind: "MANUAL" },
          { key: "interests", value: "PERSONA-A-TRAIT-INTERESTS", confidence: 1, sourceKind: "MANUAL" },
        ],
      },
    },
  });
  await prisma.characterPersona.create({
    data: {
      characterId: aiB.id,
      origin: "AI_CHARACTER",
      schemaVersion: "persona.v1",
      summary: "PERSONA-B-SUMMARY",
      traits: {
        create: [
          { key: "humor", value: "PERSONA-B-TRAIT-HUMOR", confidence: 1, sourceKind: "MANUAL" },
        ],
      },
    },
  });

  await prisma.personaEvidence.create({
    data: {
      personaId: personaA.id,
      traitKey: "humor",
      proposedValue: "EVIDENCE-PROPOSED-MARCADOR",
      sourceType: "INTERVIEW",
      title: "Fonte",
      url: "https://example.com/EVIDENCE-URL-MARCADOR",
      publishedAt: new Date("2026-01-01"),
      excerpt: "EVIDENCE-EXCERPT-MARCADOR",
      confidence: 0.424242,
      status: "APPROVED",
    },
  });

  await prisma.characterPersona.create({
    data: {
      characterId: aiF.id,
      origin: "AI_CHARACTER",
      schemaVersion: "persona.v1",
      summary: "LONGA-".repeat(140),
      traits: {
        create: Array.from({ length: 13 }, (_, index) => ({
          key: `k${String(index + 1).padStart(2, "0")}`,
          value: "v".repeat(150),
          confidence: 1,
          sourceKind: "MANUAL" as const,
        })),
      },
    },
  });

  const memory = await prisma.memory.create({
    data: { content: "MEMORIA-PERSONA-MARCADOR", importance: "HIGH" },
  });
  createdMemoryIds.push(memory.id);
  await prisma.memoryCharacter.create({
    data: { memoryId: memory.id, characterId: aiA.id },
  });

  const rel = await prisma.relationship.create({
    data: {
      characterAId: aiA.id,
      characterBId: aiB.id,
      dimensions: { trust: 50 },
    },
  });
  createdRelationshipIds.push(rel.id);
});

afterAll(async () => {
  await prisma.memory.deleteMany({ where: { id: { in: createdMemoryIds } } });
  await prisma.relationship.deleteMany({ where: { id: { in: createdRelationshipIds } } });
  await prisma.conversationParticipant.deleteMany({
    where: { conversationId: { in: createdConversationIds } },
  });
  await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("generation persona — bundle (DB)", () => {
  it("20) persona do speaker entra no CHARACTER_DNA", async () => {
    const result = await bundleFor(aiAId);
    const section = sectionText(result.systemPrompt, "CHARACTER_DNA");
    expect(section).toContain("PERSONA-A-SUMMARY");
    expect(section).toContain("- Humor: PERSONA-A-TRAIT-HUMOR");
    expect(section).toContain("tendências interpretativas");
    expect(result.speakerCharacterId).toBe(aiAId);
  });

  it("21) persona vence dna e biography do speaker", async () => {
    const result = await bundleFor(aiAId);
    expect(result.systemPrompt).not.toContain("DNA-A-MARCADOR");
    expect(result.systemPrompt).not.toContain("BIO-A-MARCADOR");
  });

  it("22) persona de terceiro não entra no prompt do speaker", async () => {
    const result = await bundleFor(aiAId);
    expect(result.systemPrompt).not.toContain("PERSONA-B-SUMMARY");
    expect(result.systemPrompt).not.toContain("PERSONA-B-TRAIT-HUMOR");
  });

  it("23) multi-speaker B usa a persona B", async () => {
    const result = await bundleFor(aiBId);
    expect(result.systemPrompt).toContain("PERSONA-B-SUMMARY");
    expect(result.systemPrompt).toContain("- Humor: PERSONA-B-TRAIT-HUMOR");
    expect(result.systemPrompt).not.toContain("PERSONA-A-SUMMARY");
  });

  it("24) evidence nunca entra no prompt (URL/excerpt/status/confidence/id)", async () => {
    const result = await bundleFor(aiAId);
    expect(result.systemPrompt).not.toContain("EVIDENCE-URL-MARCADOR");
    expect(result.systemPrompt).not.toContain("EVIDENCE-EXCERPT-MARCADOR");
    expect(result.systemPrompt).not.toContain("EVIDENCE-PROPOSED-MARCADOR");
    expect(result.systemPrompt).not.toContain("0.424242");
    expect(result.systemPrompt).not.toContain("APPROVED");
    const evidence = await prisma.personaEvidence.findFirstOrThrow({
      where: { persona: { characterId: aiAId } },
    });
    expect(result.systemPrompt).not.toContain(evidence.id);
  });

  it("25) sem persona o dna legado continua funcionando", async () => {
    const result = await bundleFor(aiCId);
    const section = sectionText(result.systemPrompt, "CHARACTER_DNA");
    expect(section).toContain("DNA-C-LEGADO");
    expect(section).toContain("BIO-C-LEGADO");
    expect(section).not.toContain("tendências interpretativas");
  });

  it("26) biography-only continua funcionando", async () => {
    const result = await bundleFor(aiDId);
    expect(sectionText(result.systemPrompt, "CHARACTER_DNA")).toContain("BIO-D-SO");
  });

  it("27) sem Persona e sem fallback a seção CHARACTER_DNA é omitida", async () => {
    const withIdentity = await bundleFor(aiDId);
    const withoutIdentity = await bundleFor(aiEId);
    expect(sectionText(withoutIdentity.systemPrompt, "CHARACTER_DNA")).toBe("");
    expect(countEmittedSections(withoutIdentity.systemPrompt)).toBe(
      countEmittedSections(withIdentity.systemPrompt) - 1,
    );
  });

  it("28) Memory e Relationship continuam presentes junto da persona", async () => {
    const result = await bundleFor(aiAId);
    expect(result.systemPrompt).toContain("MEMORIA-PERSONA-MARCADOR");
    expect(result.systemPrompt).toContain("GP-B");
    expect(result.systemPrompt).toContain("PERSONA-A-SUMMARY");
  });

  it("29) NullProvider continua funcional com persona", async () => {
    const result = await bundleFor(aiAId);
    expect(result.meta.mode).toBe("assembly-only");
    expect(result.text).toBeUndefined();
    expect(result.systemPrompt).toContain("PERSONA-A-SUMMARY");
  });

  it("30) generationKey estável para mesma conversa/mensagem/speaker/persona", async () => {
    const a = await bundleFor(aiAId);
    const b = await bundleFor(aiAId);
    expect(a.generationKey).toBe(b.generationKey);
  });

  it("31) key muda quando a persona do speaker muda; não muda com persona de terceiro", async () => {
    const base = await bundleFor(aiAId);

    await prisma.characterPersona.update({
      where: { characterId: aiAId },
      data: { summary: "PERSONA-A-SUMMARY-V2" },
    });
    const changed = await bundleFor(aiAId);
    expect(changed.generationKey).not.toBe(base.generationKey);

    await prisma.characterPersona.update({
      where: { characterId: aiBId },
      data: { summary: "PERSONA-B-SUMMARY-V2" },
    });
    const afterThirdPartyChange = await bundleFor(aiAId);
    expect(afterThirdPartyChange.generationKey).toBe(changed.generationKey);
  });

  it("32) objetivos truncados registram reasons e respeitam caps", async () => {
    const result = await bundleFor(aiFId);
    expect(result.context.omitted.reasons).toContain("persona-summary-truncated");
    expect(result.context.omitted.reasons).toContain("persona-traits-truncated");
    const section = sectionText(result.systemPrompt, "CHARACTER_DNA");
    expect(section.length).toBeLessThanOrEqual(2000);
    const lines = section.split("\n").filter((line) => line.startsWith("- "));
    expect(lines.length).toBeLessThanOrEqual(12);
  });

  it("33) projeção altera somente o providerUserPrompt", async () => {
    const capture: { input?: ProviderInput } = {};
    const result = await assembleGenerationBundle(
      prisma,
      {
        conversationId,
        userId: owner.id,
        targetCharacterId: aiAId,
        userPrompt: "Prompt original",
        providerUserPrompt: "Prompt projetado",
      },
      spyProvider(capture),
    );
    expect(capture.input?.userPrompt).toBe("Prompt projetado");
    expect(capture.input?.systemPrompt).toContain("PERSONA-A-SUMMARY-V2");
    expect(result.systemPrompt).toContain("PERSONA-A-SUMMARY-V2");
    expect(result.meta.mode).toBe("generated");
  });

  it("34) userPrompt original permanece quando não há projeção", async () => {
    const capture: { input?: ProviderInput } = {};
    await assembleGenerationBundle(
      prisma,
      {
        conversationId,
        userId: owner.id,
        targetCharacterId: aiAId,
        userPrompt: "Prompt original",
      },
      spyProvider(capture),
    );
    expect(capture.input?.userPrompt).toBe("Prompt original");
  });
});
