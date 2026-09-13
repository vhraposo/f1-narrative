import type { Prisma, PrismaClient } from "@prisma/client";
import { OPENING_GRID_SOURCE } from "./opening-grid.source.js";

type Db = Prisma.TransactionClient | PrismaClient;

export type OpeningGridState = "RESOLVED" | "UNRESOLVED" | "CONFLICTED";

export interface OpeningGridHolder {
  externalId: string;
  name: string;
  number: number | null;
  seat: number | null;
  from: "external" | "universe";
}

export interface OpeningGridTeam {
  externalTeamId: string;
  universeTeamId: string | null;
  name: string;
  state: OpeningGridState;
  reasons: string[];
  warnings: string[];
  seats: { seat: number; holder: OpeningGridHolder | null }[];
  starters: OpeningGridHolder[];
  reserves: OpeningGridHolder[];
  participants: OpeningGridHolder[];
}

export interface OpeningGridResolution {
  source: string;
  claimsSource: string;
  year: number;
  state: OpeningGridState;
  teams: OpeningGridTeam[];
  resolvedTeams: number;
  unresolvedTeams: number;
  conflictedTeams: number;
  unresolvedParticipants: number;
}

export interface OpeningGridResolveInput {
  source: string;
  year: number;
  seasonId?: string;
  teamIds?: string[];
  claimsSource?: string;
}

export type SourceClaim = { kind: "RACE_SEAT" | "RESERVE"; seat: number | null };

export function parseSourceClaim(role: string | null): SourceClaim | null {
  const raw = (role ?? "").trim().toUpperCase();
  const seatMatch = /^RACE_SEAT(?::([12]))?$/.exec(raw);
  if (seatMatch) {
    return { kind: "RACE_SEAT", seat: seatMatch[1] ? Number(seatMatch[1]) : null };
  }
  if (raw === "RESERVE") return { kind: "RESERVE", seat: null };
  return null;
}

type ExtDriverSeason = {
  teamExternalId: string | null;
  role: string | null;
  number: number | null;
  externalDriver: { externalId: string; name: string; number: number | null };
};

type ExtTeam = { externalId: string; name: string };

type UniverseEntry = {
  teamId: string | null;
  role: string | null;
  seat: number | null;
  status: string;
  provenance: string;
  driverProfile: {
    character: { name: string };
  };
  externalBindings: Array<{
    externalDriverSeason: {
      externalDriver: { externalId: string; name: string; number: number | null };
    };
  }>;
};

type UniverseTeam = { id: string; name: string; externalId: string };

export async function resolveOpeningGrid(
  db: Db,
  input: OpeningGridResolveInput,
): Promise<OpeningGridResolution> {
  const claimsSource = input.claimsSource ?? OPENING_GRID_SOURCE;

  const externalSeasons = await db.externalDriverSeason.findMany({
    where: { source: input.source, seasonYear: input.year },
    include: { externalDriver: { select: { externalId: true, name: true, number: true } } },
  });

  const claimSeasons = await db.externalDriverSeason.findMany({
    where: { source: claimsSource, seasonYear: input.year },
    include: { externalDriver: { select: { externalId: true, name: true, number: true } } },
  });

  const claimsByExternalId = new Map<string, ExtDriverSeason>();
  for (const claim of claimSeasons) {
    claimsByExternalId.set(claim.externalDriver.externalId, claim);
  }
  const participantExternalIds = new Set(
    externalSeasons.map((season) => season.externalDriver.externalId),
  );

  const mergedByTeam = new Map<string, ExtDriverSeason[]>();
  for (const season of externalSeasons) {
    if (!season.teamExternalId) continue;
    const claim = claimsByExternalId.get(season.externalDriver.externalId);
    const effective: ExtDriverSeason = claim
      ? {
          teamExternalId: season.teamExternalId,
          role: claim.role,
          number: season.number ?? claim.number,
          externalDriver: season.externalDriver,
        }
      : season;
    const group = mergedByTeam.get(season.teamExternalId) ?? [];
    group.push(effective);
    mergedByTeam.set(season.teamExternalId, group);
  }

  const unmatchedByTeam = new Map<string, ExtDriverSeason[]>();
  for (const claim of claimSeasons) {
    if (participantExternalIds.has(claim.externalDriver.externalId)) continue;
    const teamKey = claim.teamExternalId ?? `claim:${claim.externalDriver.externalId}`;
    const group = unmatchedByTeam.get(teamKey) ?? [];
    group.push(claim);
    unmatchedByTeam.set(teamKey, group);
  }

  const extTeams = new Map<string, ExtTeam>();
  const extTeamUuids = new Map<string, string>();
  const teamExternalIds = [
    ...new Set([...mergedByTeam.keys(), ...unmatchedByTeam.keys()]),
  ];
  if (teamExternalIds.length > 0) {
    const participantTeams = await db.externalTeam.findMany({
      where: { source: input.source, externalId: { in: teamExternalIds } },
      select: { id: true, externalId: true, name: true },
    });
    const claimTeams = await db.externalTeam.findMany({
      where: { source: claimsSource, externalId: { in: teamExternalIds } },
      select: { id: true, externalId: true, name: true },
    });
    for (const team of [...participantTeams, ...claimTeams]) {
      if (!extTeams.has(team.externalId)) extTeams.set(team.externalId, team);
      if (!extTeamUuids.has(team.externalId)) extTeamUuids.set(team.externalId, team.id);
    }
  }

  const teamExternalIdsSet = new Set([...teamExternalIds]);

  let universeTeams: UniverseTeam[] = [];
  let universeEntries: UniverseEntry[] = [];

  if (input.seasonId) {
    const bindings = await db.externalBindingTeam.findMany({
      where: input.teamIds
        ? { teamId: { in: input.teamIds } }
        : { externalTeamId: { in: [...extTeamUuids.values()] } },
      select: {
        externalTeamId: true,
        teamId: true,
        team: { select: { name: true } },
        externalTeam: { select: { externalId: true } },
      },
    });
    universeTeams = bindings.map((binding) => ({
      id: binding.teamId,
      name: binding.team.name,
      externalId: binding.externalTeam.externalId,
    }));
    for (const team of universeTeams) teamExternalIdsSet.add(team.externalId);
    const universeTeamIds = universeTeams.map((team) => team.id);
    if (universeTeamIds.length > 0) {
      universeEntries = await db.seasonDriverEntry.findMany({
        where: { seasonId: input.seasonId, teamId: { in: universeTeamIds } },
        include: {
          driverProfile: {
            select: { character: { select: { name: true } } },
          },
          externalBindings: {
            select: {
              externalDriverSeason: {
                select: {
                  externalDriver: { select: { externalId: true, name: true, number: true } },
                },
              },
            },
          },
        },
      });
    }
  }

  const teams: OpeningGridTeam[] = [];
  for (const externalId of [...teamExternalIdsSet].sort()) {
    const team = resolveTeam(
      externalId,
      mergedByTeam.get(externalId) ?? [],
      unmatchedByTeam.get(externalId) ?? [],
      extTeams.get(externalId),
      universeTeams.find((candidate) => candidate.externalId === externalId),
      universeEntries.filter(
        (entry) =>
          universeTeams.find((candidate) => candidate.externalId === externalId)?.id === entry.teamId,
      ),
      input.source,
    );
    teams.push(team);
  }

  const resolvedTeams = teams.filter((team) => team.state === "RESOLVED").length;
  const unresolvedTeams = teams.filter((team) => team.state === "UNRESOLVED").length;
  const conflictedTeams = teams.filter((team) => team.state === "CONFLICTED").length;

  let state: OpeningGridState = "RESOLVED";
  if (conflictedTeams > 0) {
    state = "CONFLICTED";
  } else if (unresolvedTeams > 0) {
    state = "UNRESOLVED";
  }

  return {
    source: input.source,
    claimsSource,
    year: input.year,
    state,
    teams,
    resolvedTeams,
    unresolvedTeams,
    conflictedTeams,
    unresolvedParticipants: teams.reduce(
      (total, team) => total + team.participants.length,
      0,
    ),
  };
}

function dedupeHolders(holders: OpeningGridHolder[]): OpeningGridHolder[] {
  const map = new Map<string, OpeningGridHolder>();
  for (const holder of holders) {
    const key = holder.externalId || holder.name;
    const existing = map.get(key);
    if (!existing || (holder.from === "universe" && holder.seat !== null)) {
      map.set(key, holder);
    }
  }
  return [...map.values()];
}

function resolveTeam(
  externalTeamId: string,
  externalSeasons: ExtDriverSeason[],
  unmatched: ExtDriverSeason[],
  extTeam: ExtTeam | undefined,
  universeTeam: UniverseTeam | undefined,
  entries: UniverseEntry[],
  participantSource: string,
): OpeningGridTeam {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const seatHolders = new Map<number, OpeningGridHolder>();
  const externalStarters: OpeningGridHolder[] = [];
  const externalReserves: OpeningGridHolder[] = [];
  const externalParticipants: OpeningGridHolder[] = [];

  for (const season of externalSeasons) {
    const holder: OpeningGridHolder = {
      externalId: season.externalDriver.externalId,
      name: season.externalDriver.name,
      number: season.number ?? season.externalDriver.number ?? null,
      seat: null,
      from: "external",
    };
    const claim = parseSourceClaim(season.role);
    if (claim === null) {
      externalParticipants.push(holder);
    } else if (claim.kind === "RESERVE") {
      externalReserves.push(holder);
    } else {
      if (claim.seat !== null) {
        holder.seat = claim.seat;
        const previous = seatHolders.get(claim.seat);
        if (
          previous &&
          previous.externalId !== holder.externalId
        ) {
          reasons.push(
            `Assento ${claim.seat} reivindicado por ${previous.name} e ${holder.name} na fonte`,
          );
        }
        seatHolders.set(claim.seat, holder);
      }
      externalStarters.push(holder);
    }
  }

  const distinctExternalStarterIds = new Set(
    externalStarters.map((starter) => starter.externalId),
  ).size;
  for (const orphan of unmatched) {
    const claim = parseSourceClaim(orphan.role);
    const label = `${orphan.externalDriver.name} (${orphan.externalDriver.externalId})`;
    if (claim?.kind === "RESERVE") {
      warnings.push(
        `Reserva ${label} não corresponde a nenhum participante da fonte ${participantSource}`,
      );
    } else if (claim?.kind === "RACE_SEAT") {
      if (distinctExternalStarterIds >= 2) {
        reasons.push(
          `Claim de titular ${label} não corresponde a nenhum participante da fonte ${participantSource}`,
        );
      } else {
        warnings.push(
          `Claim de titular ${label} não corresponde a nenhum participante da fonte ${participantSource}`,
        );
      }
    }
  }
  const hasUnboundStarter =
    unmatched.some((orphan) => parseSourceClaim(orphan.role)?.kind === "RACE_SEAT") &&
    distinctExternalStarterIds < 2;

  const universeStarters: OpeningGridHolder[] = [];
  const universeReserves: OpeningGridHolder[] = [];
  const universeParticipants: OpeningGridHolder[] = [];
  const occupiedSeats = new Set<number>();
  for (const entry of entries) {
    const external = entry.externalBindings[0]?.externalDriverSeason.externalDriver;
    const holder: OpeningGridHolder = {
      externalId: external?.externalId ?? entry.driverProfile.character.name,
      name: external?.name ?? entry.driverProfile.character.name,
      number: external?.number ?? null,
      seat: entry.seat,
      from: "universe",
    };
    if (entry.status === "LEFT") continue;
    if (entry.role === "RESERVE") {
      universeReserves.push(holder);
    } else if (entry.role === "RACE_SEAT") {
      universeStarters.push(holder);
      if (entry.seat !== null && entry.status === "ACTIVE") occupiedSeats.add(entry.seat);
    } else if (entry.role === null) {
      universeParticipants.push(holder);
    }
  }

  const starters = dedupeHolders([...externalStarters, ...universeStarters]);
  const reserves = dedupeHolders([...externalReserves, ...universeReserves]);
  const participants = dedupeHolders([...externalParticipants, ...universeParticipants]);

  if (distinctExternalStarterIds > 2) {
    reasons.push("Mais pilotos com papel de titular do que assentos disponíveis");
  }

  let state: OpeningGridState;
  if (reasons.length > 0) {
    state = "CONFLICTED";
  } else if (distinctExternalStarterIds === 2 || (occupiedSeats.has(1) && occupiedSeats.has(2))) {
    state = "RESOLVED";
  } else if (participants.length > 0 || hasUnboundStarter) {
    state = "UNRESOLVED";
  } else {
    state = "RESOLVED";
  }

  const seats: OpeningGridTeam["seats"] = [1, 2].map((seat) => ({
    seat,
    holder: resolvedSeatHolder(seat, seatHolders, universeStarters, starters),
  }));

  return {
    externalTeamId,
    universeTeamId: universeTeam?.id ?? null,
    name: universeTeam?.name ?? extTeam?.name ?? externalTeamId,
    state,
    reasons,
    warnings,
    seats,
    starters,
    reserves,
    participants,
  };
}

function resolvedSeatHolder(
  seat: number,
  seatHolders: Map<number, OpeningGridHolder>,
  universeStarters: OpeningGridHolder[],
  allStarters: OpeningGridHolder[],
): OpeningGridHolder | null {
  const declared = seatHolders.get(seat);
  if (declared) return declared;
  const universeHolder = universeStarters.find(
    (holder) => holder.seat === seat && holder.from === "universe",
  );
  if (universeHolder) {
    const bound = allStarters.find(
      (holder) =>
        holder.from === "external" && holder.externalId === universeHolder.externalId,
    );
    return bound ?? universeHolder;
  }
  return null;
}