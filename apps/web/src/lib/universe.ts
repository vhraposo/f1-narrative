import { get, post, remove } from "./api";

export const RECONCILIATION_SOURCE = "jolpica";

export type UniverseSeatStatus =
  | "MATCH"
  | "DIVERGENCE"
  | "SOURCE_ONLY"
  | "UNIVERSE_ONLY";
export type UniverseTeamStatus = "MATCH" | "DIVERGENT";

export type UniverseSourceSeat = {
  externalDriverId: string;
  name: string;
  number: number | null;
};

export type UniverseSeat = {
  seat: 1 | 2;
  status: UniverseSeatStatus;
  source: UniverseSourceSeat | null;
  universe: {
    entryId: string;
    driverProfileId: string;
    characterId: string;
    characterName: string;
    provenance: string;
  } | null;
  canRestore: boolean;
};

export type UniverseTeam = {
  id: string;
  name: string;
  shortName: string | null;
  color: string | null;
  externalTeamId: string;
  status: UniverseTeamStatus;
  seats: UniverseSeat[];
};

export type RosterComparison = {
  season: { id: string; year: number; name: string | null; status: string };
  comparable: boolean;
  teams: UniverseTeam[];
};

export type KeepUniverseResult = {
  team: UniverseTeam;
};

export type RestoreSourceResult = {
  team: UniverseTeam;
  restored: number;
};

export function getRosterComparison(seasonId: string): Promise<RosterComparison> {
  return get<RosterComparison>(
    `/api/universe/roster-comparison/${encodeURIComponent(seasonId)}`,
  );
}

export function keepUniverseConfig(input: {
  seasonId: string;
  teamId: string;
}): Promise<KeepUniverseResult> {
  return post<KeepUniverseResult>(
    `/api/universe/roster-comparison/${encodeURIComponent(input.seasonId)}/keep-universe`,
    { teamId: input.teamId },
  );
}

export function restoreSourceConfig(input: {
  seasonId: string;
  teamId: string;
}): Promise<RestoreSourceResult> {
  return post<RestoreSourceResult>(
    `/api/universe/roster-comparison/${encodeURIComponent(input.seasonId)}/restore-source`,
    { teamId: input.teamId },
  );
}

export type ReconciliationBinding = {
  id: string;
  confidence: "SUGGESTED" | "CONFIRMED";
  targetLabel: string | null;
};

export type ReconciliationCandidate = {
  id: string;
  label: string;
  score: number;
};

export type DriverReconciliationListing = {
  external: { kind: string; source: string; label: string };
  currentBinding: ReconciliationBinding | null;
  candidates: ReconciliationCandidate[];
};

export type ReconciliationWriteResult = {
  binding: {
    id: string;
    confidence: "SUGGESTED" | "CONFIRMED";
    boundBy: string | null;
  };
};

export type UnbindResult = {
  ok: boolean;
  kind: string;
  id: string;
};

export function getDriverReconciliation(
  externalDriverId: string,
): Promise<DriverReconciliationListing> {
  return get<{ listing: DriverReconciliationListing }>(
    `/api/reconciliation/candidates/DRIVER/${encodeURIComponent(externalDriverId)}?source=${RECONCILIATION_SOURCE}`,
  ).then((response) => response.listing);
}

export function confirmDriverBinding(
  externalDriverId: string,
): Promise<ReconciliationWriteResult> {
  return post<ReconciliationWriteResult>(
    "/api/reconciliation/bindings/confirm",
    {
      kind: "DRIVER",
      source: RECONCILIATION_SOURCE,
      externalId: externalDriverId,
    },
  );
}

export function suggestDriverBinding(
  externalDriverId: string,
  candidateId: string,
): Promise<ReconciliationWriteResult> {
  return post<ReconciliationWriteResult>(
    "/api/reconciliation/bindings/suggest",
    {
      kind: "DRIVER",
      source: RECONCILIATION_SOURCE,
      externalId: externalDriverId,
      candidateId,
    },
  );
}

export function unbindDriverBinding(bindingId: string): Promise<UnbindResult> {
  return remove<UnbindResult>(
    `/api/reconciliation/bindings/${encodeURIComponent(bindingId)}`,
  );
}