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