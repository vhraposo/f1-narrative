"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTeam,
  deleteTeam,
  listTeams,
  updateTeam,
  type CreateTeamInput,
  type Team,
  type UpdateTeamInput,
} from "@/lib/teams";

export const teamsKey = ["teams"] as const;

function teamKey(id: string) {
  return ["teams", id] as const;
}

export function useTeams() {
  return useQuery({
    queryKey: teamsKey,
    queryFn: listTeams,
  });
}

export function useCreateTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTeamInput) => createTeam(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: teamsKey });
    },
  });
}

export function useUpdateTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; input: UpdateTeamInput }) =>
      updateTeam(vars.id, vars.input),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: teamsKey });
      void queryClient.invalidateQueries({ queryKey: teamKey(vars.id) });
    },
  });
}

export function useDeleteTeam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTeam(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: teamsKey });
      void queryClient.removeQueries({ queryKey: teamKey(id) });
    },
  });
}

export type { Team };
