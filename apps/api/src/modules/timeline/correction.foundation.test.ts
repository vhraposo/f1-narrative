import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import { setDriverNumber } from "../drivers/driver-number.service.js";
import {
  submitCorrection,
  validateCorrectionCommand,
  type CalendarCorrectionCommand,
  type CorrectionCommand,
  type NumberCorrectionCommand,
  type RaceResultCorrectionCommand,
  type SprintCorrectionCommand,
  type StandingCorrectionCommand,
} from "./correction.service.js";

const PREFIX = "tl-corr";

const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];

let universeAId: string;
let universeBId: string;
let seasonId: string;
let previousSeasonId: string;
let emptySeasonId: string;
let race1Id: string;
let race2Id: string;
let driver1Id: string;
let driver2Id: string;

const WORLD_DATE = new Date("2088-12-01T00:00:00.000Z");

async function createUserUniverse(label: string) {
  const user = await prisma.user.create({
    data: {
      name: `${PREFIX}-${label}`,
      email: `${PREFIX}-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@f1nw.test`,
      password: null,
      emailVerified: true,
    },
  });
  createdUserIds.push(user.id);
  const universe = await prisma.universe.create({
    data: { userId: user.id, status: "READY" },
  });
  createdUniverseIds.push(universe.id);
  return universe.id;
}

async function createDriver(universeId: string, label: string) {
  const character = await prisma.character.create({
    data: {
      name: `${PREFIX}-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      nationality: "BR",
      birthDate: new Date("1995-01-01"),
      controlledBy: "AI",
      universeId,
    },
  });
  createdCharacterIds.push(character.id);
  const profile = await prisma.driverProfile.create({
    data: { characterId: character.id },
  });
  return profile.id;
}

beforeAll(async () => {
  universeAId = await createUserUniverse("a");
  universeBId = await createUserUniverse("b");

  previousSeasonId = (
    await prisma.season.create({
      data: { universeId: universeAId, year: 2087, name: "2087", status: "FINISHED" },
    })
  ).id;
  seasonId = (
    await prisma.season.create({
      data: { universeId: universeAId, year: 2088, name: "2088", status: "ACTIVE" },
    })
  ).id;
  emptySeasonId = (
    await prisma.season.create({
      data: { universeId: universeAId, year: 2089, name: "2089", status: "PRE_SEASON" },
    })
  ).id;

  driver1Id = await createDriver(universeAId, "d1");
  driver2Id = await createDriver(universeAId, "d2");

  await prisma.seasonDriverEntry.create({
    data: {
      seasonId,
      driverProfileId: driver1Id,
      number: 1,
      role: "RACE_SEAT",
      status: "ACTIVE",
    },
  });
  await prisma.seasonDriverEntry.create({
    data: {
      seasonId,
      driverProfileId: driver2Id,
      number: 7,
      role: "RACE_SEAT",
      status: "ACTIVE",
    },
  });

  await prisma.championshipStanding.create({
    data: {
      seasonId: previousSeasonId,
      driverProfileId: driver1Id,
      points: 300,
      wins: 8,
      podiums: 12,
      position: 1,
    },
  });
  await prisma.championshipStanding.create({
    data: {
      seasonId: previousSeasonId,
      driverProfileId: driver2Id,
      points: 200,
      wins: 4,
      podiums: 9,
      position: 2,
    },
  });

  race1Id = (
    await prisma.race.create({
      data: {
        seasonId,
        name: "GP Correção 1",
        round: 1,
        date: new Date("2088-03-01T00:00:00.000Z"),
        status: "FINISHED",
      },
    })
  ).id;
  race2Id = (
    await prisma.race.create({
      data: {
        seasonId,
        name: "GP Correção 2",
        round: 2,
        date: new Date("2088-03-15T00:00:00.000Z"),
        status: "FINISHED",
      },
    })
  ).id;

  await prisma.raceResult.create({
    data: {
      raceId: race1Id,
      driverProfileId: driver1Id,
      position: 1,
      grid: 1,
      points: 25,
      status: "Finished",
    },
  });
  await prisma.raceResult.create({
    data: {
      raceId: race1Id,
      driverProfileId: driver2Id,
      position: 2,
      grid: 2,
      points: 18,
      status: "Finished",
    },
  });
  await prisma.raceResult.create({
    data: {
      raceId: race2Id,
      driverProfileId: driver1Id,
      position: 2,
      grid: 2,
      points: 18,
      status: "Finished",
    },
  });
  await prisma.raceResult.create({
    data: {
      raceId: race2Id,
      driverProfileId: driver2Id,
      position: 1,
      grid: 1,
      points: 25,
      status: "Finished",
    },
  });

  await prisma.worldState.create({
    data: {
      universeId: universeAId,
      key: "default",
      currentDate: WORLD_DATE,
      currentSeasonId: seasonId,
    },
  });
  await prisma.timelineEvent.create({
    data: {
      universeId: universeAId,
      sequence: 1,
      worldDate: WORLD_DATE,
      kind: "WORLD_ADVANCED",
      payload: {
        currentDate: WORLD_DATE.toISOString(),
        currentSeasonId: seasonId,
        currentRaceId: null,
        currentSession: null,
      },
      causedBy: "USER",
    },
  });
});

afterAll(async () => {
  await prisma.timelineEvent.deleteMany({
    where: { universeId: { in: [universeAId, universeBId] } },
  });
  await prisma.worldSnapshot.deleteMany({
    where: { universeId: { in: [universeAId, universeBId] } },
  });
  await prisma.championshipStanding.deleteMany({
    where: { seasonId: { in: [seasonId, previousSeasonId, emptySeasonId] } },
  });
  await prisma.raceResult.deleteMany({
    where: { race: { seasonId: { in: [seasonId, previousSeasonId, emptySeasonId] } } },
  });
  await prisma.raceSessionResult.deleteMany({
    where: { race: { seasonId: { in: [seasonId, previousSeasonId, emptySeasonId] } } },
  });
  await prisma.seasonDriverEntry.deleteMany({
    where: { seasonId: { in: [seasonId, previousSeasonId, emptySeasonId] } },
  });
  await prisma.race.deleteMany({
    where: { seasonId: { in: [seasonId, previousSeasonId, emptySeasonId] } },
  });
  await prisma.season.deleteMany({
    where: { id: { in: [seasonId, previousSeasonId, emptySeasonId] } },
  });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.universe.deleteMany({ where: { id: { in: createdUniverseIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

async function validate(command: CorrectionCommand) {
  return prisma.$transaction((tx) => validateCorrectionCommand(tx, universeAId, command));
}

describe("correction foundation — race result", () => {
  it("1) valida comando válido e rejeita campos inválidos", async () => {
    const valid: RaceResultCorrectionCommand = {
      kind: "RACE_RESULT_CORRECTED",
      worldDate: WORLD_DATE,
      raceId: race1Id,
      driverProfileId: driver2Id,
      position: 1,
    };
    await expect(validate(valid)).resolves.toBeUndefined();

    await expect(
      validate({ ...valid, position: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_POSITION" });
    await expect(
      validate({
        kind: "RACE_RESULT_CORRECTED",
        worldDate: WORLD_DATE,
        raceId: race1Id,
        driverProfileId: driver1Id,
      }),
    ).rejects.toMatchObject({ code: "EMPTY_CORRECTION" });
    await expect(
      validate({
        kind: "RACE_RESULT_CORRECTED",
        worldDate: WORLD_DATE,
        raceId: race2Id,
        driverProfileId: driver1Id,
        position: 3,
      }),
    ).resolves.toBeUndefined();
  });

  it("2) alvo de outro universo é leak-safe", async () => {
    await expect(
      prisma.$transaction((tx) =>
        validateCorrectionCommand(tx, universeBId, {
          kind: "RACE_RESULT_CORRECTED",
          worldDate: WORLD_DATE,
          raceId: race1Id,
          driverProfileId: driver1Id,
          position: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: "RACE_NOT_FOUND", statusCode: 404 });
  });

  it("3) submit aplica correção, recomputa standings, cria snapshot pré-correção e audita", async () => {
    const beforeSnapshot = await prisma.timelineEvent.aggregate({
      where: { universeId: universeAId },
      _max: { sequence: true },
    });
    const event = await submitCorrection(universeAId, {
      kind: "RACE_RESULT_CORRECTED",
      worldDate: new Date("2088-04-01T00:00:00.000Z"),
      raceId: race1Id,
      driverProfileId: driver2Id,
      position: 1,
    });
    expect(event.kind).toBe("RACE_RESULT_CORRECTED");
    expect(event.causedBy).toBe("USER");

    const result = await prisma.raceResult.findFirstOrThrow({
      where: { raceId: race1Id, driverProfileId: driver2Id },
    });
    expect(result.position).toBe(1);

    const standings = await prisma.championshipStanding.findMany({
      where: { seasonId },
      orderBy: { position: "asc" },
    });
    expect(standings[0]!.driverProfileId).toBe(driver2Id);
    expect(standings[0]!.points).toBe(50);

    const checkpoint = await prisma.worldSnapshot.findFirst({
      where: { universeId: universeAId, sequence: beforeSnapshot._max.sequence ?? 0 },
    });
    expect(checkpoint).not.toBeNull();

    const listed = await prisma.timelineEvent.findMany({
      where: { universeId: universeAId, kind: "RACE_RESULT_CORRECTED" },
    });
    expect(listed).toHaveLength(1);
  });

  it("4) correção encadeada usa supersedesId e replay efetivo", async () => {
    const first = await prisma.timelineEvent.findFirstOrThrow({
      where: { universeId: universeAId, kind: "RACE_RESULT_CORRECTED" },
    });
    const second = await submitCorrection(universeAId, {
      kind: "RACE_RESULT_CORRECTED",
      worldDate: new Date("2088-04-02T00:00:00.000Z"),
      raceId: race1Id,
      driverProfileId: driver2Id,
      position: 2,
      supersedesId: first.id,
    });
    expect(second.supersedesId).toBe(first.id);

    const result = await prisma.raceResult.findFirstOrThrow({
      where: { raceId: race1Id, driverProfileId: driver2Id },
    });
    expect(result.position).toBe(2);

    await expect(
      submitCorrection(universeAId, {
        kind: "RACE_RESULT_CORRECTED",
        worldDate: new Date("2088-04-03T00:00:00.000Z"),
        raceId: race1Id,
        driverProfileId: driver2Id,
        position: 1,
        supersedesId: "00000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toMatchObject({ code: "SUPERSEDES_NOT_FOUND", statusCode: 404 });
  });
});

describe("correction foundation — sprint, standing, número e calendário", () => {
  it("5) sprint exige resultado existente e elegibilidade válida", async () => {
    const base: SprintCorrectionCommand = {
      kind: "RACE_SESSION_RESULT_CORRECTED",
      worldDate: WORLD_DATE,
      raceId: race1Id,
      driverProfileId: driver1Id,
      position: 2,
    };
    await expect(validate(base)).rejects.toMatchObject({
      code: "RESULT_NOT_FOUND",
      statusCode: 404,
    });

    await prisma.raceSessionResult.create({
      data: {
        raceId: race1Id,
        driverProfileId: driver1Id,
        session: "SPRINT",
        position: 3,
        status: "Finished",
        points: 0,
        metadata: { eligibility: { neutralizedStart: false, distancePct: 100 } },
      },
    });
    await expect(validate(base)).resolves.toBeUndefined();
    await expect(
      validate({
        ...base,
        eligibility: { neutralizedStart: false, distancePct: 150 },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ELIGIBILITY" });
  });

  it("6) standing derivado é bloqueado com resultados; importado sem resultados é permitido", async () => {
    const standing: StandingCorrectionCommand = {
      kind: "STANDING_CORRECTED",
      worldDate: WORLD_DATE,
      seasonId,
      driverProfileId: driver2Id,
      points: 999,
    };
    await expect(validate(standing)).rejects.toMatchObject({
      code: "DERIVED_STANDING",
    });
    await expect(
      validate({ ...standing, seasonId: emptySeasonId }),
    ).resolves.toBeUndefined();
  });

  it("7) número: reservado, #1 do campeão, duplicado e válido", async () => {
    const base: NumberCorrectionCommand = {
      kind: "NUMBER_CORRECTED",
      worldDate: WORLD_DATE,
      seasonId,
      driverProfileId: driver2Id,
      number: 5,
    };
    await expect(validate(base)).resolves.toBeUndefined();
    await expect(
      validate({ ...base, number: 17 }),
    ).rejects.toMatchObject({ code: "NUMBER_RESERVED" });
    await expect(
      validate({ ...base, number: 1 }),
    ).rejects.toMatchObject({ code: "CHAMPION_ONLY" });
    await expect(
      validate({
        ...base,
        driverProfileId: driver1Id,
        number: 7,
      }),
    ).rejects.toMatchObject({ code: "NUMBER_ALREADY_USED" });
    await expect(
      validate({
        ...base,
        driverProfileId: driver1Id,
        number: 1,
      }),
    ).resolves.toBeUndefined();
  });

  it("8) calendário não permite reordenar corridas finalizadas", async () => {
    const base: CalendarCorrectionCommand = {
      kind: "RACE_UPDATED",
      worldDate: WORLD_DATE,
      raceId: race1Id,
      date: new Date("2088-03-20T00:00:00.000Z"),
    };
    await expect(validate(base)).rejects.toMatchObject({
      code: "SCHEDULE_ORDER_UNSAFE",
      statusCode: 409,
    });
    await expect(
      validate({
        kind: "RACE_UPDATED",
        worldDate: WORLD_DATE,
        raceId: race1Id,
        status: "FINISHED",
      }),
    ).resolves.toBeUndefined();
  });

  it("9) temporada com evolução aplicada bloqueia correção de resultado", async () => {
    await prisma.timelineEvent.create({
      data: {
        universeId: universeAId,
        sequence: 100,
        worldDate: WORLD_DATE,
        kind: "ATTRIBUTE_EVOLVED",
        payload: { seasonId, fingerprint: "fp-lock" },
        causedBy: "USER",
      },
    });
    await expect(
      validate({
        kind: "RACE_RESULT_CORRECTED",
        worldDate: WORLD_DATE,
        raceId: race2Id,
        driverProfileId: driver1Id,
        position: 3,
      }),
    ).rejects.toMatchObject({ code: "EVOLUTION_STALE", statusCode: 409 });
  });
});

describe("correction foundation — number lock", () => {
  it("10) setDriverNumber concorrente mantém unicidade", async () => {
    const attempts = await Promise.allSettled([
      setDriverNumber(universeAId, seasonId, driver1Id, 44),
      setDriverNumber(universeAId, seasonId, driver2Id, 44),
    ]);
    const fulfilled = attempts.filter((item) => item.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    const entries = await prisma.seasonDriverEntry.findMany({
      where: { seasonId, number: 44 },
    });
    expect(entries).toHaveLength(1);
  });
});
