import { describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import { JOLPICA_SOURCE } from "../external-sync/jolpica.service.js";
import { OPENING_GRID_SOURCE, normalizeOpeningGridClaims } from "./opening-grid.source.js";
import { persistOpeningGridClaims } from "./opening-grid.persist.js";
import { resolveOpeningGrid } from "./opening-grid.resolver.js";
import { playerEntryService } from "../player-entry/player-entry.service.js";
import type { UniverseInitializationInput } from "../universe-init/universe-init.schemas.js";
import { universeInitService, type Actor } from "../universe-init/universe-init.service.js";
import type { OpeningGridEntryListSeason } from "./opening-grid.source.js";

const RB2026_ENTRY_LIST: OpeningGridEntryListSeason = {
  year: 2026,
  teams: [
    {
      teamExternalId: "red-bull-f1",
      name: "Red Bull Racing",
      shortName: "RBR",
      color: "#3671c6",
      drivers: [
        { externalId: "VRB", name: "Velon Rein", number: 1, seat: 1 },
        { externalId: "YTS", name: "Yuki Tsukida", number: 22, seat: 2 },
        { externalId: "HIR", name: "Rio Hirano", number: 0, reserve: true },
      ],
    },
    {
      teamExternalId: "cadillac-f1",
      name: "Cadillac F1",
      shortName: "CAD",
      color: "#a51c30",
      drivers: [
        { externalId: "LAL", name: "Liam Aldo", number: 30, seat: 1 },
        { externalId: "IHA", name: "Isha Haman", number: 6, seat: 2 },
      ],
    },
    {
      teamExternalId: "audi-f1",
      name: "Audi F1",
      shortName: "AUD",
      color: "#d52b1e",
      drivers: [
        { externalId: "JDO", name: "Jose Port", number: 99, seat: 1 },
        { externalId: "AMK", name: "Niko Klar", number: 5, seat: 2 },
      ],
    },
  ],
};

const RB2026_CLAIMS = normalizeOpeningGridClaims(RB2026_ENTRY_LIST);

type ParticipantSeed = {
  externalId: string;
  name: string;
  number: number;
  role?: string | null;
  teamExternalId?: string;
};

type ClaimsSeed = {
  driverExternalId: string;
  role: string;
  teamExternalId?: string;
};

type ClaimsFixture = {
  userId: string;
  seasonId: string;
  extSeasonId: string;
  cleanup: () => Promise<void>;
};

async function seedSeason(
  year: number,
  teams: Array<{ externalId: string; name: string }>,
  participants: ParticipantSeed[],
  claims: ClaimsSeed[],
): Promise<ClaimsFixture> {
  const participantSource = JOLPICA_SOURCE;
  const participantIds = participants.map((participant) => participant.externalId);
  const teamExternalIds = teams.map((team) => team.externalId);

  await prisma.externalDriverSeason.deleteMany({
    where: { OR: [{ source: participantSource, seasonYear: year }, { source: OPENING_GRID_SOURCE, seasonYear: year }] },
  });
  await prisma.externalDriver.deleteMany({
    where: { OR: [{ source: participantSource, externalId: { in: participantIds } }, { source: OPENING_GRID_SOURCE, externalId: { in: participantIds } }] },
  });
  await prisma.externalTeam.deleteMany({
    where: { OR: [{ source: participantSource, externalId: { in: teamExternalIds } }, { source: OPENING_GRID_SOURCE, externalId: { in: teamExternalIds } }] },
  });
  await prisma.externalSeason.deleteMany({ where: { year } });

  const user = await prisma.user.create({
    data: {
      name: "Grid Claims Admin",
      email: `grid-claims-${Date.now()}-${Math.random()}@f1nw.test`,
      password: "x",
      role: "ADMIN",
    },
  });
  const season = await prisma.season.create({
    data: { year, name: String(year), status: "PRE_SEASON" },
  });
  const extSeason = await prisma.externalSeason.create({
    data: { source: participantSource, year, name: String(year), status: "ACTIVE", contentHash: "gc-ext-season" },
  });

  for (const team of teams) {
    await prisma.externalTeam.create({
      data: {
        source: participantSource,
        externalId: team.externalId,
        name: team.name,
        shortName: team.externalId,
        color: "#000000",
        contentHash: `gc-ext-team-${team.externalId}`,
      },
    });
  }

  for (const participant of participants) {
    const team = teams.find(
      (candidate) => candidate.externalId === (participant.teamExternalId ?? teams[0].externalId),
    ) ?? teams[0];
    const extDriver = await prisma.externalDriver.create({
      data: {
        source: participantSource,
        externalId: participant.externalId,
        name: participant.name,
        fullName: participant.name,
        nationality: "Unknown",
        number: participant.number,
        contentHash: `gc-ext-driver-${participant.externalId}`,
      },
    });
    await prisma.externalDriverSeason.create({
      data: {
        source: participantSource,
        externalDriverId: extDriver.id,
        seasonYear: year,
        teamExternalId: team.externalId,
        teamNameSnapshot: team.name,
        number: participant.number,
        role: participant.role ?? null,
        contentHash: `gc-ext-ds-${participant.externalId}`,
      },
    });
  }

  const normalizedClaims = claims
    .map((claim) => {
      const participant = participants.find((item) => item.externalId === claim.driverExternalId);
      const teamExternalId =
        claim.teamExternalId ?? participant?.teamExternalId ?? teams[0].externalId;
      const team = teams.find((candidate) => candidate.externalId === teamExternalId) ?? teams[0];
      return {
        seasonYear: year,
        driverExternalId: claim.driverExternalId,
        driverName: participant?.name ?? claim.driverExternalId,
        driverFullName: null,
        driverNationality: null,
        driverNumber: participant?.number ?? null,
        teamExternalId: team.externalId,
        teamName: team.name,
        teamShortName: team.externalId,
        teamColor: null,
        role: claim.role as "RACE_SEAT" | "RACE_SEAT:1" | "RACE_SEAT:2" | "RESERVE",
        order: 0,
      };
    })
    .sort((a, b) => a.driverExternalId.localeCompare(b.driverExternalId));;

  await prisma.$transaction((tx) => persistOpeningGridClaims(tx, normalizedClaims));

  const cleanup = async () => {
    await prisma.driverEntryEvent.deleteMany({ where: { entry: { seasonId: season.id } } });
    await prisma.seasonDriverEntry.deleteMany({ where: { seasonId: season.id } });
    await prisma.externalBindingSeason.deleteMany({ where: { seasonId: season.id } });
    await prisma.externalBindingTeam.deleteMany({ where: { team: { userId: user.id } } });
    await prisma.externalDriverSeason.deleteMany({
      where: { OR: [{ source: participantSource, seasonYear: year }, { source: OPENING_GRID_SOURCE, seasonYear: year }] },
    });
    await prisma.externalDriver.deleteMany({
      where: { OR: [{ source: participantSource, externalId: { in: participantIds } }, { source: OPENING_GRID_SOURCE, externalId: { in: participantIds } }] },
    });
    await prisma.externalTeam.deleteMany({
      where: { OR: [{ source: participantSource, externalId: { in: teamExternalIds } }, { source: OPENING_GRID_SOURCE, externalId: { in: teamExternalIds } }] },
    });
    await prisma.externalSeason.deleteMany({ where: { year } });
    await prisma.team.deleteMany({ where: { userId: user.id } });
    await prisma.character.deleteMany({ where: { userId: user.id } });
    await prisma.season.deleteMany({ where: { id: season.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  };

  return { userId: user.id, seasonId: season.id, extSeasonId: extSeason.id, cleanup };
}

function initInput(fixture: ClaimsFixture): UniverseInitializationInput {
  return {
    seasonId: fixture.seasonId,
    externalSeasonId: fixture.extSeasonId,
    scopes: ["DRIVER_GRID"],
  };
}

const RB_TEAM = [
  { externalId: "red-bull-f1", name: "Red Bull Racing" },
  { externalId: "cadillac-f1", name: "Cadillac F1" },
  { externalId: "audi-f1", name: "Audi F1" },
];

const RB_PARTICIPANTS: ParticipantSeed[] = [
  { externalId: "VRB", name: "Velon Rein", number: 1, teamExternalId: "red-bull-f1" },
  { externalId: "YTS", name: "Yuki Tsukida", number: 22, teamExternalId: "red-bull-f1" },
  { externalId: "HIR", name: "Rio Hirano", number: 0, teamExternalId: "red-bull-f1" },
  { externalId: "LAL", name: "Liam Aldo", number: 30, teamExternalId: "cadillac-f1" },
  { externalId: "IHA", name: "Isha Haman", number: 6, teamExternalId: "cadillac-f1" },
  { externalId: "JDO", name: "Jose Port", number: 99, teamExternalId: "audi-f1" },
  { externalId: "AMK", name: "Niko Klar", number: 5, teamExternalId: "audi-f1" },
];

describe("STEP 107.9 — Opening Grid External Source Resolution", () => {
  it("1) Adapter: payload da lista oficial vira claims por equipe (RB2026 com reserva multi-equipe)", () => {
    const claims = RB2026_CLAIMS;
    expect(claims).toHaveLength(7);
    expect(claims.filter((claim) => claim.role.startsWith("RACE_SEAT"))).toHaveLength(6);
    expect(claims.filter((claim) => claim.role === "RESERVE").map((claim) => claim.driverExternalId)).toEqual(["HIR"]);
    expect(claims.filter((claim) => claim.role === "RESERVE")).toHaveLength(1);
    expect(claims.some((claim) => claim.teamExternalId === "cadillac-f1" && claim.role === "RACE_SEAT:1")).toBe(true);
    expect(claims.every((claim) => claim.seasonYear === 2026)).toBe(true);
  });

  it("2) Normalizer: assento declarado (:1/:2) honrado; piloto sem assento/reserva vira RACE_SEAT genérico", () => {
    const claims = normalizeOpeningGridClaims({
      year: 2026,
      teams: [
        {
          teamExternalId: "t1",
          name: "Time Um",
          drivers: [
            { externalId: "A", name: "Alfa", seat: 1 },
            { externalId: "B", name: "Beta", seat: 2 },
            { externalId: "C", name: "Gama", reserve: true },
            { externalId: "D", name: "Delta" },
          ],
        },
      ],
    });
    expect(claims.map((claim) => claim.role)).toEqual(["RACE_SEAT:1", "RACE_SEAT:2", "RESERVE", "RACE_SEAT"]);
  });

  it("3) Persist: claims são gravados sob OPENING_GRID_SOURCE e persistência é idempotente (espelho Jolpica intacto)", async () => {
    const fixture = await seedSeason(2026, RB_TEAM, RB_PARTICIPANTS, RB2026_CLAIMS);
    try {
      const counts = await prisma.externalDriverSeason.count({
        where: { source: OPENING_GRID_SOURCE, seasonYear: 2026 },
      });
      expect(counts).toBe(7);

      const repeat = await prisma.$transaction((tx) =>
        persistOpeningGridClaims(tx, RB2026_CLAIMS),
      );
      expect(repeat.unchanged).toBeGreaterThan(0);
      expect(repeat.created).toBe(0);

      const participantCount = await prisma.externalDriverSeason.count({
        where: { source: JOLPICA_SOURCE, seasonYear: 2026 },
      });
      expect(participantCount).toBe(RB_PARTICIPANTS.length);
    } finally {
      await fixture.cleanup();
    }
  });

  it("4) Resolver: participants da Jolpica + claims → titulares por claim e grid RESOLVED", async () => {
    const fixture = await seedSeason(2026, RB_TEAM, RB_PARTICIPANTS, RB2026_CLAIMS);
    try {
      const grid = await resolveOpeningGrid(prisma, {
        source: JOLPICA_SOURCE,
        year: 2026,
        seasonId: fixture.seasonId,
      });
      expect(grid.state).toBe("RESOLVED");
      expect(grid.resolvedTeams).toBe(3);
      const team = grid.teams.find((item) => item.externalTeamId === "red-bull-f1");
      expect(team?.starters.map((holder) => holder.externalId).sort()).toEqual(["VRB", "YTS"]);
      expect(team?.reserves.map((holder) => holder.externalId)).toEqual(["HIR"]);
      expect(team?.seats[0]?.holder?.externalId).toBe("VRB");
      expect(team?.seats[1]?.holder?.externalId).toBe("YTS");
    } finally {
      await fixture.cleanup();
    }
  });

  it("5) Resolver: claim sem participante correspondente → UNRESOLVED; identidade nunca é confirmada por nome", async () => {
    const fixture = await seedSeason(
      2026,
      [{ externalId: "red-bull-f1", name: "Red Bull" }],
      [
        { externalId: "VRB", name: "Velon Rein", number: 1 },
        { externalId: "YTS", name: "Yuki Tsukida", number: 22 },
      ],
      [
        { driverExternalId: "VRB", role: "RACE_SEAT:1" },
        { driverExternalId: "OAB", role: "RACE_SEAT:2" },
      ],
    );
    try {
      const grid = await resolveOpeningGrid(prisma, {
        source: JOLPICA_SOURCE,
        year: 2026,
        seasonId: fixture.seasonId,
      });
      expect(grid.state).toBe("UNRESOLVED");
      const team = grid.teams[0];
      expect(team?.starters.map((holder) => holder.externalId)).toEqual(["VRB"]);
      expect(team?.state).toBe("UNRESOLVED");
      expect(team?.warnings.some((warning) => warning.includes("OAB"))).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it("6) Resolver: dois pilotos reivindicando o mesmo assento (claim vs participantes) → CONFLICTED", async () => {
    const fixture = await seedSeason(
      2026,
      [{ externalId: "red-bull-f1", name: "Red Bull" }],
      [
        { externalId: "VRB", name: "Velon Rein", number: 1, role: "RACE_SEAT:1" },
        { externalId: "YTS", name: "Yuki Tsukida", number: 22 },
      ],
      [
        { driverExternalId: "VRB", role: "RACE_SEAT:1" },
        { driverExternalId: "YTS", role: "RACE_SEAT:1" },
      ],
    );
    try {
      const grid = await resolveOpeningGrid(prisma, {
        source: JOLPICA_SOURCE,
        year: 2026,
        seasonId: fixture.seasonId,
      });
      expect(grid.state).toBe("CONFLICTED");
      expect(
        grid.teams[0]?.reasons.some(
          (reason) => reason.includes("Velon Rein") && reason.includes("Yuki Tsukida"),
        ),
      ).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it("7) Resolver: reservas correspondidas por externalId ficam no pool de reservas", async () => {
    const fixture = await seedSeason(
      2026,
      [{ externalId: "red-bull-f1", name: "Red Bull" }],
      [
        { externalId: "VRB", name: "Velon Rein", number: 1 },
        { externalId: "YTS", name: "Yuki Tsukida", number: 22 },
        { externalId: "HIR", name: "Rio Hirano", number: 0 },
      ],
      [
        { driverExternalId: "VRB", role: "RACE_SEAT:1" },
        { driverExternalId: "YTS", role: "RACE_SEAT:2" },
        { driverExternalId: "HIR", role: "RESERVE" },
      ],
    );
    try {
      const grid = await resolveOpeningGrid(prisma, {
        source: JOLPICA_SOURCE,
        year: 2026,
        seasonId: fixture.seasonId,
      });
      expect(grid.state).toBe("RESOLVED");
      expect(grid.teams[0]?.reserves.map((holder) => holder.externalId)).toEqual(["HIR"]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("8) Resolver: reserva órfã (fora dos participantes) não bloqueia o grid quando 2 titulares estão resolvidos", async () => {
    const fixture = await seedSeason(
      2026,
      [{ externalId: "red-bull-f1", name: "Red Bull" }],
      [
        { externalId: "VRB", name: "Velon Rein", number: 1 },
        { externalId: "YTS", name: "Yuki Tsukida", number: 22 },
      ],
      [
        { driverExternalId: "VRB", role: "RACE_SEAT:1" },
        { driverExternalId: "YTS", role: "RACE_SEAT:2" },
        { driverExternalId: "OPH", role: "RESERVE" },
      ],
    );
    try {
      const grid = await resolveOpeningGrid(prisma, {
        source: JOLPICA_SOURCE,
        year: 2026,
        seasonId: fixture.seasonId,
      });
      expect(grid.state).toBe("RESOLVED");
      expect(grid.teams[0]?.warnings.some((warning) => warning.includes("OPH"))).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it("9) Materialização: titulares/reservas vêm dos claims; equipes RB2026 RESOLVED; personagens só para participantes", async () => {
    const fixture = await seedSeason(2026, RB_TEAM, RB_PARTICIPANTS, RB2026_CLAIMS);
    const actor: Actor = { id: fixture.userId, role: "ADMIN" };
    try {
      const preview = await universeInitService.preview(actor, initInput(fixture));
      expect(preview.openingGrid.state).toBe("RESOLVED");
      expect(preview.openingGrid.resolvedTeams).toBe(3);
      expect(preview.conflicts).toEqual([]);

      await universeInitService.execute(actor, initInput(fixture));
      const entries = await prisma.seasonDriverEntry.findMany({
        where: { seasonId: fixture.seasonId },
        orderBy: { seat: "asc" },
      });
      const starters = entries.filter((entry) => entry.role === "RACE_SEAT");
      const reserves = entries.filter((entry) => entry.role === "RESERVE");
      expect(starters).toHaveLength(6);
      expect(reserves).toHaveLength(1);
      const rbTeam = await prisma.team.findFirstOrThrow({ where: { userId: fixture.userId, name: "Red Bull Racing" } });
      const rbEntries = await prisma.seasonDriverEntry.findMany({
        where: { teamId: rbTeam.id },
        include: { driverProfile: { include: { character: true } } },
        orderBy: { seat: "asc" },
      });
      expect(rbEntries.find((entry) => entry.seat === 1)?.driverProfile.character.name).toBe("Velon Rein");
      expect(rbEntries.find((entry) => entry.seat === 2)?.driverProfile.character.name).toBe("Yuki Tsukida");
    } finally {
      await fixture.cleanup();
    }
  });

  it("10) Materialização é agnóstica a ano: claims de 2025 resolvem sem qualquer regra de ano específico", async () => {
    const fixture2025 = await seedSeason(
      2025,
      [{ externalId: "victory-lgp", name: "Victory Latecomers" }],
      [
        { externalId: "P01", name: "Pato Um", number: 10 },
        { externalId: "P02", name: "Pato Dois", number: 20 },
      ],
      [
        { driverExternalId: "P01", role: "RACE_SEAT:1" },
        { driverExternalId: "P02", role: "RACE_SEAT:2" },
      ],
    );
    const actor: Actor = { id: fixture2025.userId, role: "ADMIN" };
    try {
      const grid = await resolveOpeningGrid(prisma, {
        source: JOLPICA_SOURCE,
        year: 2025,
        seasonId: fixture2025.seasonId,
      });
      expect(grid.state).toBe("RESOLVED");
      await universeInitService.execute(actor, initInput(fixture2025));
      const entries = await prisma.seasonDriverEntry.findMany({
        where: { seasonId: fixture2025.seasonId },
        orderBy: { seat: "asc" },
      });
      expect(entries.filter((entry) => entry.role === "RACE_SEAT")).toHaveLength(2);
    } finally {
      await fixture2025.cleanup();
    }
  });

  it("11) Materialização: assento de claim é honrado; participante sem claim segue sem papel nem assento", async () => {
    const fixture = await seedSeason(
      2026,
      [{ externalId: "red-bull-f1", name: "Red Bull" }],
      [
        { externalId: "VRB", name: "Velon Rein", number: 1 },
        { externalId: "YTS", name: "Yuki Tsukida", number: 22 },
        { externalId: "EXTRA", name: "Extra Sem Claim", number: 33 },
      ],
      [
        { driverExternalId: "YTS", role: "RACE_SEAT:1" },
        { driverExternalId: "VRB", role: "RACE_SEAT:2" },
      ],
    );
    const actor: Actor = { id: fixture.userId, role: "ADMIN" };
    try {
      await universeInitService.execute(actor, initInput(fixture));
      const entries = await prisma.seasonDriverEntry.findMany({
        where: { seasonId: fixture.seasonId },
        include: { driverProfile: { include: { character: true } } },
        orderBy: { seat: "asc" },
      });
      expect(entries.find((entry) => entry.seat === 1)?.driverProfile.character.name).toBe("Yuki Tsukida");
      expect(entries.find((entry) => entry.seat === 2)?.driverProfile.character.name).toBe("Velon Rein");
      const extra = entries.find((entry) => entry.seat === null);
      expect(extra?.driverProfile.character.name).toBe("Extra Sem Claim");
      expect(extra?.role).toBeNull();
    } finally {
      await fixture.cleanup();
    }
  });

  it("12) Materialização: claim sem participante NÃO cria personagem; execute ainda completa (sem conflito)", async () => {
    const fixture = await seedSeason(
      2026,
      [{ externalId: "red-bull-f1", name: "Red Bull" }],
      [
        { externalId: "VRB", name: "Velon Rein", number: 1 },
        { externalId: "YTS", name: "Yuki Tsukida", number: 22 },
      ],
      [
        { driverExternalId: "VRB", role: "RACE_SEAT:1" },
        { driverExternalId: "YTS", role: "RACE_SEAT:2" },
        { driverExternalId: "ORPHAN", role: "RACE_SEAT" },
      ],
    );
    const actor: Actor = { id: fixture.userId, role: "ADMIN" };
    try {
      const report = await universeInitService.execute(actor, initInput(fixture));
      expect(report.conflicts).toEqual([]);
      const orphanCharacter = await prisma.character.findFirst({
        where: { userId: fixture.userId, name: "ORPHAN" },
      });
      expect(orphanCharacter).toBeNull();
      const team = await prisma.team.findFirstOrThrow({ where: { userId: fixture.userId } });
      const grid = await resolveOpeningGrid(prisma, {
        source: JOLPICA_SOURCE,
        year: 2026,
        seasonId: fixture.seasonId,
        teamIds: [team.id],
      });
      const teamGrid = grid.teams[0];
      expect(teamGrid?.state).toBe("CONFLICTED");
      expect(teamGrid?.starters).toHaveLength(2);
      expect(teamGrid?.reasons.some((reason) => reason.includes("ORPHAN"))).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it("13) Player Entry: setup() expõe titulares vindos dos claims", async () => {
    const fixture = await seedSeason(2026, RB_TEAM, RB_PARTICIPANTS, RB2026_CLAIMS);
    const actor: Actor = { id: fixture.userId, role: "ADMIN" };
    try {
      await universeInitService.execute(actor, initInput(fixture));
      const selection = await playerEntryService.setup(fixture.userId, {
        seasonId: fixture.seasonId,
      });
      expect(selection?.selection?.openingGridState).toBe("RESOLVED");
      const teamSelection = selection?.selection?.teams.find(
        (candidate) => candidate.externalTeamId === "red-bull-f1",
      );
      expect(teamSelection?.openingGrid.starters.map((starter) => starter.name).sort()).toEqual([
        "Velon Rein",
        "Yuki Tsukida",
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("14) Player Entry: create() 201 quando o grid da equipe é resolvido por claims", async () => {
    const fixture = await seedSeason(2026, RB_TEAM, RB_PARTICIPANTS, RB2026_CLAIMS);
    const actor: Actor = { id: fixture.userId, role: "ADMIN" };
    try {
      await universeInitService.execute(actor, initInput(fixture));
      const team = await prisma.team.findFirstOrThrow({ where: { userId: fixture.userId, name: "Cadillac F1" } });
      const result = await playerEntryService.create(fixture.userId, {
        seasonId: fixture.seasonId,
        teamId: team.id,
        seat: 1,
        name: "Meu Piloto 1079",
        nationality: "Brasileira",
        gender: null,
        birthDate: new Date("2001-06-14"),
      });
      expect(result.entry.seat).toBe(1);
      expect(result.entry.role).toBe("RACE_SEAT");
    } finally {
      await fixture.cleanup();
    }
  });

  it("15) Player Entry: 409 OPENING_GRID_UNRESOLVED quando o claim de titular da equipe não tem participante", async () => {
    const fixture = await seedSeason(
      2026,
      [{ externalId: "red-bull-f1", name: "Red Bull" }],
      [
        { externalId: "VRB", name: "Velon Rein", number: 1 },
        { externalId: "YTS", name: "Yuki Tsukida", number: 22 },
      ],
      [
        { driverExternalId: "VRB", role: "RACE_SEAT:1" },
        { driverExternalId: "OAB", role: "RACE_SEAT:2" },
      ],
    );
    const actor: Actor = { id: fixture.userId, role: "ADMIN" };
    try {
      await universeInitService.execute(actor, initInput(fixture));
      const team = await prisma.team.findFirstOrThrow({ where: { userId: fixture.userId } });
      await expect(
        playerEntryService.create(fixture.userId, {
          seasonId: fixture.seasonId,
          teamId: team.id,
          seat: 1,
          name: "Bloqueado Claim",
          nationality: "Teste",
          gender: null,
          birthDate: new Date("1998-02-02"),
        }),
      ).rejects.toMatchObject({ code: "OPENING_GRID_UNRESOLVED", statusCode: 409 });
    } finally {
      await fixture.cleanup();
    }
  });

  it("16) Mirror: claims e resolução não tocam o espelho Jolpica; fila de grid materializada reflete os titulares (roster/chat)", async () => {
    const fixture = await seedSeason(2026, RB_TEAM, RB_PARTICIPANTS, RB2026_CLAIMS);
    const actor: Actor = { id: fixture.userId, role: "ADMIN" };
    try {
      const before = await prisma.externalDriverSeason.count({
        where: { source: JOLPICA_SOURCE, seasonYear: 2026 },
      });
      await resolveOpeningGrid(prisma, {
        source: JOLPICA_SOURCE,
        year: 2026,
        seasonId: fixture.seasonId,
      });
      await universeInitService.execute(actor, initInput(fixture));
      const after = await prisma.externalDriverSeason.count({
        where: { source: JOLPICA_SOURCE, seasonYear: 2026 },
      });
      expect(after).toBe(before);

      const claimsCount = await prisma.externalDriverSeason.count({
        where: { source: OPENING_GRID_SOURCE, seasonYear: 2026 },
      });
      expect(claimsCount).toBe(7);

      const rbTeam = await prisma.team.findFirstOrThrow({ where: { userId: fixture.userId, name: "Red Bull Racing" } });
      const roster = await prisma.seasonDriverEntry.findMany({
        where: { seasonId: fixture.seasonId, teamId: rbTeam.id },
        include: { driverProfile: { include: { character: true } } },
        orderBy: { seat: "asc" },
      });
      const seats = roster.map((entry) => ({ name: entry.driverProfile.character.name, seat: entry.seat, role: entry.role }));
      expect(seats).toEqual([
        { name: "Velon Rein", seat: 1, role: "RACE_SEAT" },
        { name: "Yuki Tsukida", seat: 2, role: "RACE_SEAT" },
        { name: "Rio Hirano", seat: null, role: "RESERVE" },
      ]);
    } finally {
      await fixture.cleanup();
    }
  });
});