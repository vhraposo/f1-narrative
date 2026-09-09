"use client";

import { useQuery } from "@tanstack/react-query";
import {
  listExternalCandidates,
  listExternalDriverSeasons,
  listExternalDrivers,
  listExternalRaces,
  listExternalResults,
  listExternalSeasons,
  listExternalStandings,
  listExternalTeams,
} from "@/lib/external-world";

export const externalSeasonsKey = ["external", "seasons"] as const;

export function externalYearKey(year: number) {
  return ["external", "seasons", String(year)] as const;
}

export function externalTeamsKey() {
  return ["external", "teams"] as const;
}

export function externalDriversKey() {
  return ["external", "drivers"] as const;
}

export function externalDriverSeasonsKey(year: number) {
  return [...externalYearKey(year), "driver-seasons"] as const;
}

export function externalRacesKey(year: number) {
  return [...externalYearKey(year), "races"] as const;
}

export function externalResultsKey(year: number) {
  return [...externalYearKey(year), "results"] as const;
}

export function externalStandingsKey(year: number) {
  return [...externalYearKey(year), "standings"] as const;
}

export function externalCandidatesKey(kind: string, externalId: string) {
  return ["external", "candidates", kind, externalId] as const;
}

export function useExternalSeasons() {
  return useQuery({
    queryKey: externalSeasonsKey,
    queryFn: listExternalSeasons,
  });
}

export function useExternalTeams() {
  return useQuery({
    queryKey: externalTeamsKey(),
    queryFn: listExternalTeams,
  });
}

export function useExternalDrivers() {
  return useQuery({
    queryKey: externalDriversKey(),
    queryFn: listExternalDrivers,
  });
}

export function useExternalDriverSeasons(year: number | null) {
  return useQuery({
    queryKey: externalDriverSeasonsKey(year ?? 0),
    queryFn: () => listExternalDriverSeasons(year as number),
    enabled: year != null,
  });
}

export function useExternalRaces(year: number | null) {
  return useQuery({
    queryKey: externalRacesKey(year ?? 0),
    queryFn: () => listExternalRaces(year as number),
    enabled: year != null,
  });
}

export function useExternalResults(year: number | null) {
  return useQuery({
    queryKey: externalResultsKey(year ?? 0),
    queryFn: () => listExternalResults(year as number),
    enabled: year != null,
  });
}

export function useExternalStandings(year: number | null) {
  return useQuery({
    queryKey: externalStandingsKey(year ?? 0),
    queryFn: () => listExternalStandings(year as number),
    enabled: year != null,
  });
}

export function useExternalCandidates(
  kind: string,
  externalId: string | null,
  seasonYear?: number,
) {
  return useQuery({
    queryKey: externalCandidatesKey(kind, externalId ?? ""),
    queryFn: () => listExternalCandidates(kind, externalId as string, seasonYear),
    enabled: externalId != null,
  });
}