import { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  appendTimelineEvent,
  lockUniverseTimeline,
} from "../timeline/timeline.service.js";
import {
  DRIVER_NUMBER_MAX,
  DRIVER_NUMBER_MIN,
  DRIVER_NUMBER_RESERVED,
  inspectDriverNumber,
} from "./driver-number.rules.js";

const WORLD_KEY = "default";

type Tx = Prisma.TransactionClient;

export class DriverNumberError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 409,
  ) {
    super(message);
    this.name = "DriverNumberError";
  }
}

export interface DriverNumberAvailability {
  number: number;
  available: boolean;
  reason: string | null;
  driverProfileId: string | null;
  driverName: string | null;
}

export interface DriverNumberBoard {
  seasonId: string;
  championDriverProfileId: string | null;
  numbers: DriverNumberAvailability[];
}

async function assertSeasonInUniverse(
  tx: Tx,
  universeId: string,
  seasonId: string,
): Promise<{ id: string; year: number }> {
  const season = await tx.season.findFirst({
    where: { id: seasonId, universeId },
    select: { id: true, year: true },
  });
  if (!season) {
    throw new DriverNumberError(
      "SEASON_NOT_FOUND",
      "Temporada não pertence a este universo.",
      404,
    );
  }
  return season;
}

export async function findPreviousSeasonChampion(
  tx: Tx,
  universeId: string,
  seasonYear: number,
): Promise<string | null> {
  const previous = await tx.season.findFirst({
    where: { universeId, year: seasonYear - 1 },
    select: { id: true },
  });
  if (!previous) return null;
  const standing = await tx.championshipStanding.findFirst({
    where: { seasonId: previous.id },
    orderBy: [{ position: "asc" }],
    select: { driverProfileId: true, position: true },
  });
  if (!standing || standing.position !== 1) return null;
  return standing.driverProfileId;
}

export async function listDriverNumbers(
  universeId: string,
  seasonId: string,
  driverProfileId?: string,
): Promise<DriverNumberBoard> {
  return prisma.$transaction(async (tx) => {
    const season = await assertSeasonInUniverse(tx, universeId, seasonId);
    const championDriverProfileId = await findPreviousSeasonChampion(
      tx,
      universeId,
      season.year,
    );
    const entries = await tx.seasonDriverEntry.findMany({
      where: { seasonId },
      select: {
        number: true,
        driverProfileId: true,
        driverProfile: {
          select: { character: { select: { name: true } } },
        },
      },
    });
    const ownerByNumber = new Map<
      number,
      { driverProfileId: string; driverName: string | null }
    >();
    for (const entry of entries) {
      if (entry.number === null) continue;
      ownerByNumber.set(entry.number, {
        driverProfileId: entry.driverProfileId,
        driverName: entry.driverProfile.character.name,
      });
    }

    const numbers: DriverNumberAvailability[] = [];
    for (let value = DRIVER_NUMBER_MIN; value <= DRIVER_NUMBER_MAX; value += 1) {
      const owner = ownerByNumber.get(value);
      if (owner) {
        numbers.push({
          number: value,
          available: false,
          reason: "NUMBER_ALREADY_USED",
          driverProfileId: owner.driverProfileId,
          driverName: owner.driverName,
        });
        continue;
      }
      if (value === DRIVER_NUMBER_RESERVED) {
        numbers.push({
          number: value,
          available: false,
          reason: "NUMBER_RESERVED",
          driverProfileId: null,
          driverName: null,
        });
        continue;
      }
      if (value === 1) {
        const eligible =
          championDriverProfileId !== null &&
          championDriverProfileId === driverProfileId;
        numbers.push({
          number: value,
          available: eligible,
          reason: eligible ? null : "CHAMPION_ONLY",
          driverProfileId: null,
          driverName: null,
        });
        continue;
      }
      numbers.push({
        number: value,
        available: true,
        reason: null,
        driverProfileId: null,
        driverName: null,
      });
    }

    return { seasonId, championDriverProfileId, numbers };
  });
}

export interface SetDriverNumberResult {
  entryId: string;
  driverProfileId: string;
  number: number | null;
}

export async function setDriverNumber(
  universeId: string,
  seasonId: string,
  driverProfileId: string,
  number: number | null,
): Promise<SetDriverNumberResult> {
  return prisma.$transaction(async (tx) => {
    await lockUniverseTimeline(tx, universeId);
    const season = await assertSeasonInUniverse(tx, universeId, seasonId);

    const entry = await tx.seasonDriverEntry.findUnique({
      where: {
        seasonId_driverProfileId: { seasonId, driverProfileId },
      },
      select: { id: true },
    });
    if (!entry) {
      throw new DriverNumberError(
        "DRIVER_NOT_FOUND",
        "Piloto não participa desta temporada do universo.",
        404,
      );
    }

    if (number !== null) {
      const issue = inspectDriverNumber(number);
      if (issue === "NUMBER_RESERVED") {
        throw new DriverNumberError(
          "NUMBER_RESERVED",
          `O número ${DRIVER_NUMBER_RESERVED} é reservado e não pode ser usado.`,
        );
      }
      if (issue === "NUMBER_INVALID") {
        throw new DriverNumberError(
          "NUMBER_INVALID",
          `Número inválido: use um inteiro entre ${DRIVER_NUMBER_MIN} e ${DRIVER_NUMBER_MAX}.`,
          400,
        );
      }
      if (number === 1) {
        const champion = await findPreviousSeasonChampion(
          tx,
          universeId,
          season.year,
        );
        if (!champion || champion !== driverProfileId) {
          throw new DriverNumberError(
            "CHAMPION_ONLY",
            "O número 1 é exclusivo do campeão da temporada anterior.",
          );
        }
      }
      const occupant = await tx.seasonDriverEntry.findFirst({
        where: {
          seasonId,
          number,
          driverProfileId: { not: driverProfileId },
        },
        select: { driverProfileId: true },
      });
      if (occupant) {
        throw new DriverNumberError(
          "NUMBER_ALREADY_USED",
          "Número já utilizado por outro piloto nesta temporada.",
        );
      }
    }

    try {
      await tx.seasonDriverEntry.update({
        where: { id: entry.id },
        data: { number },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new DriverNumberError(
          "NUMBER_ALREADY_USED",
          "Número já utilizado por outro piloto nesta temporada.",
        );
      }
      throw error;
    }

    const world = await tx.worldState.findUnique({
      where: { universeId_key: { universeId, key: WORLD_KEY } },
      select: { currentDate: true, currentSeasonId: true },
    });

    if (world?.currentSeasonId === seasonId) {
      await tx.driverProfile.update({
        where: { id: driverProfileId },
        data: { number },
      });
    }

    await appendTimelineEvent(tx, universeId, {
      kind: "NUMBER_CORRECTED",
      worldDate: world?.currentDate ?? new Date(),
      payload: {
        seasonId,
        driverProfileId,
        number,
      } as Prisma.InputJsonValue,
      causedBy: "USER",
    });

    return { entryId: entry.id, driverProfileId, number };
  });
}
