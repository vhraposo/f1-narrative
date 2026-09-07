"use client";

import { CalendarDays, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  IMPORTANCE_SIGNAL_CLASS,
  ImportanceDot,
} from "@/components/events/event-display";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  formatMemoryDate,
  MEMORY_IMPORTANCE_LABELS,
  type Memory,
  type MemoryParticipant,
} from "@/lib/memories";
import { cn } from "@/lib/utils";

type MemoryCardProps = {
  memory: Memory;
  eventTitle?: string;
  isDeleting: boolean;
  onDelete: (memory: Memory) => void;
  onOpen: (memory: Memory) => void;
};

function ParticipantAvatar({
  participant,
}: {
  participant: MemoryParticipant;
}) {
  const initial = participant.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <Link
      href={`/app/characters/${participant.id}`}
      aria-label={participant.name}
      className="shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
    >
      {participant.imageUrl ? (
        <img
          src={participant.imageUrl}
          alt=""
          className="h-6 w-6 rounded-full bg-muted object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-bold uppercase text-muted-foreground"
        >
          {initial}
        </span>
      )}
    </Link>
  );
}

export function MemoryCard({
  memory,
  eventTitle,
  isDeleting,
  onDelete,
  onOpen,
}: MemoryCardProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <article className="relative overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-brand/50">
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 left-0 w-[3px]",
          IMPORTANCE_SIGNAL_CLASS[memory.importance],
        )}
      />

      <div className="flex flex-col gap-3 p-5 pl-5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Memória
          </span>
          <span aria-hidden="true" className="text-muted-foreground/50">
            ·
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            {formatMemoryDate(memory.createdAt)}
          </span>
          <span aria-hidden="true" className="text-muted-foreground/50">
            ·
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-foreground">
            <ImportanceDot importance={memory.importance} />
            {MEMORY_IMPORTANCE_LABELS[memory.importance]}
          </span>
        </div>

        <h3 className="text-lg font-black leading-snug tracking-tight text-foreground">
          {memory.summary || "Memória"}
        </h3>

        <p className="line-clamp-3 whitespace-pre-line break-words text-sm leading-relaxed text-muted-foreground">
          {memory.content}
        </p>

        {memory.participants.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {memory.participants.slice(0, 3).map((participant) => (
              <ParticipantAvatar
                key={participant.id}
                participant={participant}
              />
            ))}
            <span className="text-xs text-muted-foreground">
              {memory.participants
                .slice(0, 2)
                .map((p) => p.name)
                .join(" · ")}
              {memory.participants.length > 2
                ? ` +${memory.participants.length - 2}`
                : ""}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-2.5">
        <span className="text-xs text-muted-foreground">
          {memory.eventId != null && (
            <>
              Origem:{" "}
              <Link
                href={`/app/events/${memory.eventId}`}
                className="font-medium text-foreground transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              >
                {eventTitle ?? "Evento"}
              </Link>
            </>
          )}
          {memory.eventId == null && "Origem: registro direto"}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpen(memory)}>
            Abrir
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Excluir
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Excluir memória"
        description="Deseja excluir esta memória? Esta ação não pode ser desfeita."
        onConfirm={() => onDelete(memory)}
        isPending={isDeleting}
      />
    </article>
  );
}
