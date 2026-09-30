import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import { composePilotContextPromptBlock } from "../pilot-context/pilot-context.prompt.js";
import { resolvePilotContext } from "../pilot-context/pilot-context.resolver.js";
import { applyPersonaEvolution, previewPersonaEvolution } from "./persona-evolution.service.js";

const PREFIX = "pe-svc";
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];

afterAll(async () => {
  await prisma.personaTraitEvolution.deleteMany({
    where: { persona: { character: { name: { startsWith: PREFIX } } } },
  });
  await prisma.characterPersona.deleteMany({
    where: { character: { name: { startsWith: PREFIX } } },
  });
  await prisma.pilotExperience.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
  await prisma.memory.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
  await prisma.timelineEvent.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
  await prisma.character.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.worldState.deleteMany({ where: { universeId: { in: createdUniverseIds } } });
  await prisma.universe.deleteMany({ where: { id: { in: createdUniverseIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

async function createFixture(label: string, options?: { readonly evidenceTrait?: boolean; readonly manualTrait?: boolean }) {
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
  if (options?.evidenceTrait || options?.manualTrait) {
    await prisma.characterPersona.create({
      data: {
        characterId: character.id,
        origin: "AI_CHARACTER",
        traits: {
          create: {
            key: "confidence",
            value: options.manualTrait ? "Muito alta" : "Elevada",
            confidence: options.manualTrait ? 0.9 : 0.5,
            sourceKind: options.manualTrait ? "MANUAL" : "EVIDENCE",
          },
        },
      },
    });
  }
  await prisma.worldState.create({
    data: {
      universeId: universe.id,
      key: "default",
      currentDate: new Date("2026-12-31T00:00:00.000Z"),
    },
  });
  return { user, universe, character };
}

async function addChampionship(universeId: string, characterId: string, year: number, title: string) {
  return prisma.pilotExperience.create({
    data: {
      universeId,
      characterId,
      experienceType: "CHAMPIONSHIP",
      source: "STANDING",
      sourceKey: `season:${year}:champion`,
      seasonYear: year,
      occurredAt: new Date(`${year}-12-01T00:00:00.000Z`),
      salience: "CRITICAL",
      title,
    },
  });
}

describe("persona evolution service", () => {
  it("1) preview + apply aplica delta sobre baseline; reaplicar é no-op (sem double-count)", async () => {
    const fixture = await createFixture("basic", { evidenceTrait: true });
    await addChampionship(fixture.universe.id, fixture.character.id, 2025, "Campeão mundial em 2025");

    const preview = await previewPersonaEvolution(fixture.universe.id, fixture.character.id);
    expect(preview.available).toBe(true);
    expect(preview.pendingCount).toBe(1);
    const confidence = preview.traits.find((trait) => trait.key === "confidence");
    expect(confidence?.beforeConfidence).toBeCloseTo(0.5, 5);
    expect(confidence?.afterConfidence).toBeCloseTo(0.56, 5);
    expect(confidence?.reasons[0]?.ruleCode).toBe("FIRST_WORLD_CHAMPIONSHIP");

    const applied = await applyPersonaEvolution(fixture.universe.id, fixture.character.id, {
      expectedRevision: preview.evolutionRevision,
      expectedPendingFingerprint: preview.pendingFingerprint,
    });
    expect(applied).toMatchObject({ applied: true, evolutionRevision: 1, effectsApplied: 1 });
    if (!applied.applied) throw new Error("unreachable");
    expect(applied.timelineEventId).not.toBeNull();

    const event = await prisma.timelineEvent.findUniqueOrThrow({ where: { id: applied.timelineEventId as string } });
    expect(event.kind).toBe("PERSONA_UPDATED");
    expect(JSON.stringify(event.payload)).toContain("FIRST_WORLD_CHAMPIONSHIP");

    const persona = await prisma.characterPersona.findFirstOrThrow({
      where: { characterId: fixture.character.id },
    });
    expect(persona.evolutionRevision).toBe(1);

    const repreview = await previewPersonaEvolution(fixture.universe.id, fixture.character.id);
    expect(repreview.pendingCount).toBe(0);
    expect(repreview.traits).toHaveLength(0);

    const reapply = await applyPersonaEvolution(fixture.universe.id, fixture.character.id, {
      expectedRevision: repreview.evolutionRevision,
      expectedPendingFingerprint: repreview.pendingFingerprint,
    });
    expect(reapply).toMatchObject({ applied: false, evolutionRevision: 1, reason: "NO_PENDING_EFFECTS" });

    const effectRows = await prisma.personaTraitEvolution.count({
      where: { persona: { characterId: fixture.character.id } },
    });
    expect(effectRows).toBe(1);
  });

  it("2) apply com preguiça de estado retorna EVOLUTION_STALE", async () => {
    const fixture = await createFixture("stale", { evidenceTrait: true });
    await addChampionship(fixture.universe.id, fixture.character.id, 2025, "Título 2025");
    const preview = await previewPersonaEvolution(fixture.universe.id, fixture.character.id);

    await expect(
      applyPersonaEvolution(fixture.universe.id, fixture.character.id, {
        expectedRevision: preview.evolutionRevision + 5,
        expectedPendingFingerprint: preview.pendingFingerprint,
      }),
    ).rejects.toMatchObject({ code: "EVOLUTION_STALE", statusCode: 409 });

    await addChampionship(fixture.universe.id, fixture.character.id, 2026, "Título 2026");
    await expect(
      applyPersonaEvolution(fixture.universe.id, fixture.character.id, {
        expectedRevision: preview.evolutionRevision,
        expectedPendingFingerprint: preview.pendingFingerprint,
      }),
    ).rejects.toMatchObject({ code: "EVOLUTION_STALE", statusCode: 409 });
  });

  it("3) MANUAL vence: efeito registrado mas display permanece manual", async () => {
    const fixture = await createFixture("manual", { manualTrait: true });
    await addChampionship(fixture.universe.id, fixture.character.id, 2025, "Título 2025");
    const preview = await previewPersonaEvolution(fixture.universe.id, fixture.character.id);
    const confidence = preview.traits.find((trait) => trait.key === "confidence");
    expect(confidence?.skippedManual).toBe(true);
    expect(confidence?.beforeConfidence).toBe(0.9);
    expect(confidence?.afterConfidence).toBe(0.9);
    expect(preview.skipped.some((entry) => entry.traitKey === "confidence")).toBe(true);

    const applied = await applyPersonaEvolution(fixture.universe.id, fixture.character.id, {
      expectedRevision: preview.evolutionRevision,
      expectedPendingFingerprint: preview.pendingFingerprint,
    });
    expect(applied).toMatchObject({ applied: true, effectsApplied: 1 });
    const view = await resolvePilotContext({ speakerCharacterId: fixture.character.id });
    const trait = view?.effectivePersona.find((entry) => entry.key === "confidence");
    expect(trait?.origin).toBe("UNIVERSE");
    expect(trait?.effectiveConfidence).toBe(0.9);
  });

  it("4) dois títulos: FIRST + REPEAT com trait criado, uma revisão por apply", async () => {
    const fixture = await createFixture("repeat");
    await addChampionship(fixture.universe.id, fixture.character.id, 2025, "Título 2025");
    await addChampionship(fixture.universe.id, fixture.character.id, 2026, "Título 2026");
    const preview = await previewPersonaEvolution(fixture.universe.id, fixture.character.id);
    expect(preview.pendingCount).toBe(2);
    const confidence = preview.traits.find((trait) => trait.key === "confidence");
    expect(confidence?.afterConfidence).toBeCloseTo(0.56, 5);
    const priorities = preview.traits.find((trait) => trait.key === "professionalPriorities");
    expect(priorities?.value).toBe("Títulos como prioridade central");
    expect(priorities?.origin).toBe("RULE_DERIVED");

    const applied = await applyPersonaEvolution(fixture.universe.id, fixture.character.id, {
      expectedRevision: preview.evolutionRevision,
      expectedPendingFingerprint: preview.pendingFingerprint,
    });
    expect(applied).toMatchObject({ applied: true, evolutionRevision: 1, effectsApplied: 2 });
  });

  it("5) prompt do resolver passa a refletir a evolução (notas, sem confidence)", async () => {
    const fixture = await createFixture("prompt", { evidenceTrait: true });
    await addChampionship(fixture.universe.id, fixture.character.id, 2025, "Título 2025");

    const before = await resolvePilotContext({ speakerCharacterId: fixture.character.id });
    if (!before) throw new Error("unreachable");
    const beforeBlock = composePilotContextPromptBlock(before);

    const preview = await previewPersonaEvolution(fixture.universe.id, fixture.character.id);
    await applyPersonaEvolution(fixture.universe.id, fixture.character.id, {
      expectedRevision: preview.evolutionRevision,
      expectedPendingFingerprint: preview.pendingFingerprint,
    });

    const after = await resolvePilotContext({ speakerCharacterId: fixture.character.id });
    if (!after) throw new Error("unreachable");
    const afterBlock = composePilotContextPromptBlock(after);
    expect(after.evolution.revision).toBe(1);
    expect(after.evolution.notes[0]).toContain("Primeiro campeonato");
    expect(afterBlock.text).toContain("Ajustes derivados de experiência");
    expect(afterBlock.text).not.toContain("0.56");
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(afterBlock.text).not.toBe(beforeBlock.text);
  });
});
