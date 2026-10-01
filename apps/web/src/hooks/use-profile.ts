"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  deleteProfileAvatar,
  getProfile,
  updateProfile,
  uploadProfileAvatar,
  type UpdateProfileInput,
  type UserProfile,
} from "@/lib/profile";

export const profileKey = ["profile"] as const;

export function useProfile() {
  return useQuery<UserProfile>({
    queryKey: profileKey,
    queryFn: getProfile,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => updateProfile(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: profileKey });
    },
  });
}

export function useUploadAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadProfileAvatar(file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: profileKey });
    },
  });
}

export function useDeleteAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deleteProfileAvatar(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: profileKey });
    },
  });
}
