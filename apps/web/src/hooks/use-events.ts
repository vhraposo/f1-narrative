"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addParticipant,
  createEvent,
  deleteEvent,
  getEvent,
  getEventNews,
  listEvents,
  listParticipants,
  removeParticipant,
  updateEvent,
  type CreateEventInput,
  type Event,
  type EventFilters,
  type UpdateEventInput,
} from "@/lib/events";

export const eventsKey = ["events"] as const;

export function eventKey(id: string) {
  return ["events", id] as const;
}

export function eventParticipantsKey(eventId: string) {
  return ["events", eventId, "participants"] as const;
}

export function eventNewsKey(eventId: string) {
  return ["events", eventId, "news"] as const;
}

export function useEvents(filters: EventFilters = {}) {
  return useQuery({
    queryKey: ["events", filters] as const,
    queryFn: () => listEvents(filters),
  });
}

export function useEvent(id: string | undefined) {
  return useQuery({
    queryKey: eventKey(id ?? ""),
    queryFn: () => getEvent(id as string),
    enabled: Boolean(id),
  });
}

export function useEventParticipants(eventId: string | undefined) {
  return useQuery({
    queryKey: eventParticipantsKey(eventId ?? ""),
    queryFn: () => listParticipants(eventId as string),
    enabled: Boolean(eventId),
  });
}

export function useEventNews(eventId: string | undefined) {
  return useQuery({
    queryKey: eventNewsKey(eventId ?? ""),
    queryFn: () => getEventNews(eventId as string),
    enabled: Boolean(eventId),
  });
}

export function useCreateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEventInput) => createEvent(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: eventsKey });
    },
  });
}

export function useUpdateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; input: UpdateEventInput }) =>
      updateEvent(vars.id, vars.input),
    onSuccess: (_data, vars) => {
      // Atualizar o Event regenera a notícia derivada na mesma transação.
      void queryClient.invalidateQueries({ queryKey: eventsKey });
      void queryClient.invalidateQueries({ queryKey: eventKey(vars.id) });
      void queryClient.invalidateQueries({
        queryKey: eventNewsKey(vars.id),
      });
    },
  });
}

export function useDeleteEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteEvent(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: eventsKey });
      void queryClient.removeQueries({ queryKey: eventKey(id) });
      void queryClient.removeQueries({
        queryKey: eventParticipantsKey(id),
      });
      void queryClient.removeQueries({ queryKey: eventNewsKey(id) });
    },
  });
}

export function useAddParticipant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { eventId: string; characterId: string }) =>
      addParticipant(vars.eventId, vars.characterId),
    onSuccess: (_data, vars) => {
      // Adicionar participante regenera a notícia: atualiza ambos.
      void queryClient.invalidateQueries({
        queryKey: eventParticipantsKey(vars.eventId),
      });
      void queryClient.invalidateQueries({
        queryKey: eventNewsKey(vars.eventId),
      });
    },
  });
}

export function useRemoveParticipant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { eventId: string; characterId: string }) =>
      removeParticipant(vars.eventId, vars.characterId),
    onSuccess: (_data, vars) => {
      // Remover participante regenera a notícia: atualiza ambos.
      void queryClient.invalidateQueries({
        queryKey: eventParticipantsKey(vars.eventId),
      });
      void queryClient.invalidateQueries({
        queryKey: eventNewsKey(vars.eventId),
      });
    },
  });
}

export type { Event };