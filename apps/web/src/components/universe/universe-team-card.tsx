"use client";

import { UnfoldVertical } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { UniverseSeat, UniverseTeam } from "@/lib/universe";

const SEAT_STATUS_LABELS: Record<UniverseSeat["status"], string> = {
  MATCH: "Alinhado",
  DIVERGENCE: "Divergente",
  SOURCE_ONLY: "Só na fonte",
  UNIVERSE_ONLY: "Só no universo",
};

function SeatStatusBadge({ status }: { status: UniverseSeat["status"] }) {
  const tone =
    status === "MATCH"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
      : "border-amber-500/40 bg-amber-500/10 text-amber-400";
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${tone}`}
    >
      {SEAT_STATUS_LABELS[status]}
    </span>
  );
}

type SeatRowProps = {
  seat: UniverseSeat;
};

function SeatRow({ seat }: SeatRowProps) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-lg border border-border bg-muted/30 px-3 py-3">
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          Fonte externa
        </p>
        <p className="mt-1 truncate text-sm font-semibold">
          {seat.source ? seat.source.name : "—"}
        </p>
        <p className="text-xs text-muted-foreground">
          {seat.source?.number != null
            ? `Nº ${seat.source.number}`
            : "\u00A0"}
        </p>
      </div>

      <div className="flex flex-col items-center gap-1">
        <SeatStatusBadge status={seat.status} />
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          Assento {seat.seat}
        </span>
      </div>

      <div className="min-w-0 text-right">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          Meu universo
        </p>
        <p className="mt-1 truncate text-sm font-semibold">
          {seat.universe ? seat.universe.characterName : "—"}
        </p>
        <p className="text-xs text-muted-foreground">
          {seat.universe
            ? `Prov: ${seat.universe.provenance}`
            : "\u00A0"}
        </p>
      </div>
    </div>
  );
}

type UniverseTeamCardProps = {
  team: UniverseTeam;
  isKeeping: boolean;
  isRestoring: boolean;
  pendingAction?: "keep" | "restore" | null;
  error?: string | null;
  onKeep: () => void;
  onRequestRestore: () => void;
};

export function UniverseTeamCard({
  team,
  isKeeping,
  isRestoring,
  pendingAction,
  error,
  onKeep,
  onRequestRestore,
}: UniverseTeamCardProps) {
  const divergent = team.status === "DIVERGENT";
  const restoredCount = team.seats.filter((s) => s.canRestore).length;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-2 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-lg">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{
                  backgroundColor: team.color ?? "#64748b",
                }}
                aria-hidden
              />
              {team.name}
              {team.shortName ? (
                <span className="text-sm font-medium text-muted-foreground">
                  {team.shortName}
                </span>
              ) : null}
            </CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Fonte externa: {team.externalTeamId}
            </p>
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${
              divergent
                ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
            }`}
          >
            <UnfoldVertical className="h-3 w-3" aria-hidden />
            {divergent ? "Divergente" : "Alinhada"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {team.seats.map((seat) => (
          <SeatRow key={seat.seat} seat={seat} />
        ))}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            onClick={onKeep}
            disabled={isKeeping || isRestoring}
          >
            {isKeeping && pendingAction === "keep" ? "Salvando..." : "Usar meu universo"}
          </Button>
          <Button
            type="button"
            variant={restoredCount > 0 ? "secondary" : "outline"}
            onClick={onRequestRestore}
            disabled={isKeeping || isRestoring || restoredCount === 0}
          >
            {isRestoring && pendingAction === "restore"
              ? "Restaurando..."
              : "Restaurar da fonte"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}