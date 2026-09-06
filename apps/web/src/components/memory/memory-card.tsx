"use client";

import { Calendar, Trash2, Users } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  MEMORY_IMPORTANCE_LABELS,
  MEMORY_SOURCE_LABELS,
} from "@/lib/memories";
import type { Memory } from "@/lib/memories";

type MemoryCardProps = {
  memory: Memory;
  isDeleting: boolean;
  onDelete: (memory: Memory) => void;
  onOpen: (memory: Memory) => void;
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function MemoryCard({
  memory,
  isDeleting,
  onDelete,
  onOpen,
}: MemoryCardProps) {
  const [confirming, setConfirming] = useState(false);
  const title = memory.summary || memory.content;

  return (
    <Card>
      <CardHeader className="gap-1.5">
        <CardTitle className="text-base leading-snug">{title}</CardTitle>
        <CardDescription>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
            {MEMORY_IMPORTANCE_LABELS[memory.importance]}
          </span>{" "}
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
            {MEMORY_SOURCE_LABELS[memory.source]}
          </span>
        </CardDescription>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {formatDate(memory.createdAt)}
          </span>
          {memory.participants.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {memory.participants.length}{" "}
              {memory.participants.length === 1
                ? "participante"
                : "participantes"}
            </span>
          )}
        </div>
      </CardHeader>
      <CardFooter className="justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => onOpen(memory)}>
          Abrir
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setConfirming(true)}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Excluir
        </Button>
      </CardFooter>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Excluir memória"
        description="Deseja excluir esta memória? Esta ação não pode ser desfeita."
        onConfirm={() => onDelete(memory)}
        isPending={isDeleting}
      />
    </Card>
  );
}