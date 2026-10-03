import { z } from "zod";

import { ApiError, API_BASE, get, patch, post, remove } from "./api";

export type ConversationType = "GROUP" | "DM";

export type ConversationVisibility = "PRIVATE" | "UNIVERSE";

export type MessageSenderType = "USER_CHARACTER" | "AI_CHARACTER" | "SYSTEM";

export type MessageDialogueContext = {
  intent?: string;
  replyToMessageId?: string | null;
  fragmentIndex?: number;
  topicTag?: string | null;
};

export type MessageContextJson = {
  family: string;
  generationKey: string;
  provider: string;
  ruleApplied: string;
  conversationType: ConversationType;
  assembledAt: string;
  activeSpeaker: { characterId: string | null; senderType: MessageSenderType };
  participantCharacterIds: string[];
  dialogue?: MessageDialogueContext;
  temporal: {
    worldDate: string | null;
    currentSeasonId: string | null;
    currentRaceId: string | null;
    currentSession: string | null;
    phaseMarker: string | null;
  };
  fidelity: {
    messages: number;
    memories: number;
    events: number;
    relationships: number;
    news: number;
    omitted: {
      oldestMessagesTruncated: number;
      memoriesOmitted: number;
      reasons: string[];
    };
  };
  stats: { systemPromptChars: number; contextBlocks: number };
  rag: {
    used: boolean;
    provider: string | null;
    model: string | null;
    dimensions: number | null;
    ruleApplied: string | null;
    items: number;
  };
};

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
  visibility?: ConversationVisibility;
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
  contextJson?: MessageContextJson | null;
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
  return post<{ message: Message }>(
    `/api/conversations/${conversationId}/messages`,
    input,
  ).then((r) => r.message);
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

export type TurnMessageInput = {
  userPrompt: string;
  ragFrameId?: string;
};

export type TurnFailedSpeaker = {
  characterId: string;
  error: string;
};

export type TurnResponse = {
  userMessage: Message;
  messages: Message[];
  failedSpeakers: TurnFailedSpeaker[];
};

export function turnMessage(
  conversationId: string,
  input: TurnMessageInput,
): Promise<TurnResponse> {
  return post<TurnResponse>(
    `/api/conversations/${conversationId}/turn`,
    input,
  );
}

export const GENERATION_STREAM_EVENTS = [
  "generation.started",
  "generation.delta",
  "generation.completed",
  "generation.error",
] as const;

export type GenerationStreamEventName = (typeof GENERATION_STREAM_EVENTS)[number];

export type GenerationStreamEvent =
  | {
      type: "generation.started";
      requestId: string;
      conversationId: string;
      speakers: string[];
    }
  | {
      type: "generation.delta";
      requestId: string;
      characterId: string;
      delta: string;
    }
  | {
      type: "generation.completed";
      requestId: string;
      userMessage: Message;
      messages: Message[];
      failedSpeakers: TurnFailedSpeaker[];
    }
  | {
      type: "generation.error";
      requestId: string;
      code: string;
      message: string;
    };

export class GenerationStreamError extends Error {
  constructor(
    message: string,
    public readonly code: string = "STREAM_FAILED",
  ) {
    super(message);
    this.name = "GenerationStreamError";
  }
}

const messageStreamSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  senderType: z.enum(["USER_CHARACTER", "AI_CHARACTER", "SYSTEM"]),
  characterId: z.string().nullable(),
  content: z.string(),
  contextJson: z.unknown().nullable().optional(),
  createdAt: z.string(),
});

const streamEventSchemas = {
  "generation.started": z.object({
    requestId: z.string(),
    conversationId: z.string(),
    speakers: z.array(z.string()),
  }),
  "generation.delta": z.object({
    requestId: z.string(),
    characterId: z.string(),
    delta: z.string(),
  }),
  "generation.completed": z.object({
    requestId: z.string(),
    userMessage: messageStreamSchema,
    messages: z.array(messageStreamSchema),
    failedSpeakers: z.array(
      z.object({ characterId: z.string(), error: z.string() }),
    ),
  }),
  "generation.error": z.object({
    requestId: z.string(),
    code: z.string(),
    message: z.string(),
  }),
} as const;

type ParsedSseFrame = { event: string; data: unknown };

function parseSseFrame(frame: string): ParsedSseFrame | null {
  let event = "";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!event || dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

function toGenerationStreamEvent(frame: ParsedSseFrame): GenerationStreamEvent | null {
  if (!(frame.event in streamEventSchemas)) return null;
  const name = frame.event as GenerationStreamEventName;
  const schema = streamEventSchemas[name];
  const parsed = schema.safeParse(frame.data);
  if (!parsed.success) {
    if (name === "generation.started") return null;
    if (name === "generation.delta") return null;
    return null;
  }
  return { type: name, ...(parsed.data as object) } as GenerationStreamEvent;
}

export async function streamTurnMessage(
  conversationId: string,
  input: TurnMessageInput,
  handlers: {
    onEvent?: (event: GenerationStreamEvent) => void;
    signal?: AbortSignal;
  } = {},
): Promise<TurnResponse> {
  const res = await fetch(
    `${API_BASE}/api/conversations/${conversationId}/turn/stream`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(input),
      signal: handlers.signal,
    },
  );

  if (!res.ok) {
    let message = "Falha ao iniciar o streaming da resposta.";
    let code: string | undefined;
    try {
      const data = (await res.json()) as { error?: unknown; code?: unknown };
      if (typeof data?.error === "string") message = data.error;
      if (typeof data?.code === "string") code = data.code;
    } catch {
      // corpo não-JSON: mantém mensagem padrão
    }
    throw new ApiError(message, res.status, code);
  }
  if (!res.body) {
    throw new GenerationStreamError("Resposta de streaming sem corpo.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: TurnResponse | null = null;
  let streamError: { code: string; message: string } | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const parsed = parseSseFrame(frame);
      if (!parsed) continue;
      const event = toGenerationStreamEvent(parsed);
      if (!event) {
        throw new GenerationStreamError("Evento de streaming inválido.", "MALFORMED_EVENT");
      }
      handlers.onEvent?.(event);
      if (event.type === "generation.completed") {
        completed = {
          userMessage: event.userMessage as Message,
          messages: event.messages as Message[],
          failedSpeakers: event.failedSpeakers,
        };
      } else if (event.type === "generation.error") {
        streamError = { code: event.code, message: event.message };
      }
    }
  }

  if (streamError) {
    throw new GenerationStreamError(streamError.message, streamError.code);
  }
  if (!completed) {
    throw new GenerationStreamError("Streaming terminou sem resultado final.");
  }
  return completed;
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

export function formatChatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (sameDay(date, now)) return "Hoje";
  const daysDiff = Math.round(
    (startOfDay(now) - startOfDay(date)) / 86_400_000,
  );
  if (daysDiff === 1) return "Ontem";
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

export function messageReplyToId(message: Message): string | null {
  const context = message.contextJson;
  if (!context || typeof context !== "object") return null;
  const dialogue = context.dialogue;
  if (!dialogue || typeof dialogue !== "object") return null;
  const replyTo = dialogue.replyToMessageId;
  return typeof replyTo === "string" && replyTo.length > 0 ? replyTo : null;
}
export type AutonomousTurnInput = {
  worldDate?: string;
};

export type AutonomousTurnResponse = {
  turn:
    | {
        executed: false;
        reasonCode: string;
        plan: unknown;
        decisionId: string | null;
      }
    | {
        executed: true;
        reasonCode: "EXECUTED";
        plan: unknown;
        decisionId: string;
        messageId: string;
        speakerCharacterId: string;
        language: { provider: string; model: string; fallback: boolean };
      };
};

export function runAutonomousTurn(
  conversationId: string,
  input: AutonomousTurnInput = {},
): Promise<AutonomousTurnResponse> {
  return post<AutonomousTurnResponse>(
    `/api/conversations/${conversationId}/autonomous-turn`,
    input,
  );
}
export type SimulationStep = {
  depth: number;
  characterId: string;
  name: string;
  messageId: string;
  language: { provider: string; model: string; fallback: boolean };
};

export type SimulationResponse = {
  simulation: {
    executed: boolean;
    stopReason: string;
    depth: number;
    steps: SimulationStep[];
    selection: unknown[];
  };
};

export function simulateConversationTurn(
  conversationId: string,
  input: AutonomousTurnInput = {},
): Promise<SimulationResponse> {
  return post<SimulationResponse>(
    `/api/conversations/${conversationId}/simulate-turn`,
    input,
  );
}
export type SimulationPlanResponse = {
  plan: {
    energy: { energy: number; intensity: number; level: string; reasons: string[] };
    window: { maxInitialResponders: number; maxReactions: number; maxChainDepth: number };
    planned: Array<{
      characterId: string;
      name: string;
      score: number;
      opportunity: number;
      reasons: string[];
    }>;
    stopReason: string;
  };
};

export function planSimulationTurn(
  conversationId: string,
  input: AutonomousTurnInput = {},
): Promise<SimulationPlanResponse> {
  return post<SimulationPlanResponse>(
    `/api/conversations/${conversationId}/simulate-turn/plan`,
    input,
  );
}
