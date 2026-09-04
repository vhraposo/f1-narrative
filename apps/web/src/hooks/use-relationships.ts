"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createRelationship,
  deleteRelationship,
  getRelationship,
  listRelationships,
  updateRelationship,
  type CreateRelationshipInput,
  type Relationship,
  type UpdateRelationshipInput,
} from "@/lib/relationships";

export const relationshipsKey = ["relationships"] as const;

function relationshipKey(id: string) {
  return ["relationships", id] as const;
}

export function useRelationships() {
  return useQuery({
    queryKey: relationshipsKey,
    queryFn: listRelationships,
  });
}

export function useRelationship(id: string) {
  return useQuery({
    queryKey: relationshipKey(id),
    queryFn: () => getRelationship(id),
  });
}

export function useCreateRelationship() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRelationshipInput) => createRelationship(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: relationshipsKey });
    },
  });
}

export function useUpdateRelationship() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; input: UpdateRelationshipInput }) =>
      updateRelationship(vars.id, vars.input),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: relationshipsKey });
      void queryClient.invalidateQueries({ queryKey: relationshipKey(vars.id) });
    },
  });
}

export function useDeleteRelationship() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteRelationship(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: relationshipsKey });
      void queryClient.removeQueries({ queryKey: relationshipKey(id) });
    },
  });
}

export type { Relationship };
