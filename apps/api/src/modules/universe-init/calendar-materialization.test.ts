import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import { recomputeUniverseState } from "../timeline/timeline.service.js";
import { universeInitService } from "./universe-init.service.js";

const RUN = Date.now().toString(36);
const YEAR = 2097;
const SOURCE = "jolpica";
const createdUserIds: string[] = [];
const createdYears: number[] = [];

type Fixture = {
  userId: string;
  universeId: string;
  seasonId: string;
  externalSeasonId: string;
  circuitExternalId: string;
  externalRaceIds: string[];
  year: number;
};

async function setup(suffix: string): Promise<Fixture> {
  const year = YEAR - createdYears.length;
  createdYears.push(year);
  const circuitExternalId = `cal-circuit-${suffix}-${RUN}`;

  const user = await prisma.user.create({
    data: {
      email: `cal-${suffix}-${RUN}@f1nw.test`,
      name: `Cal ${suffix}`,
      password: null,
      emailVerified: false,
    },
    select: { id: true },
  });
  createdUserIds.push(user.id);

  const universe = await prisma.universe.create({
    data: { userId: user.id, status: "READY" },
    select: { id: true },
  });
  const season = await prisma.season.create({
    data: { universeId: universe.id, year, status: "PRE_SEASON" },
    select: { id: true },
  });

  const externalSeason = await prisma.externalSeason.create({
    data: {
      source: SOURCE,
      year,
      contentHash: `season-${suffix}-${RUN}`,
    },
    select: { id: true },
  });
  await prisma.externalBindingSeason.create({
    data: {
      universeId: universe.id,
      externalSeasonId: externalSeason.id,
      seasonId: season.id,
      confidence: "CONFIRMED",
    },
  });

  const circuit = await prisma.externalCircuit.create({
    data: {
      source: SOURCE,
      externalId: circuitExternalId,
      name: `Circuito Calendario ${RUN}`,
      locality: "São Paulo",
      country: "Brazil",
      contentHash: `circuit-${RUN}`,
    },
    select: { id: true },
  });

  const race1 = await prisma.externalRace.create({
    data: {
      source: SOURCE,
      seasonYear: year,
      round: 1,
      grandPrix: `GP Um ${suffix}`,
      name: `GP Um ${suffix}`,
      circuitName: `Circuito Calendario ${RUN}`,
      circuitExternalId,
      externalCircuitId: circuit.id,
      country: "Brazil",
      date: new Date(`${year}-03-01T00:00:00.000Z`),
      contentHash: `race1-${suffix}-${RUN}`,
    },
    select: { id: true },
  });
  const race2 = await prisma.externalRace.create({
    data: {
      source: SOURCE,
      seasonYear: year,
      round: 2,
      grandPrix: `GP Dois ${suffix}`,
      name: `GP Dois ${suffix}`,
      circuitName: null,
      date: new Date(`${year}-03-08T00:00:00.000Z`),
      contentHash: `race2-${suffix}-${RUN}`,
    },
    select: { id: true },
  });

  return {
    userId: user.id,
    universeId: universe.id,
    seasonId: season.id,
    externalSeasonId: externalSeason.id,
    circuitExternalId: circuit.id,
    externalRaceIds: [race1.id, race2.id],
    year,
  };
}

function materializeInput(fx: Fixture) {
  return {
    seasonId: fx.seasonId,
    externalSeasonId: fx.externalSeasonId,
    scopes: ["RACES"] as const,
  };
}

async function execute(fx: Fixture) {
  return universeInitService.execute(
    { id: fx.userId, role: "USER" },
    { ...materializeInput(fx), scopes: ["RACES"] },
  );
}

afterAll(async () => {
  for (const userId of createdUserIds) {
    const universes = await prisma.universe.findMany({
      where: { userId },
      select: { id: true },
    });
    for (const universe of universes) {
      await prisma.timelineEvent.deleteMany({
        where: { universeId: universe.id },
      });
      await prisma.worldSnapshot.deleteMany({
        where: { universeId: universe.id },
      });
      await prisma.race.deleteMany({
        where: { season: { universeId: universe.id } },
      });
      await prisma.season.deleteMany({ where: { universeId: universe.id } });
      await prisma.universe.delete({ where: { id: universe.id } });
    }
    await prisma.externalRace.deleteMany({
      where: { source: SOURCE, seasonYear: { in: createdYears } },
    });
    await prisma.externalCircuit.deleteMany({
      where: { source: SOURCE, externalId: { startsWith: "cal-circuit-" } },
    });
    await prisma.externalSeason.deleteMany({
      where: { source: SOURCE, year: { in: createdYears } },
    });
    await prisma.user.delete({ where: { id: userId } });
  }
  await prisma.$disconnect();
});

describe("Calendário — materialização por Universe", () => {
  it("1/3/4/7) materializa corridas com circuito vinculado e evento RACE_SCHEDULED", async () => {
    const fx = await setup("mat");
    const report = await execute(fx);
    expect(report.summary.racesCreated).toBe(2);

    const races = await prisma.race.findMany({
      where: { seasonId: fx.seasonId },
      orderBy: { round: "asc" },
      select: { id: true, name: true, circuitId: true, date: true, round: true },
    });
    expect(races).toHaveLength(2);
    expect(races[0].circuitId).not.toBeNull();
    expect(races[1].circuitId).toBeNull();

    const circuit = await prisma.circuit.findFirstOrThrow({
      where: { universeId: fx.universeId },
      select: { id: true, name: true, country: true },
    });
    expect(races[0].circuitId).toBe(circuit.id);

    const bindingCircuit = await prisma.externalBindingCircuit.count({
      where: { universeId: fx.universeId },
    });
    expect(bindingCircuit).toBe(1);

    const events = await prisma.timelineEvent.findMany({
      where: { universeId: fx.universeId },
      select: { kind: true, payload: true },
    });
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.kind === "RACE_SCHEDULED")).toBe(true);
  });

  it("2/5) segunda execução é idempotente (sem corridas, eventos ou circuitos duplicados)", async () => {
    const fx = await setup("idem");
    await execute(fx);
    const second = await execute(fx);
    expect(second.summary.racesCreated).toBe(0);
    expect(second.summary.racesReused).toBe(2);

    expect(
      await prisma.race.count({ where: { seasonId: fx.seasonId } }),
    ).toBe(2);
    expect(
      await prisma.timelineEvent.count({ where: { universeId: fx.universeId } }),
    ).toBe(2);
    expect(
      await prisma.circuit.count({ where: { universeId: fx.universeId } }),
    ).toBe(1);
    expect(
      await prisma.externalBindingRace.count({
        where: { universeId: fx.universeId },
      }),
    ).toBe(2);
  });

  it("6) dois universos materializam o mesmo calendário sem compartilhar entidades", async () => {
    const a = await setup("iso-a");
    const b = await setup("iso-b");
    await execute(a);
    await execute(b);

    const racesA = await prisma.race.findMany({
      where: { seasonId: a.seasonId },
      select: { id: true, circuitId: true },
    });
    const racesB = await prisma.race.findMany({
      where: { seasonId: b.seasonId },
      select: { id: true, circuitId: true },
    });
    expect(racesA).toHaveLength(2);
    expect(racesB).toHaveLength(2);
    expect(racesA.some((race) => racesB.some((other) => other.id === race.id))).toBe(false);
    expect(racesA[0].circuitId).not.toBe(racesB[0].circuitId);
  });

  it("9/16) alteração externa gera RACE_UPDATED e não sobrescreve edição do usuário", async () => {
    const fx = await setup("update");
    await execute(fx);

    const race = await prisma.race.findFirstOrThrow({
      where: { seasonId: fx.seasonId, round: 1 },
      select: { id: true },
    });
    await prisma.race.update({
      where: { id: race.id },
      data: { name: "Meu GP Editado" },
    });

    await prisma.externalRace.update({
      where: { id: fx.externalRaceIds[0] },
      data: {
        name: `GP Um Renomeado ${RUN}`,
        grandPrix: `GP Um Renomeado ${RUN}`,
        date: new Date(`${fx.year}-03-02T00:00:00.000Z`),
        contentHash: `race1-renamed-${RUN}`,
      },
    });

    await execute(fx);

    const updated = await prisma.race.findUniqueOrThrow({
      where: { id: race.id },
      select: { name: true, date: true },
    });
    expect(updated.name).toBe("Meu GP Editado");
    expect(updated.date?.toISOString()).toBe(
      new Date(`${fx.year}-03-02T00:00:00.000Z`).toISOString(),
    );

    const updatedEvents = await prisma.timelineEvent.findMany({
      where: { universeId: fx.universeId, kind: "RACE_UPDATED" },
      select: { id: true },
    });
    expect(updatedEvents).toHaveLength(1);
  });

  it("10) corrida com dados incompletos não quebra o lote", async () => {
    const fx = await setup("incomplete");
    await prisma.externalRace.create({
      data: {
        source: SOURCE,
        seasonYear: fx.year,
        round: 3,
        name: `GP Incompleto ${RUN}`,
        contentHash: `race3-incomplete-${RUN}`,
      },
    });

    const report = await execute(fx);
    expect(report.summary.racesCreated).toBe(3);

    const incomplete = await prisma.race.findFirstOrThrow({
      where: { seasonId: fx.seasonId, round: 3 },
      select: { circuitId: true, date: true },
    });
    expect(incomplete.circuitId).toBeNull();
    expect(incomplete.date).toBeNull();
  });

  it("14) materializações concorrentes não duplicam", async () => {
    const fx = await setup("conc");
    await Promise.all([execute(fx), execute(fx)]);

    expect(
      await prisma.race.count({ where: { seasonId: fx.seasonId } }),
    ).toBe(2);
    expect(
      await prisma.timelineEvent.count({ where: { universeId: fx.universeId } }),
    ).toBe(2);
    expect(
      await prisma.externalBindingRace.count({
        where: { universeId: fx.universeId },
      }),
    ).toBe(2);
  });

  it("19) recompute continua determinístico com eventos de calendário", async () => {
    const fx = await setup("recompute");
    await execute(fx);

    const eventsBefore = await prisma.timelineEvent.count({
      where: { universeId: fx.universeId },
    });
    const first = await prisma.$transaction((tx) =>
      recomputeUniverseState(tx, fx.universeId),
    );
    const second = await prisma.$transaction((tx) =>
      recomputeUniverseState(tx, fx.universeId),
    );
    expect(first.applied).toBe(eventsBefore);
    expect(second.applied).toBe(eventsBefore);
    expect(
      await prisma.timelineEvent.count({ where: { universeId: fx.universeId } }),
    ).toBe(eventsBefore);
  });
});
