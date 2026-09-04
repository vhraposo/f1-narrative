import { get, patch, post, remove } from "./api";

export type EventType =
  | "RACE"
  | "RACE_INCIDENT"
  | "RELATIONSHIP"
  | "SOCIAL"
  | "PERSONAL"
  | "NEWS"
  | "WORLD";

export type EventImportance = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type EventSource =
  | "CANON"
  | "USER_DEFINED"
  | "GENERATED_EVENT"
  | "EXTERNAL_INFORMATION";

export type Event = {
  id: string;
  type: EventType;
  importance: EventImportance;
  source: EventSource;
  title: string;
  description: string | null;
  worldDate: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type EventParticipant = {
  id: string;
  name: string;
  nationality: string;
  imageUrl: string | null;
};

// NewsItem derivada: somente leitura. NÃO é editável/criável/excluível na UI.
export type NewsItem = {
  id: string;
  eventId: string;
  title: string;
  body: string;
  source: EventSource;
  worldDate: string | null;
  createdAt: string;
};

export type CreateEventInput = {
  type: Event["type"];
  title: string;
  description?: string | null;
  importance?: EventImportance;
  source?: EventSource;
  worldDate?: string | null;
};

export type UpdateEventInput = Partial<CreateEventInput>;

export type EventFilters = {
  type?: EventType;
  importance?: EventImportance;
};

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  RACE: "Corrida",
  RACE_INCIDENT: "Incidente de corrida",
  RELATIONSHIP: "Relacionamento",
  SOCIAL: "Social",
  PERSONAL: "Pessoal",
  NEWS: "Notícia",
  WORLD: "Mundo",
};

export const EVENT_TYPE_OPTIONS = Object.entries(EVENT_TYPE_LABELS).map(
  ([value, label]) => ({ value: value as EventType, label }),
);

export const EVENT_IMPORTANCE_LABELS: Record<EventImportance, string> = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
  CRITICAL: "Crítica",
};

export const EVENT_IMPORTANCE_OPTIONS = Object.entries(
  EVENT_IMPORTANCE_LABELS,
).map(([value, label]) => ({ value: value as EventImportance, label }));

export const EVENT_SOURCE_LABELS: Record<EventSource, string> = {
  CANON: "Cânone",
  USER_DEFINED: "Definido pelo usuário",
  GENERATED_EVENT: "Evento gerado",
  EXTERNAL_INFORMATION: "Informação externa",
};

export const EVENT_SOURCE_OPTIONS = Object.entries(EVENT_SOURCE_LABELS).map(
  ([value, label]) => ({ value: value as EventSource, label }),
);

type EventsResponse = { events: Event[] };
type EventResponse = { event: Event };
type ParticipantsResponse = { participants: { character: EventParticipant }[] };
type ParticipantResponse = { participant: { character: EventParticipant } };
type NewsResponse = { news: NewsItem };

export function listEvents(filters: EventFilters = {}): Promise<Event[]> {
  const params = new URLSearchParams();
  if (filters.type) params.set("type", filters.type);
  if (filters.importance) params.set("importance", filters.importance);
  const query = params.toString();
  return get<EventsResponse>(`/api/events${query ? `?${query}` : ""}`).then(
    (r) => r.events,
  );
}

export function getEvent(id: string): Promise<Event> {
  return get<EventResponse>(`/api/events/${id}`).then((r) => r.event);
}

export function createEvent(input: CreateEventInput): Promise<Event> {
  return post<EventResponse>("/api/events", input).then((r) => r.event);
}

export function updateEvent(
  id: string,
  input: UpdateEventInput,
): Promise<Event> {
  return patch<EventResponse>(`/api/events/${id}`, input).then((r) => r.event);
}

export function deleteEvent(id: string): Promise<void> {
  return remove<void>(`/api/events/${id}`);
}

export function listParticipants(eventId: string): Promise<EventParticipant[]> {
  return get<ParticipantsResponse>(
    `/api/events/${eventId}/participants`,
  ).then((r) => r.participants.map((p) => p.character));
}

export function addParticipant(
  eventId: string,
  characterId: string,
): Promise<EventParticipant> {
  return post<ParticipantResponse>(
    `/api/events/${eventId}/participants`,
    { characterId },
  ).then((r) => r.participant.character);
}

export function removeParticipant(
  eventId: string,
  characterId: string,
): Promise<void> {
  return remove<void>(`/api/events/${eventId}/participants/${characterId}`);
}

export function getEventNews(eventId: string): Promise<NewsItem> {
  return get<NewsResponse>(`/api/events/${eventId}/news`).then((r) => r.news);
}