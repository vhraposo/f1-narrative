"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCharacter,
  deleteCharacter,
  getCharacter,
  listAiCharacters,
  listCharacters,
  updateCharacter,
  type Character,
  type CreateCharacterInput,
  type UpdateCharacterInput,
} from "@/lib/characters";

export const charactersKey = ["characters"] as const;

export const aiCharactersKey = ["characters", "ai"] as const;

function characterKey(id: string) {
  return ["characters", id] as const;
}

export function useCharacters() {
  return useQuery({
    queryKey: charactersKey,
    queryFn: listCharacters,
  });
}

export function useAiCharacters() {
  return useQuery({
    queryKey: aiCharactersKey,
    queryFn: listAiCharacters,
  });
}

export function useCharacter(id: string | undefined) {
  return useQuery({
    queryKey: characterKey(id ?? ""),
    queryFn: () => getCharacter(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateCharacter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCharacterInput) => createCharacter(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: charactersKey });
    },
  });
}

export function useUpdateCharacter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; input: UpdateCharacterInput }) =>
      updateCharacter(vars.id, vars.input),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: charactersKey });
      void queryClient.invalidateQueries({ queryKey: characterKey(vars.id) });
    },
  });
}

export function useDeleteCharacter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteCharacter(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: charactersKey });
      void queryClient.removeQueries({ queryKey: characterKey(id) });
    },
  });
}

export type { Character };
