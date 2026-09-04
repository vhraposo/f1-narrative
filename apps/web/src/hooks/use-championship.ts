"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createResult,
  createSeason,
  createStanding,
  createRace,
  deleteResult,
  deleteSeason,
  deleteStanding,
  deleteRace,
  listResults,
  listSeasons,
  listStandings,
  listRaces,
  updateResult,
  updateSeason,
  updateStanding,
  updateRace,
  type ChampionshipStanding,
  type CreateRaceInput,
  type CreateRaceResultInput,
  type CreateSeasonInput,
  type CreateStandingInput,
  type Race,
  type RaceResult,
  type Season,
  type UpdateRaceInput,
  type UpdateRaceResultInput,
  type UpdateSeasonInput,
  type UpdateStandingInput,
} from "@/lib/championship";

export const seasonsKey = ["seasons"] as const;

export function seasonKey(id: string) {
  return ["seasons", id] as const;
}

export function racesKey(seasonId: string) {
  return ["seasons", seasonId, "races"] as const;
}

export function raceKey(id: string) {
  return ["races", id] as const;
}

export function resultsKey(raceId: string) {
  return ["races", raceId, "results"] as const;
}

export function standingsKey(seasonId: string) {
  return ["seasons", seasonId, "standings"] as const;
}

export function useSeasons() {
  return useQuery({
    queryKey: seasonsKey,
    queryFn: listSeasons,
  });
}

export function useCreateSeason() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSeasonInput) => createSeason(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: seasonsKey });
    },
  });
}

export function useUpdateSeason() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; input: UpdateSeasonInput }) =>
      updateSeason(vars.id, vars.input),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({
        queryKey: seasonsKey,
      });
      void queryClient.invalidateQueries({ queryKey: seasonKey(vars.id) });
    },
  });
}

export function useDeleteSeason() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSeason(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: seasonsKey });
      void queryClient.removeQueries({ queryKey: seasonKey(id) });
    },
  });
}

export function useRaces(seasonId: string) {
  return useQuery({
    queryKey: racesKey(seasonId),
    queryFn: () => listRaces(seasonId),
    enabled: !!seasonId,
  });
}

export function useCreateRace(seasonId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRaceInput) => createRace(seasonId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: racesKey(seasonId) });
    },
  });
}

export function useUpdateRace(seasonId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; input: UpdateRaceInput }) =>
      updateRace(vars.id, vars.input),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: racesKey(seasonId) });
      void queryClient.invalidateQueries({ queryKey: raceKey(vars.id) });
    },
  });
}

export function useDeleteRace(seasonId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteRace(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: racesKey(seasonId) });
      void queryClient.removeQueries({ queryKey: raceKey(id) });
    },
  });
}

export function useResults(raceId: string) {
  return useQuery({
    queryKey: resultsKey(raceId),
    queryFn: () => listResults(raceId),
    enabled: !!raceId,
  });
}

export function useCreateResult(raceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRaceResultInput) => createResult(raceId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resultsKey(raceId) });
    },
  });
}

export function useUpdateResult(raceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; input: UpdateRaceResultInput }) =>
      updateResult(vars.id, vars.input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resultsKey(raceId) });
    },
  });
}

export function useDeleteResult(raceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteResult(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resultsKey(raceId) });
    },
  });
}

export function useStandings(seasonId: string) {
  return useQuery({
    queryKey: standingsKey(seasonId),
    queryFn: () => listStandings(seasonId),
    enabled: !!seasonId,
  });
}

export function useCreateStanding(seasonId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStandingInput) => createStanding(seasonId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: standingsKey(seasonId) });
    },
  });
}

export function useUpdateStanding(seasonId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; input: UpdateStandingInput }) =>
      updateStanding(vars.id, vars.input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: standingsKey(seasonId),
      });
    },
  });
}

export function useDeleteStanding(seasonId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteStanding(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: standingsKey(seasonId) });
    },
  });
}

export type {
  ChampionshipStanding,
  Race,
  RaceResult,
  Season,
};
