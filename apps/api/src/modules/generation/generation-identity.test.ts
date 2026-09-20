import { describe, expect, it } from "vitest";
import type {
  AssembledContext,
  ContextParticipant,
  ContextRelationshipView,
} from "../context/context.assembly.js";
import {
  assertGenerationContract,
  composeSystemPrompt,
  computeGenerationKey,
  countEmittedSections,
  GENERATION_RULE,
} from "./generation.assembly.js";

// ---------------------------------------------------------------------------
// Testes do STEP 109C — Character DNA + Relationship Context BY SPEAKER.
//
// TUDO puro/unitário: sem DB, sem provider, sem rede. Foco na composição do
// systemPrompt:
//   - CHARACTER_DNA só é emitida quando o speaker TEM identidade (opt-in);
//   - RELATIONSHIPS é renderizada sob a perspectiva do speaker (com dimensões);
//   - sem speaker → baseline completo byte-a-byte (compat 109B).
// ---------------------------------------------------------------------------

const ALICE_ID = "align-0000-0000-0000-0000000000a1";
const KIMI_ID = "00000000-0000-4000-8000-0000000000b2";
const MAX_ID = "00000000-0000-4000-8000-0000000000c3";
const OUTSIDER_ID = "00000000-0000-4000-8000-0000000000d4";

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

const ALICE: ContextParticipant = participant({
  characterId: ALICE_ID,
  name: "Alicya",
  controlledBy: "AI",
  isAIParticipant: true,
  dna: {
    personality: "ousada",
    behavior: "metódica",
    speechStyle: "frases curtas e diretas",
    tendencies: ["competitiva", "cálida com os próximos"],
    values: ["integridade", "lealdade"],
    traits: "audaz",
  },
  biography:
    "Pilota veterana da equipe Vermelho, bicampeã de inverno, conhecida por voltas limpas no seco.",
});

const KIMI: ContextParticipant = participant({
  characterId: KIMI_ID,
  name: "Kimi",
  controlledBy: "AI",
  isAIParticipant: true,
  dna: {
    personality: "silencioso",
    behavior: "irônico",
    speechStyle: "monossilábico",
    values: "autonomia",
  },
  biography: null,
});

const MAX: ContextParticipant = participant({
  characterId: MAX_ID,
  name: "Max",
  nationality: "DE",
  controlledBy: "USER",
  isAIParticipant: false,
  dna: {},
  biography: null,
});

function relationship(over: Partial<ContextRelationshipView>): ContextRelationshipView {
  return {
    id: "r",
    characterAId: ALICE_ID,
    characterBId: MAX_ID,
    characterAName: "Alicya",
    characterBName: "Max",
    dimensions: {},
    ...over,
  };
}

const relAlicyaMax: ContextRelationshipView = relationship({
  id: "r-am",
  characterAId: ALICE_ID,
  characterBId: MAX_ID,
  characterAName: "Alicya",
  characterBName: "Max",
  dimensions: { tension: "low", trust: "high" },
});

const relAlicyaKimi: ContextRelationshipView = relationship({
  id: "r-ak",
  characterAId: ALICE_ID,
  characterBId: KIMI_ID,
  characterAName: "Alicya",
  characterBName: "Kimi",
  dimensions: { proximity: "high", teasing: "moderate" },
});

const relKimiMax: ContextRelationshipView = relationship({
  id: "r-km",
  characterAId: KIMI_ID,
  characterBId: MAX_ID,
  characterAName: "Kimi",
  characterBName: "Max",
  dimensions: { trust: "low" },
});

const relAlicyaOutsider: ContextRelationshipView = relationship({
  id: "r-ao",
  characterAId: ALICE_ID,
  characterBId: OUTSIDER_ID,
  characterAName: "Alicya",
  characterBName: "Rival",
  dimensions: { rivalry: "high" },
});

function mkContext(
  over: Partial<AssembledContext> = {},
  relationships: ContextRelationshipView[] = [],
): AssembledContext {
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
    relationships,
    motorsport: null,
    news: [],
    omitted: { oldestMessagesTruncated: 0, memoriesOmitted: 0, reasons: [] },
    ...over,
  } as AssembledContext;
}

describe("STEP 109C — CHARACTER_DNA (speaker-specific, opt-in)", () => {
  it("1) speaker com DNA completo → seção presente com labels e valores", () => {
    const prompt = composeSystemPrompt(mkContext(), ALICE_ID);
    expect(prompt).toContain("<BEGIN 5:CHARACTER_DNA>");
    expect(prompt).toContain("<END 5:CHARACTER_DNA>");
    expect(prompt).toContain("- Personality: ousada");
    expect(prompt).toContain("- Behavior: metódica");
    expect(prompt).toContain("- Speech style: frases curtas e diretas");
    expect(prompt).toContain("- Tendencies: competitiva, cálida com os próximos");
    expect(prompt).toContain("- Values: integridade, lealdade");
    expect(prompt).toContain("- Traits: audaz");
    expect(prompt.match(/Personality/g)).toHaveLength(1);
  });

  it("2) speaker sem DNA (dna {}) e sem biography → seção AUSENTE; âncora de identidade via RELATIONSHIPS", () => {
    const ctx = mkContext({
      participants: [
        ALICE,
        { ...KIMI, dna: {}, biography: null },
        MAX,
      ],
    });
    const prompt = composeSystemPrompt(ctx, KIMI_ID);
    expect(prompt).not.toContain("CHARACTER_DNA");
    expect(prompt).not.toContain("<BEGIN 5:CHARACTER_DNA>");
    expect(prompt).toContain("O AI speaker deste frame é Kimi — responda como Kimi e somente como Kimi.");
    expect(prompt).toContain("NÃO narre decisões ou falas de outros personagens.");
    expect(prompt).not.toContain("ousada");
    expect(countEmittedSections(prompt)).toBe(12);
    expect(prompt).toContain("<END 12:BEHAVIORAL_INVARIANTS>");
  });

  it("3) DNA de Alicya NÃO aparece no prompt do Kimi (isolamento por speaker)", () => {
    const alicePrompt = composeSystemPrompt(mkContext(), ALICE_ID);
    const kimiPrompt = composeSystemPrompt(mkContext(), KIMI_ID);
    expect(alicePrompt).toContain("Personality: ousada");
    expect(kimiPrompt).not.toContain("ousada");
    expect(kimiPrompt).toContain("Personality: silencioso");
    expect(alicePrompt).not.toContain("silencioso");
  });

  it("4) DNAs diferentes → prompts diferentes", () => {
    const alicePrompt = composeSystemPrompt(mkContext(), ALICE_ID);
    const kimiPrompt = composeSystemPrompt(mkContext(), KIMI_ID);
    expect(kimiPrompt).not.toBe(alicePrompt);
  });

  it("5) biography aparece no Charlie DNA sem duplicar campos de DNA", () => {
    const section = composeSystemPrompt(mkContext(), ALICE_ID);
    expect(section).toContain("Biografia (resumo): Pilota veterana");
    // o resumo não repete valor de nenhum campo de DNA
    expect(section).not.toContain("Biografia (resumo):" + "ousada");
  });

  it("6) shape parcial do DNA → somente o campo presente é emitido", () => {
    const ctx = mkContext();
    const partial = ctx.participants.map((p) =>
      p.characterId === ALICE_ID
        ? { ...p, dna: { personality: "sereno" }, biography: null }
        : p,
    );
    const prompt = composeSystemPrompt({ ...ctx, participants: partial }, ALICE_ID);
    expect(prompt).toContain("<BEGIN 5:CHARACTER_DNA>");
    expect(prompt).toContain("- Personality: sereno");
    expect(prompt).not.toContain("Behavior");
    expect(prompt).not.toContain("Biografia");
  });

  it("7) campos desconhecidos no DNA não explodem o prompt builder", () => {
    const ctx = mkContext();
    const weird = ctx.participants.map((p) =>
      p.characterId === ALICE_ID
        ? { ...p, dna: { hack: { z: [1, 2] }, personality: "sereno", outro: "x" } }
        : p,
    );
    const prompt = composeSystemPrompt({ ...ctx, participants: weird }, ALICE_ID);
    expect(prompt).toContain("Personality: sereno");
    expect(countEmittedSections(prompt)).toBe(13);
  });

  it("8) determinístico: mesma entrada → prompt idêntico byte-a-byte", () => {
    const ctx = mkContext();
    expect(composeSystemPrompt(ctx, ALICE_ID)).toBe(
      composeSystemPrompt(ctx, ALICE_ID),
    );
  });

  it("9) sem speaker → nenhuma seção CHARACTER_DNA; baseline intacto", () => {
    const prompt = composeSystemPrompt(mkContext());
    expect(prompt).not.toContain("CHARACTER_DNA");
    expect(countEmittedSections(prompt)).toBe(12);
    expect(prompt).toContain("<END 12:BEHAVIORAL_INVARIANTS>");
  });
});

describe("STEP 109C — RELATIONSHIPS por speaker (com dimensões)", () => {
  const rels = [relAlicyaMax, relAlicyaKimi, relKimiMax, relAlicyaOutsider];

  it("10) relação relevante do speaker aparece com dimensões legíveis", () => {
    const prompt = composeSystemPrompt(mkContext({}, rels), ALICE_ID);
    expect(prompt).toContain("Relações relevantes para Alicya (perspectiva do speaker):");
    expect(prompt).toContain("- Max (USER): tension: low, trust: high");
    expect(prompt).toContain("- Kimi (AI): proximity: high, teasing: moderate");
  });

  it("11) relação do speaker fica FORA do prompt de outro speaker (Kimi↔Max ∉ Alicya)", () => {
    const prompt = composeSystemPrompt(mkContext({}, rels), ALICE_ID);
    expect(prompt).not.toContain("Kimi (AI): trust: low");
    expect(prompt).not.toContain("- Kimi ↔ Max");
  });

  it("12) speaker A recebe A↔B e speaker B recebe B↔A com o OUTRO endpoint correto", () => {
    const alicePrompt = composeSystemPrompt(mkContext({}, rels), ALICE_ID);
    const kimiPrompt = composeSystemPrompt(mkContext({}, rels), KIMI_ID);
    // Alicya → vê Max e Kimi como opposites
    expect(alicePrompt).toContain("Max (USER): tension: low");
    expect(alicePrompt).toContain("Kimi (AI): proximity: high");
    // Kimi → vê Alice (AI) e Max (USER); a relação presente é a da Alice também
    expect(kimiPrompt).toContain("Alicya (AI): proximity: high, teasing: moderate");
    expect(kimiPrompt).toContain("Max (USER): trust: low");
  });

  it("13) USER primeiro na ordem de renderização (determinístico)", () => {
    const prompt = composeSystemPrompt(mkContext({}, rels), ALICE_ID);
    expect(prompt.indexOf("Max (USER)")).toBeGreaterThan(-1);
    expect(prompt.indexOf("Kimi (AI)")).toBeGreaterThan(-1);
    expect(prompt.indexOf("Max (USER)")).toBeLessThan(prompt.indexOf("Kimi (AI)"));
  });

  it("14) ausência de relationship do speaker → seção segue emitida, sem quebrar", () => {
    const prompt = composeSystemPrompt(
      mkContext({}, [relAlicyaOutsider]),
      KIMI_ID,
    );
    expect(prompt).toContain("Nenhuma relação relevante para Kimi no escopo deste quadro.");
    expect(countEmittedSections(prompt)).toBe(13);
  });

  it("15) dimensions são renderizadas de forma ordenada (keys alfabéticas)", () => {
    const prompt = composeSystemPrompt(mkContext({}, rels), ALICE_ID);
    expect(prompt).toContain("tension: low, trust: high");
    expect(prompt.indexOf("tension: low")).toBeLessThan(prompt.indexOf("trust: high"));
  });

  it("16) nomes continuam legíveis (sem ids crus)", () => {
    const prompt = composeSystemPrompt(mkContext({}, rels), ALICE_ID);
    expect(prompt).toContain("Alicya");
    expect(prompt).toContain("Max");
    expect(prompt).toContain("Kimi");
  });

  it("17) nenhum JSON bruto/interno cai no prompt", () => {
    const prompt = composeSystemPrompt(mkContext({}, rels), ALICE_ID);
    for (const raw of [
      '"dimensions"',
      '"characterAId"',
      '"characterBId"',
      '"characterAName"',
      '"isAIParticipant"',
      '"dna"',
    ]) {
      expect(prompt).not.toContain(raw);
    }
  });

  it("18) relationships de characters não relacionados não contaminam o contexto", () => {
    const prompt = composeSystemPrompt(mkContext({}, rels), KIMI_ID);
    // Alicya+Rival (fora do escopo de Kimi) não entra no prompt do Kimi
    expect(prompt).not.toContain("Rival");
    expect(prompt).not.toContain("rivalry");
  });
});

describe("STEP 109C — multi-speaker / regressão 109B", () => {
  const rels = [relAlicyaMax, relAlicyaKimi, relKimiMax];

  it("19) speaker A recebe DNA A; speaker B recebe DNA B; ambos distintos", () => {
    const a = composeSystemPrompt(mkContext({}, rels), ALICE_ID);
    const b = composeSystemPrompt(mkContext({}, rels), KIMI_ID);
    expect(a).toContain("Personality: ousada");
    expect(b).toContain("Personality: silencioso");
    expect(a).not.toEqual(b);
  });

  it("20) identidade do speaker gera generationKey distintos por speaker", () => {
    const ctx = mkContext({}, rels);
    const pa = composeSystemPrompt(ctx, ALICE_ID);
    const pb = composeSystemPrompt(ctx, KIMI_ID);
    const metaA = {
      provider: "null",
      mode: "assembly-only" as const,
      tokens: { systemPromptChars: pa.length, contextBlocks: countEmittedSections(pa) },
      ruleApplied: GENERATION_RULE,
    };
    const metaB = {
      provider: "null",
      mode: "assembly-only" as const,
      tokens: { systemPromptChars: pb.length, contextBlocks: countEmittedSections(pb) },
      ruleApplied: GENERATION_RULE,
    };
    expect(computeGenerationKey(ctx, pa, metaA, ALICE_ID)).not.toBe(
      computeGenerationKey(ctx, pb, metaB, KIMI_ID),
    );
  });

  it("21) assertGenerationContract aceita CHARACTER_DNA presente (13 seções)", () => {
    const ctx = mkContext({}, rels);
    const sp = composeSystemPrompt(ctx, ALICE_ID);
    const result = {
      context: ctx,
      systemPrompt: sp,
      meta: {
        provider: "null",
        mode: "assembly-only" as const,
        tokens: { systemPromptChars: sp.length, contextBlocks: countEmittedSections(sp) },
        ruleApplied: GENERATION_RULE,
      },
      generationKey: computeGenerationKey(ctx, sp, {
        provider: "null",
        mode: "assembly-only" as const,
        tokens: { systemPromptChars: sp.length, contextBlocks: countEmittedSections(sp) },
        ruleApplied: GENERATION_RULE,
      }),
    };
    expect(countEmittedSections(sp)).toBe(13);
    expect(assertGenerationContract(result)).toBe(true);
  });

  it("22) baseline (sem speaker) continua passando no assertGenerationContract", () => {
    const ctx = mkContext({}, rels);
    const sp = composeSystemPrompt(ctx);
    const meta = {
      provider: "null",
      mode: "assembly-only" as const,
      tokens: { systemPromptChars: sp.length, contextBlocks: countEmittedSections(sp) },
      ruleApplied: GENERATION_RULE,
    };
    const result = {
      context: ctx,
      systemPrompt: sp,
      meta,
      generationKey: computeGenerationKey(ctx, sp, meta),
    };
    expect(countEmittedSections(sp)).toBe(12);
    expect(assertGenerationContract(result)).toBe(true);
  });
});