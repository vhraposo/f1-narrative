"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Season } from "@/lib/championship";

type SeasonCardProps = {
  season: Season;
  active: boolean;
  current?: boolean;
  onSelect: (season: Season) => void;
  onEdit: (season: Season) => void;
  onRemove: (season: Season) => void;
  isRemoving: boolean;
  removeError: string | null;
};

export function SeasonCard({
  season,
  active,
  current = false,
  onSelect,
  onEdit,
  onRemove,
  isRemoving,
  removeError,
}: SeasonCardProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <Card
      className={
        active
          ? "border-primary"
          : "transition-colors hover:border-muted-foreground/40"
      }
    >
      <button
        type="button"
        onClick={() => onSelect(season)}
        aria-pressed={active}
        className="flex w-full items-center justify-between gap-3 rounded-lg p-4 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Temporada
          </span>
          <span className="mt-0.5 block text-3xl font-black tabular-nums leading-none tracking-tight text-foreground">
            {season.year}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {current && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
              Atual
            </span>
          )}
          <span
            className={
              season.status === "ACTIVE"
                ? "rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"
                : "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            }
          >
            {season.status}
          </span>
        </span>
      </button>
      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
        <span className="truncate text-sm text-muted-foreground">
          {season.name ?? `Temporada ${season.year}`}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => onEdit(season)}>
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
        </span>
      </div>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Remover temporada"
        description={`Deseja remover a temporada ${season.year}? Esta ação não pode ser desfeita.`}
        onConfirm={() => onRemove(season)}
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
