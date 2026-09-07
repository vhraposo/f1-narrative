import { get, patch, post, remove } from "./api";

export type ConversationType = "GROUP" | "DM";

export type MessageSenderType = "USER_CHARACTER" | "AI_CHARACTER" | "SYSTEM";

// Participante de uma Conversation. controlledBy/userId vêm do backend para
// distinguir Characters USER (userId do usuário) de Characters AI (userId null).
export type ConversationParticipant = {
  id: string;
  name: string;
  nationality: string;
  imageUrl: string | null;
  controlledBy: "USER" | "AI";
  userId: string | null;
};

export type Conversation = {
  id: string;
  title: string | null;
  type: ConversationType;
  createdAt: string;
  updatedAt: string;
  participants: ConversationParticipant[];
  messageCount: number;
};

export type Message = {
  id: string;
  conversationId: string;
  senderType: MessageSenderType;
  characterId: string | null;
  content: string;
  createdAt: string;
};

export type CreateConversationInput = {
  title?: string | null;
  type?: ConversationType;
  participantIds: string[];
};

export type UpdateConversationInput = {
  title?: string | null;
  type?: ConversationType;
};

export type CreateMessageInput = {
  senderType: MessageSenderType;
  characterId?: string | null;
  content: string;
};

export const CONVERSATION_TYPE_LABELS: Record<ConversationType, string> = {
  GROUP: "Grupo",
  DM: "Direta",
};

export const CONVERSATION_TYPE_OPTIONS = Object.entries(
  CONVERSATION_TYPE_LABELS,
).map(([value, label]) => ({ value: value as ConversationType, label }));

export const SENDER_LABELS: Record<MessageSenderType, string> = {
  USER_CHARACTER: "Personagem",
  AI_CHARACTER: "IA",
  SYSTEM: "Sistema",
};

type ListResponse = { conversations: Conversation[] };
type ConversationResponse = { conversation: Conversation };
type ParticipantsResponse = { participants: ConversationParticipant[] };
type MessagesResponse = { messages: Message[] };
type ParticipantResponse = { participant: ConversationParticipant };

export function listConversations(): Promise<Conversation[]> {
  return get<ListResponse>("/api/conversations").then((r) => r.conversations);
}

export function getConversation(id: string): Promise<Conversation> {
  return get<ConversationResponse>(`/api/conversations/${id}`).then(
    (r) => r.conversation,
  );
}

export function createConversation(input: CreateConversationInput): Promise<Conversation> {
  return post<ConversationResponse>("/api/conversations", input).then(
    (r) => r.conversation,
  );
}

export function updateConversation(
  id: string,
  input: UpdateConversationInput,
): Promise<Conversation> {
  return patch<ConversationResponse>(`/api/conversations/${id}`, input).then(
    (r) => r.conversation,
  );
}

export function deleteConversation(id: string): Promise<void> {
  return remove<void>(`/api/conversations/${id}`);
}

export function listConversationParticipants(
  conversationId: string,
): Promise<ConversationParticipant[]> {
  return get<ParticipantsResponse>(
    `/api/conversations/${conversationId}/participants`,
  ).then((r) => r.participants);
}

export function addConversationParticipant(
  conversationId: string,
  characterId: string,
): Promise<ConversationParticipant> {
  return post<ParticipantResponse>(
    `/api/conversations/${conversationId}/participants`,
    { characterId },
  ).then((r) => r.participant);
}

export function removeConversationParticipant(
  conversationId: string,
  characterId: string,
): Promise<void> {
  return remove<void>(
    `/api/conversations/${conversationId}/participants/${characterId}`,
  );
}

export function listConversationMessages(
  conversationId: string,
): Promise<Message[]> {
  return get<MessagesResponse>(
    `/api/conversations/${conversationId}/messages`,
  ).then((r) => r.messages);
}

export function createMessage(
  conversationId: string,
  input: CreateMessageInput,
): Promise<Message> {
  return post<Message>(`/api/conversations/${conversationId}/messages`, input);
}

export type GenerateMessageInput = {
  userPrompt: string;
  targetCharacterId: string;
};

export type GeneratedMessageResponse = {
  message: Message;
  generationKey: string;
  provider: string;
  mode: string;
};

export type AssemblyOnlyResponse = {
  generation: {
    generationKey: string;
    provider: string;
    mode: string;
  };
  responseSkeleton: unknown;
};

export type GenerateResponse = GeneratedMessageResponse | AssemblyOnlyResponse;

export function generateMessage(
  conversationId: string,
  input: GenerateMessageInput,
): Promise<GenerateResponse> {
  return post<GenerateResponse>(
    `/api/conversations/${conversationId}/generate`,
    input,
  );
}

export const DEFAULT_GROUP_NAME = "Grupo dos Pilotos";

export function isDefaultGroupTitle(title: string | null): boolean {
  if (!title) return false;
  const normalized = title.replace(/\s+/g, " ").trim();
  return (
    normalized === DEFAULT_GROUP_NAME ||
    normalized.startsWith(`${DEFAULT_GROUP_NAME} ·`)
  );
}

export function isDefaultGroup(conversation: Conversation): boolean {
  return conversation.type === "GROUP" && isDefaultGroupTitle(conversation.title);
}

export function defaultGroupSeasonYear(title: string | null): number | null {
  if (!title) return null;
  const normalized = title.replace(/\s+/g, " ").trim();
  if (!normalized.startsWith(`${DEFAULT_GROUP_NAME} ·`)) return null;
  const segment = normalized.split("·")[1]?.trim();
  if (!segment) return null;
  const year = Number.parseInt(segment, 10);
  return Number.isFinite(year) ? year : null;
}

export function findDefaultGroup(
  conversations: Conversation[],
  currentSeasonYear?: number,
): Conversation | null {
  const groups = conversations.filter(isDefaultGroup);
  if (groups.length === 0) return null;
  if (currentSeasonYear != null) {
    const preferred = groups.find(
      (g) => defaultGroupSeasonYear(g.title) === currentSeasonYear,
    );
    if (preferred) return preferred;
  }
  return groups[0];
}

function startOfDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

function sameDay(a: Date, b: Date): boolean {
  return startOfDay(a) === startOfDay(b);
}

export function formatChatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (sameDay(date, now)) {
    return date.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  const daysDiff = Math.round(
    (startOfDay(now) - startOfDay(date)) / 86_400_000,
  );
  if (daysDiff === 1) return "Ontem";
  if (date.getFullYear() === now.getFullYear()) {
    const day = date.toLocaleDateString("pt-BR", { day: "2-digit" });
    const month = date
      .toLocaleDateString("pt-BR", { month: "short" })
      .replace(".", "")
      .toUpperCase();
    return `${day} ${month}`;
  }
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatListTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (sameDay(date, now)) {
    return date.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}