import { z } from "zod";

export const OPENING_GRID_SOURCE = "opening-grid";

export const openingGridEntryListDriverSchema = z.object({
  externalId: z.string().min(1),
  name: z.string().min(1),
  fullName: z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),
  number: z.number().int().nullable().optional(),
  seat: z.union([z.literal(1), z.literal(2), z.null()]).optional(),
  reserve: z.boolean().optional(),
});

export const openingGridEntryListTeamSchema = z.object({
  teamExternalId: z.string().min(1),
  name: z.string().min(1),
  shortName: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  drivers: z.array(openingGridEntryListDriverSchema).min(1),
});

export const openingGridEntryListSeasonSchema = z.object({
  year: z.number().int().min(1950).max(2100),
  teams: z.array(openingGridEntryListTeamSchema).min(1),
});

export type OpeningGridEntryListOutbound = z.infer<typeof openingGridEntryListSeasonSchema>;

export type OpeningGridConflictKind =
  | "DUPLICATE_SEAT"
  | "INVALID_SEAT"
  | "AMBIGUOUS_CLAIM"
  | "DUPLICATE_STARTER";

export interface OpeningGridConflict {
  kind: OpeningGridConflictKind;
  teamExternalId: string | null;
  externalId: string | null;
  message: string;
}

export function validateOpeningGridPayload(
  season: OpeningGridEntryListSeason,
): OpeningGridConflict[] {
  const conflicts: OpeningGridConflict[] = [];
  const startersByDriver = new Map<string, string>();

  for (const team of season.teams) {
    const seat2ExternalId = new Map<number, string>();
    const seen = new Set<string>();
    for (const driver of team.drivers) {
      if (seen.has(driver.externalId)) {
        conflicts.push({
          kind: "AMBIGUOUS_CLAIM",
          teamExternalId: team.teamExternalId,
          externalId: driver.externalId,
          message: `driver ${driver.externalId} declarado mais de uma vez na equipe ${team.teamExternalId}`,
        });
        continue;
      }
      seen.add(driver.externalId);

      if (driver.reserve === true && driver.seat != null) {
        conflicts.push({
          kind: "AMBIGUOUS_CLAIM",
          teamExternalId: team.teamExternalId,
          externalId: driver.externalId,
          message: `driver ${driver.externalId} marcado como reserva com seat declarado`,
        });
        continue;
      }

      if (driver.seat === 1 || driver.seat === 2) {
        if (seat2ExternalId.has(driver.seat)) {
          conflicts.push({
            kind: "DUPLICATE_SEAT",
            teamExternalId: team.teamExternalId,
            externalId: driver.externalId,
            message: `seat ${driver.seat} duplicado na equipe ${team.teamExternalId}`,
          });
        } else {
          seat2ExternalId.set(driver.seat, driver.externalId);
        }
        const prior = startersByDriver.get(driver.externalId);
        if (prior && prior !== team.teamExternalId) {
          conflicts.push({
            kind: "DUPLICATE_STARTER",
            teamExternalId: team.teamExternalId,
            externalId: driver.externalId,
            message: `driver ${driver.externalId} declarado como titular nas equipes ${prior} e ${team.teamExternalId}`,
          });
        } else {
          startersByDriver.set(driver.externalId, team.teamExternalId);
        }
      } else if (driver.seat != null) {
        conflicts.push({
          kind: "INVALID_SEAT",
          teamExternalId: team.teamExternalId,
          externalId: driver.externalId,
          message: `seat inválido ${driver.seat} na equipe ${team.teamExternalId}`,
        });
      }
    }
  }

  return conflicts;
}

export type OpeningGridClaimRole =
  | "RACE_SEAT"
  | "RACE_SEAT:1"
  | "RACE_SEAT:2"
  | "RESERVE";

export interface OpeningGridEntryListDriver {
  externalId: string;
  name: string;
  fullName?: string | null;
  nationality?: string | null;
  number?: number | null;
  seat?: 1 | 2 | null;
  reserve?: boolean;
}

export interface OpeningGridEntryListTeam {
  teamExternalId: string;
  name: string;
  shortName?: string | null;
  color?: string | null;
  drivers: OpeningGridEntryListDriver[];
}

export interface OpeningGridEntryListSeason {
  year: number;
  teams: OpeningGridEntryListTeam[];
}

export interface NormalizedOpeningGridClaim {
  seasonYear: number;
  driverExternalId: string;
  driverName: string;
  driverFullName: string | null;
  driverNationality: string | null;
  driverNumber: number | null;
  teamExternalId: string;
  teamName: string;
  teamShortName: string | null;
  teamColor: string | null;
  role: OpeningGridClaimRole;
  order: number;
}

export function normalizeOpeningGridClaims(
  season: OpeningGridEntryListSeason,
): NormalizedOpeningGridClaim[] {
  const claims: NormalizedOpeningGridClaim[] = [];
  for (const team of season.teams) {
    team.drivers.forEach((driver, index) => {
      claims.push({
        seasonYear: season.year,
        driverExternalId: driver.externalId,
        driverName: driver.name,
        driverFullName: driver.fullName ?? null,
        driverNationality: driver.nationality ?? null,
        driverNumber: driver.number ?? null,
        teamExternalId: team.teamExternalId,
        teamName: team.name,
        teamShortName: team.shortName ?? null,
        teamColor: team.color ?? null,
        role: claimRole(driver),
        order: index,
      });
    });
  }
  return claims;
}

function claimRole(driver: OpeningGridEntryListDriver): OpeningGridClaimRole {
  if (driver.reserve === true) return "RESERVE";
  if (driver.seat === 1) return "RACE_SEAT:1";
  if (driver.seat === 2) return "RACE_SEAT:2";
  return "RACE_SEAT";
}