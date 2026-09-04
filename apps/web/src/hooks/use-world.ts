"use client";

import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { getWorld, updateWorld, type UpdateWorldInput, type WorldState } from "@/lib/world";

export const worldKey = ["world"] as const;

export function useWorld() {
  return useQuery({
    queryKey: worldKey,
    queryFn: getWorld,
  });
}

export function useUpdateWorld() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateWorldInput) => updateWorld(input),
    onSuccess: (data: WorldState) => {
      queryClient.setQueryData(worldKey, data);
    },
  });
}

export type { WorldState };