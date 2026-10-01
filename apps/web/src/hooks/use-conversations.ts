"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  addConversationParticipant,
  createConversation,
  createMessage,
  deleteConversation,
  generateMessage,
  getConversation,
  listConversationMessages,
  listConversationParticipants,
  listConversations,
  removeConversationParticipant,
  streamTurnMessage,
  turnMessage,
  updateConversation,
  type Conversation,
  type CreateConversationInput,
  type CreateMessageInput,
  type GenerateMessageInput,
  type Message,
  type TurnMessageInput,
  type TurnResponse,
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

export function useGenerateMessage(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GenerateMessageInput) =>
      generateMessage(conversationId, input),
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

export function useTurnMessage(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TurnMessageInput) => turnMessage(conversationId, input),
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

type StreamingTurnOptions = {
  onSuccess?: (data: TurnResponse) => void;
  onError?: (error: Error) => void;
};

export function useStreamingTurn(conversationId: string) {
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const pendingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const updateMessages = useCallback(
    (updater: (current: Message[]) => Message[]) => {
      queryClient.setQueryData<Message[]>(
        conversationMessagesKey(conversationId),
        (current) => updater(current ?? []),
      );
    },
    [conversationId, queryClient],
  );

  const run = useCallback(
    async (input: TurnMessageInput, options?: StreamingTurnOptions) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setIsPending(true);
      setError(null);

      const controller = new AbortController();
      abortRef.current = controller;
      const requestId = `stream-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const placeholderIds: string[] = [];
      let receivedDelta = false;

      const placeholderId = (characterId: string) =>
        `${requestId}:${characterId}`;
      const ensurePlaceholder = (characterId: string) => {
        const id = placeholderId(characterId);
        if (placeholderIds.includes(id)) return;
        placeholderIds.push(id);
        updateMessages((current) => [
          ...current,
          {
            id,
            conversationId,
            senderType: "AI_CHARACTER",
            characterId,
            content: "",
            createdAt: new Date().toISOString(),
          } as Message,
        ]);
      };
      const appendDelta = (characterId: string, delta: string) => {
        const id = placeholderId(characterId);
        updateMessages((current) =>
          current.map((message) =>
            message.id === id
              ? { ...message, content: message.content + delta }
              : message,
          ),
        );
      };
      const clearPlaceholders = () => {
        if (placeholderIds.length === 0) return;
        updateMessages((current) =>
          current.filter((message) => !placeholderIds.includes(message.id)),
        );
      };
      const syncResult = (result: TurnResponse) => {
        updateMessages((current) => {
          const byId = new Map(
            current
              .filter((message) => !placeholderIds.includes(message.id))
              .map((message) => [message.id, message]),
          );
          for (const message of [result.userMessage, ...result.messages]) {
            byId.set(message.id, message);
          }
          return [...byId.values()].sort((a, b) =>
            a.createdAt.localeCompare(b.createdAt),
          );
        });
        void queryClient.invalidateQueries({
          queryKey: conversationKey(conversationId),
        });
        void queryClient.invalidateQueries({ queryKey: conversationsKey });
      };

      try {
        const result = await streamTurnMessage(conversationId, input, {
          onEvent: (event) => {
            if (event.type === "generation.started") {
              for (const speaker of event.speakers) ensurePlaceholder(speaker);
            } else if (event.type === "generation.delta") {
              receivedDelta = true;
              appendDelta(event.characterId, event.delta);
            }
          },
          signal: controller.signal,
        });
        clearPlaceholders();
        syncResult(result);
        options?.onSuccess?.(result);
      } catch (streamFailure) {
        if (controller.signal.aborted) {
          clearPlaceholders();
          return;
        }
        if (!receivedDelta) {
          try {
            const result = await turnMessage(conversationId, input);
            clearPlaceholders();
            syncResult(result);
            options?.onSuccess?.(result);
            return;
          } catch (fallbackFailure) {
            clearPlaceholders();
            const normalized =
              fallbackFailure instanceof Error
                ? fallbackFailure
                : new Error("Falha ao gerar resposta");
            setError(normalized);
            options?.onError?.(normalized);
            return;
          }
        }
        clearPlaceholders();
        const normalized =
          streamFailure instanceof Error
            ? streamFailure
            : new Error("Falha ao gerar resposta");
        setError(normalized);
        options?.onError?.(normalized);
        void queryClient.invalidateQueries({
          queryKey: conversationMessagesKey(conversationId),
        });
      } finally {
        pendingRef.current = false;
        setIsPending(false);
        abortRef.current = null;
      }
    },
    [conversationId, queryClient, updateMessages],
  );

  const mutate = useCallback(
    (input: TurnMessageInput, options?: StreamingTurnOptions) => {
      void run(input, options);
    },
    [run],
  );

  const reset = useCallback(() => setError(null), []);

  return { isPending, error, mutate, reset };
}

export type { Conversation };