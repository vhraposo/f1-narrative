"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addConversationParticipant,
  createConversation,
  createMessage,
  deleteConversation,
  getConversation,
  listConversationMessages,
  listConversationParticipants,
  listConversations,
  removeConversationParticipant,
  updateConversation,
  type Conversation,
  type CreateConversationInput,
  type CreateMessageInput,
  type UpdateConversationInput,
} from "@/lib/conversations";

export const conversationsKey = ["conversations"] as const;

export function conversationKey(id: string) {
  return ["conversations", id] as const;
}

export function conversationParticipantsKey(id: string) {
  return ["conversations", id, "participants"] as const;
}

export function conversationMessagesKey(id: string) {
  return ["conversations", id, "messages"] as const;
}

export function useConversations() {
  return useQuery({
    queryKey: conversationsKey,
    queryFn: listConversations,
  });
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: conversationKey(id ?? ""),
    queryFn: () => getConversation(id as string),
    enabled: Boolean(id),
  });
}

export function useConversationParticipants(id: string | undefined) {
  return useQuery({
    queryKey: conversationParticipantsKey(id ?? ""),
    queryFn: () => listConversationParticipants(id as string),
    enabled: Boolean(id),
  });
}

export function useConversationMessages(id: string | undefined) {
  return useQuery({
    queryKey: conversationMessagesKey(id ?? ""),
    queryFn: () => listConversationMessages(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateConversationInput) => createConversation(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: conversationsKey });
    },
  });
}

export function useUpdateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; input: UpdateConversationInput }) =>
      updateConversation(vars.id, vars.input),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: conversationsKey });
      void queryClient.invalidateQueries({ queryKey: conversationKey(vars.id) });
    },
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteConversation(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: conversationsKey });
      void queryClient.removeQueries({ queryKey: conversationKey(id) });
      void queryClient.removeQueries({
        queryKey: conversationParticipantsKey(id),
      });
      void queryClient.removeQueries({ queryKey: conversationMessagesKey(id) });
    },
  });
}

export function useAddConversationParticipant(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (characterId: string) =>
      addConversationParticipant(conversationId, characterId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: conversationKey(conversationId) });
      void queryClient.invalidateQueries({
        queryKey: conversationParticipantsKey(conversationId),
      });
    },
  });
}

export function useRemoveConversationParticipant(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (characterId: string) =>
      removeConversationParticipant(conversationId, characterId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: conversationKey(conversationId) });
      void queryClient.invalidateQueries({
        queryKey: conversationParticipantsKey(conversationId),
      });
    },
  });
}

export function useCreateMessage(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMessageInput) => createMessage(conversationId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: conversationMessagesKey(conversationId),
      });
      void queryClient.invalidateQueries({
        queryKey: conversationKey(conversationId),
      });
      void queryClient.invalidateQueries({ queryKey: conversationsKey });
    },
  });
}

export type { Conversation };