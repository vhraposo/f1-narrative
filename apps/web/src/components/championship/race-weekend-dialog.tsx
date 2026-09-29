"use client";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRaceWeekend } from "@/hooks/use-race-weekend";
import type { RaceWeekend, WeekendSessionView } from "@/lib/weekend";
import { RACE_SESSION_LABELS } from "@/lib/world";
import { cn } from "@/lib/utils";

const STATE_LABELS: Record<WeekendSessionView["state"], string> = {
  COMPLETED: "Concluída",
  AVAILABLE: "Disponível",
  LOCKED: "Bloqueada",
};

function SessionResults({
  weekend,
  session,
}: {
  weekend: RaceWeekend;
  session: WeekendSessionView;
}) {
  if (session.results.length === 0) {
    return (
      <p className="px-4 pb-3 text-xs text-muted-foreground">
        {session.state === "COMPLETED"
          ? "Sem classificação registrada."
          : "Execução disponível no Race Weekend da Home."}
      </p>
    );
  }
  return (
    <div className="max-h-56 overflow-y-auto px-4 pb-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            <th className="py-1 pr-2 font-semibold">P</th>
            <th className="py-1 pr-2 font-semibold">Piloto</th>
            <th className="py-1 pr-2 font-semibold">Equipe</th>
            <th className="py-1 pr-2 text-right font-semibold">Pts</th>
            <th className="py-1 text-right font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {session.results.map((row) => (
            <tr
              key={`${session.session}-${row.driverProfileId}`}
              className="border-t border-border/60"
            >
              <td className="py-1 pr-2 tabular-nums text-muted-foreground">
                {row.position ?? "—"}
              </td>
              <td className="py-1 pr-2 text-foreground">{row.driverName}</td>
              <td className="py-1 pr-2 text-muted-foreground">
                {row.teamName ?? "—"}
              </td>
              <td className="py-1 pr-2 text-right tabular-nums text-foreground">
                {row.points > 0 ? row.points : "—"}
              </td>
              <td className="py-1 text-right text-xs text-muted-foreground">
                {row.status ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pt-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {weekend.effectiveSprint ? "Weekend com Sprint" : "Weekend padrão"}
      </p>
    </div>
  );
}

export function RaceWeekendDialog({
  race,
  onClose,
}: {
  race: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const query = useRaceWeekend(race?.id);
  const weekend = query.data ?? null;

  return (
    <Dialog
      open={race !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Fim de semana — {race?.name ?? ""}</DialogTitle>
          <DialogDescription>
            Sessões, classificações e pontuação do fim de semana do Universe.
          </DialogDescription>
        </DialogHeader>

        {query.isLoading ? (
          <p className="flex items-center gap-2 px-5 pb-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando sessões…
          </p>
        ) : null}

        {query.isError ? (
          <p className="px-5 pb-3 text-sm text-destructive" role="alert">
            Não foi possível carregar as sessões do fim de semana.
          </p>
        ) : null}

        {weekend ? (
          <div className="divide-y divide-border rounded-md border border-border">
            {weekend.sessions.map((session) => (
              <section key={session.session} aria-label={session.session}>
                <div className="flex items-center justify-between gap-2 px-4 py-2">
                  <p className="text-sm font-semibold text-foreground">
                    {RACE_SESSION_LABELS[session.session]}
                  </p>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      session.state === "COMPLETED"
                        ? "bg-primary/10 text-primary"
                        : session.state === "AVAILABLE"
                          ? "bg-muted text-brand"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {STATE_LABELS[session.state]}
                  </span>
                </div>
                <SessionResults weekend={weekend} session={session} />
              </section>
            ))}
          </div>
        ) : null}

        {weekend && weekend.sessions.length === 0 ? (
          <p className="px-5 pb-3 text-sm text-muted-foreground">
            Nenhuma sessão configurada para este fim de semana.
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
