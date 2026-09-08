import { Prisma, type DriverEntryEventKind, type DriverRole, type DriverStatus } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";

const WORLD_KEY = "default";
const RACE_SEATS: readonly number[] = [1, 2];

export const entryInclude = {
  driverProfile: {
    include: {
      character: {
        select: { id: true, name: true, nationality: true, imageUrl: true },
      },
    },
  },
  team: {
    select: { id: true, name: true, shortName: true, color: true },
  },
} as const;

type Tx = Prisma.TransactionClient;

type EntryState = {
  teamId: string | null;
  role: DriverRole | null;
  seat: number | null;
  number: number | null;
  status: DriverStatus;
};

export class RosterError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 409,
  ) {
    super(message);
    this.name = "RosterError";
  }
}

type AssignInput = {
  seasonId: string;
  teamId: string;
  driverProfileId: string;
  seat: number;
  number?: number | null;
};

type HireInput = {
  seasonId: string;
  teamId: string;
  driverProfileId: string;
  role: DriverRole;
  seat?: number | null;
  number?: number | null;
};

type TeamInput = {
  seasonId: string;
  teamId: string;
  driverProfileId: string;
};

function toState(entry: EntryState): EntryState {
  return {
    teamId: entry.teamId ?? null,
    role: entry.role ?? null,
    seat: entry.seat ?? null,
    number: entry.number ?? null,
    status: entry.status,
  };
}

async function logEvent(
  tx: Tx,
  entryId: string,
  kind: DriverEntryEventKind,
  from: EntryState | null,
  to: EntryState | null,
  reason?: string,
): Promise<void> {
  await tx.driverEntryEvent.create({
    data: {
      entryId,
      kind,
      from: from ? (from as unknown as Prisma.InputJsonObject) : Prisma.JsonNull,
      to: to ? (to as unknown as Prisma.InputJsonObject) : Prisma.JsonNull,
      reason,
    },
  });
}

async function assertTeamOwned(tx: Tx, teamId: string, userId: string): Promise<void> {
  const team = await tx.team.findFirst({
    where: { id: teamId, userId },
    select: { id: true },
  });
  if (!team) {
    throw new RosterError("TEAM_NOT_FOUND", "Equipe não encontrada", 404);
  }
}

async function assertDriverOwned(tx: Tx, driverProfileId: string, userId: string): Promise<void> {
  const driver = await tx.driverProfile.findFirst({
    where: { id: driverProfileId, character: { userId } },
    select: { id: true },
  });
  if (!driver) {
    throw new RosterError("DRIVER_NOT_FOUND", "Piloto não encontrado", 404);
  }
}

async function assertSeasonExists(tx: Tx, seasonId: string): Promise<void> {
  const season = await tx.season.findUnique({
    where: { id: seasonId },
    select: { id: true },
  });
  if (!season) {
    throw new RosterError("SEASON_NOT_FOUND", "Temporada não encontrada", 404);
  }
}

async function assertValidSeat(seat: number): Promise<void> {
  if (!RACE_SEATS.includes(seat)) {
    throw new RosterError(
      "INVALID_SEAT",
      "Assento inválido: uma equipe possui apenas os assentos 1 e 2",
      400,
    );
  }
}

// DriverProfile.teamId é um cache de conveniência do vínculo atual. A fonte de
// verdade é a SeasonDriverEntry da temporada corrente (WorldState). O cache só
// é sincronizado quando a temporada manipulada É a temporada corrente.
async function syncTeamCache(
  tx: Tx,
  driverProfileId: string,
  teamId: string | null,
  seasonId: string,
): Promise<void> {
  const world = await tx.worldState.findUnique({
    where: { key: WORLD_KEY },
    select: { currentSeasonId: true },
  });
  if (world?.currentSeasonId === seasonId) {
    await tx.driverProfile.update({
      where: { id: driverProfileId },
      data: { teamId },
    });
  }
}

async function displaceOccupant(
  tx: Tx,
  occupant: {
    id: string;
    driverProfileId: string;
    teamId: string | null;
    role: DriverRole | null;
    seat: number | null;
    number: number | null;
    status: DriverStatus;
  },
  seasonId: string,
): Promise<void> {
  if (occupant.status !== "ACTIVE") return;
  const updated = await tx.seasonDriverEntry.update({
    where: { id: occupant.id },
    data: { teamId: null, role: null, seat: null, number: null, status: "AVAILABLE" },
  });
  await syncTeamCache(tx, occupant.driverProfileId, null, seasonId);
  await logEvent(
    tx,
    occupant.id,
    "DISPLACED",
    toState(occupant),
    toState(updated),
    "Perdeu o assento em favor de outro piloto",
  );
}

export const rosterService = {
  async assignDriverToSeat(userId: string, input: AssignInput) {
    await assertValidSeat(input.seat);
    return prisma.$transaction(async (tx) => {
      await assertSeasonExists(tx, input.seasonId);
      await assertTeamOwned(tx, input.teamId, userId);
      await assertDriverOwned(tx, input.driverProfileId, userId);

      const existing = await tx.seasonDriverEntry.findUnique({
        where: {
          seasonId_driverProfileId: {
            seasonId: input.seasonId,
            driverProfileId: input.driverProfileId,
          },
        },
      });

      if (existing?.teamId && existing.teamId !== input.teamId) {
        throw new RosterError(
          "DRIVER_ALREADY_IN_TEAM",
          "O piloto já pertence a outra equipe nesta temporada",
          409,
        );
      }

      const occupant = await tx.seasonDriverEntry.findUnique({
        where: {
          seasonId_teamId_seat: {
            seasonId: input.seasonId,
            teamId: input.teamId,
            seat: input.seat,
          },
        },
      });

      if (occupant?.driverProfileId === input.driverProfileId) {
        const updated = await tx.seasonDriverEntry.update({
          where: { id: occupant.id },
          data: { number: input.number ?? occupant.number ?? null },
          include: entryInclude,
        });
        await syncTeamCache(tx, input.driverProfileId, input.teamId, input.seasonId);
        await logEvent(tx, occupant.id, "SEATED", toState(occupant), toState(updated));
        return updated;
      }

      if (occupant) {
        await displaceOccupant(tx, occupant, input.seasonId);
      }

      const kind: DriverEntryEventKind = existing
        ? existing.role === "RESERVE"
          ? "PROMOTED"
          : "SEATED"
        : "CREATED";

      const target = existing
        ? await tx.seasonDriverEntry.update({
            where: { id: existing.id },
            data: {
              teamId: input.teamId,
              role: "RACE_SEAT",
              seat: input.seat,
              number: input.number ?? existing.number ?? null,
              status: "ACTIVE",
            },
            include: entryInclude,
          })
        : await tx.seasonDriverEntry.create({
            data: {
              seasonId: input.seasonId,
              driverProfileId: input.driverProfileId,
              teamId: input.teamId,
              role: "RACE_SEAT",
              seat: input.seat,
              number: input.number ?? null,
              status: "ACTIVE",
              provenance: "CANONICAL",
            },
            include: entryInclude,
          });

      await syncTeamCache(tx, input.driverProfileId, input.teamId, input.seasonId);
      await logEvent(tx, target.id, kind, existing ? toState(existing) : null, toState(target));
      return target;
    });
  },

  async releaseDriver(userId: string, input: TeamInput) {
    return prisma.$transaction(async (tx) => {
      await assertSeasonExists(tx, input.seasonId);
      await assertTeamOwned(tx, input.teamId, userId);
      await assertDriverOwned(tx, input.driverProfileId, userId);

      const existing = await tx.seasonDriverEntry.findUnique({
        where: {
          seasonId_driverProfileId: {
            seasonId: input.seasonId,
            driverProfileId: input.driverProfileId,
          },
        },
      });

      if (!existing || existing.teamId !== input.teamId) {
        throw new RosterError(
          "NOT_IN_TEAM",
          "O piloto não está vinculado a esta equipe nesta temporada",
          409,
        );
      }

      const updated = await tx.seasonDriverEntry.update({
        where: { id: existing.id },
        data: { teamId: null, role: null, seat: null, number: null, status: "AVAILABLE" },
        include: entryInclude,
      });
      await syncTeamCache(tx, input.driverProfileId, null, input.seasonId);
      await logEvent(tx, existing.id, "RELEASED", toState(existing), toState(updated));
      return updated;
    });
  },

  async hireDriver(userId: string, input: HireInput) {
    return prisma.$transaction(async (tx) => {
      await assertSeasonExists(tx, input.seasonId);
      await assertTeamOwned(tx, input.teamId, userId);
      await assertDriverOwned(tx, input.driverProfileId, userId);

      if (input.role === "RACE_SEAT") {
        await assertValidSeat(input.seat ?? 0);
      }

      const existing = await tx.seasonDriverEntry.findUnique({
        where: {
          seasonId_driverProfileId: {
            seasonId: input.seasonId,
            driverProfileId: input.driverProfileId,
          },
        },
      });

      if (existing?.status === "ACTIVE") {
        throw new RosterError(
          "DRIVER_NOT_AVAILABLE",
          "O piloto já está ativo e vinculado a uma equipe nesta temporada",
          409,
        );
      }

      if (existing?.teamId && existing.teamId !== input.teamId) {
        throw new RosterError(
          "DRIVER_ALREADY_IN_TEAM",
          "O piloto já pertence a outra equipe nesta temporada",
          409,
        );
      }

      if (input.role === "RACE_SEAT") {
        const occupant = await tx.seasonDriverEntry.findUnique({
          where: {
            seasonId_teamId_seat: {
              seasonId: input.seasonId,
              teamId: input.teamId,
              seat: input.seat ?? 0,
            },
          },
        });
        if (occupant) {
          throw new RosterError(
            "SEAT_OCCUPIED",
            "O assento já está ocupado: use a operação de designação para substituir",
            409,
          );
        }
      }

      if (input.role === "RESERVE") {
        const reserveCount = await tx.seasonDriverEntry.count({
          where: { seasonId: input.seasonId, teamId: input.teamId, role: "RESERVE", status: "ACTIVE" },
        });
        if (reserveCount > 0) {
          throw new RosterError(
            "RESERVE_LIMIT",
            "A equipe já possui um piloto reserva nesta temporada",
            409,
          );
        }
      }

      const seat = input.role === "RESERVE" ? null : (input.seat ?? null);
      const kind: DriverEntryEventKind = existing ? "HIRED" : "CREATED";

      const target = existing
        ? await tx.seasonDriverEntry.update({
            where: { id: existing.id },
            data: {
              teamId: input.teamId,
              role: input.role,
              seat,
              number: input.number ?? existing.number ?? null,
              status: "ACTIVE",
            },
            include: entryInclude,
          })
        : await tx.seasonDriverEntry.create({
            data: {
              seasonId: input.seasonId,
              driverProfileId: input.driverProfileId,
              teamId: input.teamId,
              role: input.role,
              seat,
              number: input.number ?? null,
              status: "ACTIVE",
              provenance: "CANONICAL",
            },
            include: entryInclude,
          });

      await syncTeamCache(tx, input.driverProfileId, input.teamId, input.seasonId);
      await logEvent(tx, target.id, kind, existing ? toState(existing) : null, toState(target));
      return target;
    });
  },

  assignReserve(userId: string, input: TeamInput) {
    return this.hireDriver(userId, {
      seasonId: input.seasonId,
      teamId: input.teamId,
      driverProfileId: input.driverProfileId,
      role: "RESERVE",
      seat: null,
    });
  },

  async promoteReserve(userId: string, input: AssignInput) {
    await assertValidSeat(input.seat);
    return prisma.$transaction(async (tx) => {
      await assertSeasonExists(tx, input.seasonId);
      await assertTeamOwned(tx, input.teamId, userId);
      await assertDriverOwned(tx, input.driverProfileId, userId);

      const existing = await tx.seasonDriverEntry.findUnique({
        where: {
          seasonId_driverProfileId: {
            seasonId: input.seasonId,
            driverProfileId: input.driverProfileId,
          },
        },
      });

      if (!existing || existing.teamId !== input.teamId || existing.role !== "RESERVE") {
        throw new RosterError(
          "NOT_RESERVE",
          "O piloto não é reserva desta equipe nesta temporada",
          409,
        );
      }

      const occupant = await tx.seasonDriverEntry.findUnique({
        where: {
          seasonId_teamId_seat: {
            seasonId: input.seasonId,
            teamId: input.teamId,
            seat: input.seat,
          },
        },
      });

      if (occupant) {
        throw new RosterError(
          "SEAT_OCCUPIED",
          "O assento já está ocupado: libere o assento antes de promover o reserva",
          409,
        );
      }

      const updated = await tx.seasonDriverEntry.update({
        where: { id: existing.id },
        data: {
          role: "RACE_SEAT",
          seat: input.seat,
          number: input.number ?? existing.number ?? null,
          status: "ACTIVE",
        },
        include: entryInclude,
      });
      await syncTeamCache(tx, input.driverProfileId, input.teamId, input.seasonId);
      await logEvent(tx, existing.id, "PROMOTED", toState(existing), toState(updated));
      return updated;
    });
  },

  getSeasonRoster(seasonId: string) {
    return prisma.seasonDriverEntry.findMany({
      where: { seasonId },
      include: entryInclude,
      orderBy: [{ role: "asc" }, { seat: "asc" }],
    });
  },

  getDriverSeasonEntry(driverProfileId: string, seasonId: string) {
    return prisma.seasonDriverEntry.findUnique({
      where: {
        seasonId_driverProfileId: { seasonId, driverProfileId },
      },
      include: entryInclude,
    });
  },

  async getAvailableDrivers(userId: string, seasonId: string) {
    const drivers = await prisma.driverProfile.findMany({
      where: { character: { userId } },
      include: {
        character: { select: { id: true, name: true, nationality: true, imageUrl: true } },
        seasonDriverEntries: {
          where: { seasonId },
          select: { id: true, teamId: true, role: true, seat: true, number: true, status: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    return drivers.map((driver) => ({
      driver: {
        id: driver.id,
        number: driver.number,
        character: driver.character,
      },
      entry: driver.seasonDriverEntries[0] ?? null,
    }));
  },
};