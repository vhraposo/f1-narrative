import { afterAll, describe, expect, it } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  DriverNumberError,
  listDriverNumbers,
  setDriverNumber,
} from "./driver-number.service.js";
import { recomputeUniverseState } from "../timeline/timeline.service.js";

const RUN = Date.now().toString(36);
const YEAR = 2095;
const createdUserIds: string[] = [];
let app: FastifyInstance;

type TestUser = { cookie: string; userId: string };

async function createDbUser(suffix: string): Promise<TestUser> {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET not set");
  const user = await prisma.user.create({
    data: {
      email: `num-${suffix}-${RUN}@f1nw.test`,
      name: `Num ${suffix}`,
      password: null,
      emailVerified: false,
    },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      userId: user.id,
    },
  });
  const sig = createHmac("sha256", secret).update(token).digest("base64");
  return { cookie: `f1nw.session_token=${token}.${sig}`, userId: user.id };
}

type Fx = {
  user: TestUser;
  universeId: string;
  seasonId: string;
  previousSeasonId: string;
  driverA: string;
  driverB: string;
};

async function createDriver(
  universeId: string,
  userId: string,
  seasonId: string,
  teamId: string,
  name: string,
  number: number,
  seat: 1 | 2,
): Promise<string> {
  const character = await prisma.character.create({
    data: {
      userId,
      universeId,
      controlledBy: "USER",
      name,
      nationality: "Brasileira",
      birthDate: new Date("1995-01-01"),
    },
    select: { id: true },
  });
  const profile = await prisma.driverProfile.create({
    data: { characterId: character.id, number },
    select: { id: true },
  });
  await prisma.seasonDriverEntry.create({
    data: {
      seasonId,
      driverProfileId: profile.id,
      teamId,
      number,
      status: "ACTIVE",
      role: "RACE_SEAT",
      seat,
    },
  });
  return profile.id;
}

async function setup(suffix: string, withChampion = true): Promise<Fx> {
  const user = await createDbUser(suffix);
  const universe = await prisma.universe.create({
    data: { userId: user.userId, status: "READY" },
    select: { id: true },
  });
  const season = await prisma.season.create({
    data: { universeId: universe.id, year: YEAR, status: "ACTIVE" },
    select: { id: true },
  });
  const previousSeason = await prisma.season.create({
    data: { universeId: universe.id, year: YEAR - 1, status: "FINISHED" },
    select: { id: true },
  });
  const team = await prisma.team.create({
    data: {
      universeId: universe.id,
      userId: user.userId,
      name: `Team ${suffix} ${RUN}`,
    },
    select: { id: true },
  });
  const driverA = await createDriver(
    universe.id,
    user.userId,
    season.id,
    team.id,
    `Alpha ${suffix} ${RUN}`,
    10,
    1,
  );
  const driverB = await createDriver(
    universe.id,
    user.userId,
    season.id,
    team.id,
    `Beta ${suffix} ${RUN}`,
    11,
    2,
  );
  if (withChampion) {
    await prisma.championshipStanding.create({
      data: {
        seasonId: previousSeason.id,
        driverProfileId: driverA,
        points: 300,
        position: 1,
        wins: 5,
        podiums: 10,
      },
    });
  }
  await prisma.worldState.create({
    data: {
      universeId: universe.id,
      key: "default",
      currentDate: new Date(`${YEAR}-03-01T00:00:00.000Z`),
      currentSeasonId: season.id,
    },
  });
  return {
    user,
    universeId: universe.id,
    seasonId: season.id,
    previousSeasonId: previousSeason.id,
    driverA,
    driverB,
  };
}

async function expectNumberError(
  promise: Promise<unknown>,
  code: string,
  status?: number,
): Promise<void> {
  await promise.then(
    () => {
      throw new Error(`esperava erro ${code}`);
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(DriverNumberError);
      const typed = error as DriverNumberError;
      expect(typed.code).toBe(code);
      if (status !== undefined) expect(typed.statusCode).toBe(status);
    },
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
      await prisma.championshipStanding.deleteMany({
        where: { season: { universeId: universe.id } },
      });
      await prisma.seasonDriverEntry.deleteMany({
        where: { season: { universeId: universe.id } },
      });
      await prisma.worldState.deleteMany({ where: { universeId: universe.id } });
      await prisma.driverProfile.deleteMany({
        where: { character: { universeId: universe.id } },
      });
      await prisma.season.deleteMany({ where: { universeId: universe.id } });
      await prisma.character.deleteMany({ where: { universeId: universe.id } });
      await prisma.team.deleteMany({ where: { universeId: universe.id } });
      await prisma.universe.delete({ where: { id: universe.id } });
    }
    await prisma.user.delete({ where: { id: userId } });
  }
  await prisma.$disconnect();
});

describe("Driver Number — regras de domínio", () => {
  it("1/11) atribui número válido e reflete no cache do perfil", async () => {
    const fx = await setup("valid");
    const result = await setDriverNumber(
      fx.universeId,
      fx.seasonId,
      fx.driverB,
      44,
    );
    expect(result.number).toBe(44);

    const entry = await prisma.seasonDriverEntry.findUniqueOrThrow({
      where: {
        seasonId_driverProfileId: {
          seasonId: fx.seasonId,
          driverProfileId: fx.driverB,
        },
      },
      select: { number: true },
    });
    expect(entry.number).toBe(44);

    const profile = await prisma.driverProfile.findUniqueOrThrow({
      where: { id: fx.driverB },
      select: { number: true },
    });
    expect(profile.number).toBe(44);
  });

  it("2/3/4/5/6) rejeita 0, >99, negativo, decimal e #17", async () => {
    const fx = await setup("invalid");
    await expectNumberError(
      setDriverNumber(fx.universeId, fx.seasonId, fx.driverB, 0),
      "NUMBER_INVALID",
      400,
    );
    await expectNumberError(
      setDriverNumber(fx.universeId, fx.seasonId, fx.driverB, 100),
      "NUMBER_INVALID",
      400,
    );
    await expectNumberError(
      setDriverNumber(fx.universeId, fx.seasonId, fx.driverB, -1),
      "NUMBER_INVALID",
      400,
    );
    await expectNumberError(
      setDriverNumber(fx.universeId, fx.seasonId, fx.driverB, 1.5),
      "NUMBER_INVALID",
      400,
    );
    await expectNumberError(
      setDriverNumber(fx.universeId, fx.seasonId, fx.driverB, 17),
      "NUMBER_RESERVED",
      409,
    );
  });

  it("7/8/9) #1 apenas para o campeão anterior; sem campeão não é elegível", async () => {
    const champion = await setup("champ");
    const ok = await setDriverNumber(
      champion.universeId,
      champion.seasonId,
      champion.driverA,
      1,
    );
    expect(ok.number).toBe(1);
    await expectNumberError(
      setDriverNumber(
        champion.universeId,
        champion.seasonId,
        champion.driverB,
        1,
      ),
      "CHAMPION_ONLY",
      409,
    );

    const noChampion = await setup("nochamp", false);
    await expectNumberError(
      setDriverNumber(
        noChampion.universeId,
        noChampion.seasonId,
        noChampion.driverA,
        1,
      ),
      "CHAMPION_ONLY",
      409,
    );
  });

  it("10/16/17/18) ocupado, troca, ocupado na troca e #17 na troca", async () => {
    const fx = await setup("change");
    await expectNumberError(
      setDriverNumber(fx.universeId, fx.seasonId, fx.driverB, 10),
      "NUMBER_ALREADY_USED",
      409,
    );

    await setDriverNumber(fx.universeId, fx.seasonId, fx.driverB, 20);
    const moved = await prisma.seasonDriverEntry.findUniqueOrThrow({
      where: {
        seasonId_driverProfileId: {
          seasonId: fx.seasonId,
          driverProfileId: fx.driverB,
        },
      },
      select: { number: true },
    });
    expect(moved.number).toBe(20);

    await expectNumberError(
      setDriverNumber(fx.universeId, fx.seasonId, fx.driverB, 10),
      "NUMBER_ALREADY_USED",
      409,
    );
    await expectNumberError(
      setDriverNumber(fx.universeId, fx.seasonId, fx.driverB, 17),
      "NUMBER_RESERVED",
      409,
    );

    const after = await prisma.seasonDriverEntry.findUniqueOrThrow({
      where: {
        seasonId_driverProfileId: {
          seasonId: fx.seasonId,
          driverProfileId: fx.driverB,
        },
      },
      select: { number: true },
    });
    expect(after.number).toBe(20);
  });

  it("20) falha transacional não deixa piloto sem número", async () => {
    const fx = await setup("rollback");
    await expectNumberError(
      setDriverNumber(fx.universeId, fx.seasonId, fx.driverB, 10),
      "NUMBER_ALREADY_USED",
      409,
    );
    const entry = await prisma.seasonDriverEntry.findUniqueOrThrow({
      where: {
        seasonId_driverProfileId: {
          seasonId: fx.seasonId,
          driverProfileId: fx.driverB,
        },
      },
      select: { number: true },
    });
    expect(entry.number).toBe(11);
  });

  it("28) remoção de número (null) é permitida e libera o número", async () => {
    const fx = await setup("null");
    await setDriverNumber(fx.universeId, fx.seasonId, fx.driverB, null);
    const board = await listDriverNumbers(fx.universeId, fx.seasonId);
    const eleven = board.numbers.find((item) => item.number === 11);
    expect(eleven?.available).toBe(true);
  });

  it("12/13) unicidade é por temporada; outra temporada pode repetir", async () => {
    const fx = await setup("seasons");
    await setDriverNumber(fx.universeId, fx.seasonId, fx.driverB, 55);

    const otherSeason = await prisma.season.create({
      data: { universeId: fx.universeId, year: YEAR + 1, status: "PRE_SEASON" },
      select: { id: true },
    });
    const team = await prisma.team.findFirstOrThrow({
      where: { universeId: fx.universeId },
      select: { id: true },
    });
    const otherDriver = await createDriver(
      fx.universeId,
      fx.user.userId,
      otherSeason.id,
      team.id,
      `Gamma seasons ${RUN}`,
      9,
      1,
    );
    const result = await setDriverNumber(
      fx.universeId,
      otherSeason.id,
      otherDriver,
      55,
    );
    expect(result.number).toBe(55);
  });

  it("14) universos diferentes mantêm o mesmo número sem conflito", async () => {
    const a = await setup("iso-a");
    const b = await setup("iso-b");
    await setDriverNumber(a.universeId, a.seasonId, a.driverB, 44);
    const resultB = await setDriverNumber(
      b.universeId,
      b.seasonId,
      b.driverB,
      44,
    );
    expect(resultB.number).toBe(44);

    const boardA = await listDriverNumbers(a.universeId, a.seasonId);
    expect(
      boardA.numbers.find((item) => item.number === 44)?.driverProfileId,
    ).toBe(a.driverB);
  });

  it("15) External Mirror não é tocado pela atribuição", async () => {
    const fx = await setup("mirror");
    const ext = await prisma.externalDriver.create({
      data: {
        source: "jolpica",
        externalId: `num-ext-${RUN}`,
        name: `Ext ${RUN}`,
        number: 7,
        contentHash: `num-ext-${RUN}`,
      },
      select: { id: true, number: true },
    });
    await prisma.externalDriverSeason.create({
      data: {
        source: "jolpica",
        externalDriverId: ext.id,
        seasonYear: YEAR,
        number: 7,
        contentHash: `num-ext-season-${RUN}`,
      },
    });

    await setDriverNumber(fx.universeId, fx.seasonId, fx.driverB, 33);

    const storedExt = await prisma.externalDriver.findUniqueOrThrow({
      where: { id: ext.id },
      select: { number: true },
    });
    const storedSeason = await prisma.externalDriverSeason.findFirstOrThrow({
      where: { externalDriverId: ext.id, seasonYear: YEAR },
      select: { number: true },
    });
    expect(storedExt.number).toBe(7);
    expect(storedSeason.number).toBe(7);

    await prisma.externalDriverSeason.deleteMany({
      where: { externalDriverId: ext.id },
    });
    await prisma.externalDriver.delete({ where: { id: ext.id } });
  });

  it("21/22) Timeline registra NUMBER_CORRECTED e replay é determinístico", async () => {
    const fx = await setup("timeline");
    await setDriverNumber(fx.universeId, fx.seasonId, fx.driverB, 44);

    const events = await prisma.timelineEvent.findMany({
      where: { universeId: fx.universeId, kind: "NUMBER_CORRECTED" },
      select: { payload: true },
    });
    expect(events).toHaveLength(1);

    const before = await prisma.seasonDriverEntry.findUniqueOrThrow({
      where: {
        seasonId_driverProfileId: {
          seasonId: fx.seasonId,
          driverProfileId: fx.driverB,
        },
      },
      select: { number: true },
    });

    await prisma.$transaction((tx) => recomputeUniverseState(tx, fx.universeId));

    const after = await prisma.seasonDriverEntry.findUniqueOrThrow({
      where: {
        seasonId_driverProfileId: {
          seasonId: fx.seasonId,
          driverProfileId: fx.driverB,
        },
      },
      select: { number: true },
    });
    expect(after).toEqual(before);
    expect(
      await prisma.timelineEvent.count({
        where: { universeId: fx.universeId, kind: "NUMBER_CORRECTED" },
      }),
    ).toBe(1);
  });

  it("19) concorrência: apenas uma atribuição vence", async () => {
    const fx = await setup("conc");
    const results = await Promise.allSettled([
      setDriverNumber(fx.universeId, fx.seasonId, fx.driverA, 77),
      setDriverNumber(fx.universeId, fx.seasonId, fx.driverB, 77),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      DriverNumberError,
    );
    expect(
      (rejected[0] as PromiseRejectedResult).reason.code,
    ).toBe("NUMBER_ALREADY_USED");

    const owners = await prisma.seasonDriverEntry.count({
      where: { seasonId: fx.seasonId, number: 77 },
    });
    expect(owners).toBe(1);
  });

  it("26) constraint real no banco impede duplicidade", async () => {
    const fx = await setup("constraint");
    await expect(
      prisma.seasonDriverEntry.update({
        where: {
          seasonId_driverProfileId: {
            seasonId: fx.seasonId,
            driverProfileId: fx.driverB,
          },
        },
        data: { number: 10 },
      }),
    ).rejects.toThrow();
  });

  it("24) board de disponibilidade com motivos e owner", async () => {
    const fx = await setup("board");
    const board = await listDriverNumbers(fx.universeId, fx.seasonId, fx.driverA);
    expect(board.numbers).toHaveLength(99);
    expect(board.championDriverProfileId).toBe(fx.driverA);

    const seventeen = board.numbers.find((item) => item.number === 17);
    expect(seventeen?.available).toBe(false);
    expect(seventeen?.reason).toBe("NUMBER_RESERVED");

    const one = board.numbers.find((item) => item.number === 1);
    expect(one?.available).toBe(true);

    const oneForOther = await listDriverNumbers(
      fx.universeId,
      fx.seasonId,
      fx.driverB,
    );
    expect(oneForOther.numbers.find((item) => item.number === 1)?.reason).toBe(
      "CHAMPION_ONLY",
    );

    const ten = board.numbers.find((item) => item.number === 10);
    expect(ten?.driverProfileId).toBe(fx.driverA);
    expect(ten?.available).toBe(false);
  });

  it("23) rota PUT responde 200 e 409 com código semântico", async () => {
    app = buildApp();
    await app.ready();
    const fx = await setup("route");

    const ok = await app.inject({
      method: "PUT",
      url: `/api/seasons/${fx.seasonId}/drivers/${fx.driverB}/number`,
      headers: { cookie: fx.user.cookie },
      payload: { number: 44 },
      remoteAddress: "10.20.1.1",
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().number.number).toBe(44);

    const conflict = await app.inject({
      method: "PUT",
      url: `/api/seasons/${fx.seasonId}/drivers/${fx.driverB}/number`,
      headers: { cookie: fx.user.cookie },
      payload: { number: 10 },
      remoteAddress: "10.20.1.2",
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe("NUMBER_ALREADY_USED");

    await app.close();
  });
});
