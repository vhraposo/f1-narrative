"use client";

import { ArrowDown, Loader2, MessagesSquare } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import { MessageBubble, type MessageReplyPreview } from "@/components/conversations/message-bubble";
import { Button } from "@/components/ui/button";
import {
  useConversationMessages,
  useConversationParticipants,
} from "@/hooks/use-conversations";
import {
  formatChatDay,
  messageReplyToId,
  type ConversationParticipant,
  type Message,
} from "@/lib/conversations";

type MessageListProps = {
  conversationId: string;
  scrollContainerRef?: RefObject<HTMLElement | null>;
  scrollToBottomSignal?: number;
};

const NEAR_BOTTOM_PX = 120;

function findAuthor(
  participants: ConversationParticipant[],
  message: Message,
): ConversationParticipant | null {
  if (!message.characterId) return null;
  return participants.find((p) => p.id === message.characterId) ?? null;
}

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
}

function sameChatDay(a: string, b: string): boolean {
  const left = new Date(a);
  const right = new Date(b);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return false;
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function MessageList({
  conversationId,
  scrollContainerRef,
  scrollToBottomSignal = 0,
}: MessageListProps) {
  const messagesQuery = useConversationMessages(conversationId);
  const participantsQuery = useConversationParticipants(conversationId);

  const messages = messagesQuery.data ?? [];
  const participants = participantsQuery.data ?? [];

  const listRef = useRef<HTMLUListElement | null>(null);
  const prevCountRef = useRef(0);
  const didInitialScrollRef = useRef(false);
  const lastSignalRef = useRef(scrollToBottomSignal);
  const [unseenCount, setUnseenCount] = useState(0);

  const containerElement = useCallback(
    () => scrollContainerRef?.current ?? listRef.current,
    [scrollContainerRef],
  );

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const el = containerElement();
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
    },
    [containerElement],
  );

  useEffect(() => {
    const el = containerElement();
    if (!el) return;
    const onScroll = () => {
      if (isNearBottom(el)) setUnseenCount(0);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [containerElement, conversationId]);

  useEffect(() => {
    const el = containerElement();
    if (!el || messages.length === 0) return;

    const previousCount = prevCountRef.current;
    prevCountRef.current = messages.length;
    const appended = messages.length - previousCount;
    const initial = !didInitialScrollRef.current;

    if (initial || isNearBottom(el)) {
      didInitialScrollRef.current = true;
      requestAnimationFrame(() => scrollToBottom());
      if (appended > 0) setUnseenCount(0);
    } else if (appended > 0) {
      setUnseenCount((count) => count + appended);
    }
  }, [conversationId, messages.length, containerElement, scrollToBottom]);

  useEffect(() => {
    if (scrollToBottomSignal === lastSignalRef.current) return;
    lastSignalRef.current = scrollToBottomSignal;
    setUnseenCount(0);
    requestAnimationFrame(() => scrollToBottom());
  }, [scrollToBottomSignal, scrollToBottom]);

  if (messagesQuery.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (messagesQuery.isError) {
    return (
      <div className="px-4 py-8 text-center" role="alert">
        <p className="text-sm text-destructive">
          Não foi possível carregar as mensagens.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => void messagesQuery.refetch()}
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <MessagesSquare className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Ainda não há mensagens nesta conversa.
        </p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Envie a primeira mensagem para iniciar a conversa.
        </p>
      </div>
    );
  }

  const messageById = new Map(messages.map((message) => [message.id, message]));

  return (
    <>
      <ul ref={listRef} className="flex flex-col py-3" data-testid="message-list">
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const showDay =
            !previous ||
            !sameChatDay(previous.createdAt, message.createdAt);
          const showHeader =
            showDay ||
            !previous ||
            previous.characterId !== message.characterId ||
            previous.senderType !== message.senderType;
          const replyToId = messageReplyToId(message);
          const replyTarget = replyToId ? messageById.get(replyToId) : undefined;
          const replyTo: MessageReplyPreview | null = replyTarget
            ? {
                authorName:
                  findAuthor(participants, replyTarget)?.name ?? "Personagem",
                content: replyTarget.content,
              }
            : null;
          return (
            <Fragment key={message.id}>
              {showDay && (
                <li
                  role="separator"
                  aria-label={`Mensagens de ${formatChatDay(message.createdAt)}`}
                  className="sticky top-0 z-10 flex justify-center px-4 py-1.5"
                >
                  <span className="rounded-full border border-border bg-background/90 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                    {formatChatDay(message.createdAt)}
                  </span>
                </li>
              )}
              <MessageBubble
                message={message}
                author={findAuthor(participants, message)}
                showHeader={showHeader}
                replyTo={replyTo}
              />
            </Fragment>
          );
        })}
      </ul>
      {unseenCount > 0 && (
        <div className="pointer-events-none sticky bottom-3 z-20 flex justify-center px-4">
          <button
            type="button"
            onClick={() => {
              setUnseenCount(0);
              scrollToBottom("smooth");
            }}
            aria-live="polite"
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground shadow-md transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
            {unseenCount === 1
              ? "1 nova mensagem"
              : `${unseenCount} novas mensagens`}
          </button>
        </div>
      )}
    </>
  );
}
