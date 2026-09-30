"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPersonaEvidence,
  deletePersonaTrait,
  getPersona,
  reviewPersonaEvidence,
  updatePersona,
  type CreatePersonaEvidenceInput,
  type ReviewPersonaEvidenceInput,
  type UpdatePersonaInput,
} from "@/lib/persona";

export const personaKey = (characterId: string) =>
  ["persona", characterId] as const;

function invalidatePersona(
  queryClient: ReturnType<typeof useQueryClient>,
  characterId: string,
) {
  void queryClient.invalidateQueries({ queryKey: personaKey(characterId) });
}

export function usePersona(characterId: string) {
  return useQuery({
    queryKey: personaKey(characterId),
    queryFn: () => getPersona(characterId),
    enabled: Boolean(characterId),
  });
}

export function useUpdatePersona(characterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePersonaInput) =>
      updatePersona(characterId, input),
    onSuccess: () => invalidatePersona(queryClient, characterId),
  });
}

export function useDeletePersonaTrait(characterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (traitKey: string) =>
      deletePersonaTrait(characterId, traitKey),
    onSuccess: () => invalidatePersona(queryClient, characterId),
  });
}

export function useCreatePersonaEvidence(characterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePersonaEvidenceInput) =>
      createPersonaEvidence(characterId, input),
    onSuccess: () => invalidatePersona(queryClient, characterId),
  });
}

export function useReviewPersonaEvidence(characterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { evidenceId: string; input: ReviewPersonaEvidenceInput }) =>
      reviewPersonaEvidence(vars.evidenceId, vars.input),
    onSuccess: () => invalidatePersona(queryClient, characterId),
  });
}
