"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Race } from "@/lib/championship";

type RaceCardProps = {
  race: Race;
  current?: boolean;
  onEdit: (race: Race) => void;
  onRemove: (race: Race) => void;
  onViewResults: (race: Race) => void;
  isRemoving: boolean;
  removeError: string | null;
};

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function RaceCard({
  race,
  current = false,
  onEdit,
  onRemove,
  onViewResults,
  isRemoving,
  removeError,
}: RaceCardProps) {
  const [confirming, setConfirming] = useState(false);
  const dateLabel = formatDate(race.date);

  return (
    <Card
      className={
        current
          ? "border-primary"
          : "transition-colors hover:border-muted-foreground/40"
      }
    >
      <div className="flex gap-4 p-4">
        <span className="flex w-16 shrink-0 flex-col items-center justify-center rounded-md border border-border bg-muted/20 px-2 py-2 text-center">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Rodada
          </span>
          <span className="mt-0.5 text-2xl font-black tabular-nums leading-none tracking-tight text-foreground">
            R{race.round ?? "—"}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-black leading-tight tracking-tight text-foreground">
            {race.name}
          </h3>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
            {(race.circuit || race.country) && (
              <span>
                {[race.circuit, race.country].filter(Boolean).join(", ")}
              </span>
            )}
            {dateLabel && <span>{dateLabel}</span>}
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            {current && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                Atual
              </span>
            )}
            <span
              className={
                race.status === "FINISHED"
                  ? "rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"
                  : "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              }
            >
              {race.status}
            </span>
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-border px-4 py-2.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onViewResults(race)}
        >
          Resultados
        </Button>
        <Button variant="outline" size="sm" onClick={() => onEdit(race)}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          Editar
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => setConfirming(true)}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Remover
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Remover corrida"
        description={`Deseja remover "${race.name}"? Esta ação não pode ser desfeita.`}
        onConfirm={() => onRemove(race)}
        isPending={isRemoving}
        error={removeError}
      />
      {removeError && (
        <p className="px-4 pb-4 text-sm text-destructive" role="alert">
          {removeError}
        </p>
      )}
    </Card>
  );
}
