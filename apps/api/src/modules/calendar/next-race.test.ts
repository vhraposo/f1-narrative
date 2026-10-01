import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import { getNextRaceForUniverse } from "./next-race.service.js";

const RUN = Date.now().toString(36);
const YEAR = 2096;
const createdUserIds: string[] = [];

type Fixture = {
  userId: string;
  universeId: string;
  seasonId: string;
  raceIds: string[];
  circuitId: string;
};

async function setup(suffix: string, statuses: string[]): Promise<Fixture> {
  const user = await prisma.user.create({
    data: {
      email: `nr-${suffix}-${RUN}@f1nw.test`,
      name: `NR ${suffix}`,
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
    data: { universeId: universe.id, year: YEAR, status: "ACTIVE" },
    select: { id: true },
  });
  const circuit = await prisma.circuit.create({
    data: {
      universeId: universe.id,
      name: `Circuito NR ${suffix} ${RUN}`,
      locality: "Interlagos",
      country: "Brazil",
      latitude: -23.7,
      longitude: -46.7,
    },
    select: { id: true },
  });

  const raceIds: string[] = [];
  for (let index = 0; index < statuses.length; index += 1) {
    const race = await prisma.race.create({
      data: {
        seasonId: season.id,
        name: `GP ${index + 1} ${suffix} ${RUN}`,
        round: index + 1,
        date: new Date(`${YEAR}-0${index + 3}-01T00:00:00.000Z`),
        status: statuses[index] as "UPCOMING" | "QUALIFYING" | "RACE" | "FINISHED",
        circuitId: circuit.id,
        circuit: `Circuito NR ${suffix} ${RUN}`,
        country: "Brazil",
      },
      select: { id: true },
    });
    raceIds.push(race.id);
  }

  await prisma.worldState.create({
    data: {
      universeId: universe.id,
      key: "default",
      currentDate: new Date(`${YEAR}-03-01T00:00:00.000Z`),
      currentSeasonId: season.id,
      currentRaceId: null,
    },
  });

  return { userId: user.id, universeId: universe.id, seasonId: season.id, raceIds, circuitId: circuit.id };
}

async function setCurrentRace(fx: Fixture, raceId: string | null) {
  await prisma.worldState.update({
    where: { universeId_key: { universeId: fx.universeId, key: "default" } },
    data: { currentRaceId: raceId },
  });
}

afterAll(async () => {
  for (const userId of createdUserIds) {
    const universes = await prisma.universe.findMany({
      where: { userId },
      select: { id: true },
    });
    for (const universe of universes) {
      await prisma.worldState.deleteMany({ where: { universeId: universe.id } });
      await prisma.race.deleteMany({
        where: { season: { universeId: universe.id } },
      });
      await prisma.circuit.deleteMany({ where: { universeId: universe.id } });
      await prisma.season.deleteMany({ where: { universeId: universe.id } });
      await prisma.universe.delete({ where: { id: universe.id } });
    }
    await prisma.user.delete({ where: { id: userId } });
  }
  await prisma.$disconnect();
});

describe("Next Race — estado do Universe", () => {
  it("11/13) previous/current/next com total de rounds dinâmico e circuito", async () => {
    const fx = await setup("mid", ["FINISHED", "RACE", "UPCOMING"]);
    await setCurrentRace(fx, fx.raceIds[1]);

    const result = await getNextRaceForUniverse(fx.universeId);
    expect(result.totalRounds).toBe(3);
    expect(result.previous?.raceId).toBe(fx.raceIds[0]);
    expect(result.current?.raceId).toBe(fx.raceIds[1]);
    expect(result.next?.raceId).toBe(fx.raceIds[2]);
    expect(result.reason).toBeNull();
    expect(result.next?.circuit?.country).toBe("Brazil");
    expect(result.next?.circuit?.lengthMeters).toBeNull();
    expect(result.next?.circuit?.layoutUrl).toBeNull();
  });

  it("sem corrida atual: próxima é a primeira não finalizada", async () => {
    const fx = await setup("noc", ["FINISHED", "UPCOMING", "UPCOMING"]);
    const result = await getNextRaceForUniverse(fx.universeId);
    expect(result.current).toBeNull();
    expect(result.previous?.raceId).toBe(fx.raceIds[0]);
    expect(result.next?.raceId).toBe(fx.raceIds[1]);
  });

  it("12) temporada finalizada: next nulo com reason", async () => {
    const fx = await setup("done", ["FINISHED", "FINISHED"]);
    const result = await getNextRaceForUniverse(fx.universeId);
    expect(result.next).toBeNull();
    expect(result.reason).toBe("SEASON_FINISHED");
  });

  it("sem temporada atual: reason NO_CURRENT_SEASON", async () => {
    const fx = await setup("noseason", ["UPCOMING"]);
    await prisma.worldState.update({
      where: { universeId_key: { universeId: fx.universeId, key: "default" } },
      data: { currentSeasonId: null },
    });
    const result = await getNextRaceForUniverse(fx.universeId);
    expect(result.season).toBeNull();
    expect(result.reason).toBe("NO_CURRENT_SEASON");
  });

  it("17) não consulta fonte externa (fetch indisponível não afeta)", async () => {
    const fx = await setup("nofetch", ["UPCOMING"]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("fetch não deveria ser chamado");
    }) as typeof fetch;
    try {
      const result = await getNextRaceForUniverse(fx.universeId);
      expect(result.next?.raceId).toBe(fx.raceIds[0]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("isolamento: corridas de outro Universe não aparecem", async () => {
    const a = await setup("iso-a", ["UPCOMING"]);
    const b = await setup("iso-b", ["FINISHED", "UPCOMING"]);

    const resultA = await getNextRaceForUniverse(a.universeId);
    expect(resultA.totalRounds).toBe(1);
    expect(resultA.next?.raceId).toBe(a.raceIds[0]);

    const resultB = await getNextRaceForUniverse(b.universeId);
    expect(resultB.totalRounds).toBe(2);
    expect(resultB.next?.raceId).toBe(b.raceIds[1]);
  });

  it("enriquece o circuito com F1DB real e expõe o layout SVG", async () => {
    const fx = await setup("f1db", ["UPCOMING"]);
    await prisma.circuit.update({
      where: { id: fx.circuitId },
      data: {
        name: "Autódromo José Carlos Pace",
        locality: null,
        country: "Brazil",
        lengthMeters: null,
        turns: null,
      },
    });

    const result = await getNextRaceForUniverse(fx.universeId);
    const circuit = result.next?.circuit ?? null;
    expect(circuit?.fullName).toBe("Autódromo José Carlos Pace");
    expect(circuit?.locality).toBe("São Paulo");
    expect(circuit?.lengthMeters).toBe(4309);
    expect(circuit?.turns).toBe(15);
    expect(circuit?.lengthSource).toBe("F1DB");
    expect(circuit?.layoutUrl).toBe(
      "/api/external/circuits/f1db/interlagos/layout.svg",
    );
    expect(circuit?.layoutAttribution).toContain("CC BY 4.0");
  });
});
