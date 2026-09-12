"use client";

import { History } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { UniverseDivergence } from "@/lib/universe";

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const ORIGIN_LABELS: Record<string, string> = {
  INITIALIZATION: "Inicialização do universo",
  ROSTER_HIRE: "Contratação (roster)",
  ROSTER_PROMOTION: "Promoção (roster)",
  ROSTER_RELEASE: "Liberação (roster)",
};

export function originLabel(origin: string | null | undefined): string {
  return origin ? (ORIGIN_LABELS[origin] ?? origin) : "Sem atribuição registrada";
}

export function kindLabel(kind: string): string {
  switch (kind) {
    case "CREATED":
      return "Criação da entrada";
    case "SEATED":
      return "Designação ao assento";
    case "HIRED":
      return "Contratação";
    case "PROMOTED":
      return "Promoção de reserva";
    case "RELEASED":
      return "Liberação";
    case "DISPLACED":
      return "Deslocamento";
    case "STATUS_CHANGED":
      return "Mudança de estado";
    default:
      return kind;
  }
}

type UniverseEventDialogProps = {
  divergence: UniverseDivergence;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function UniverseEventDialog({
  divergence,
  open,
  onOpenChange,
}: UniverseEventDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Evento histórico do assento</DialogTitle>
          <DialogDescription>
            Registro auditável que explica a divergência atual entre fonte e
            universo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
            <History className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
              Somente leitura · evento histórico
            </span>
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                Tipo do evento
              </p>
              <p className="mt-1 text-sm font-semibold">{kindLabel(divergence.kind)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                Origem da divergência
              </p>
              <p className="mt-1 text-sm font-semibold">
                {originLabel(divergence.origin)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                Ocorrido em
              </p>
              <p className="mt-1 text-sm">{formatDate(divergence.occurredAt)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                Resumo
              </p>
              <p className="mt-1 text-sm">{divergence.summary}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                ID do evento
              </p>
              <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                {divergence.eventId}
              </p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            O evento é apenas o histórico. O estado atual do grid continua
            sendo a fonte da verdade operacional do universo.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}