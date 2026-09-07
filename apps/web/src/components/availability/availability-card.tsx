"use client";

import { Loader2, Pencil, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectTrigger,
} from "@/components/ui/select";
import {
  AVAILABILITY_STATUSES,
  AVAILABILITY_STATUS_LABELS,
  formatAvailabilityDateTime,
  type AvailabilityStatus,
} from "@/lib/availability";
import { useAvailability, useUpdateAvailability } from "@/hooks/use-availability";

function toLocalInputValue(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function AvailabilityCard({ characterId }: { characterId: string }) {
  const { data, isLoading, isError, refetch } = useAvailability(characterId);
  const updateMutation = useUpdateAvailability(characterId);

  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<AvailabilityStatus>("AVAILABLE");
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [hasUntil, setHasUntil] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (editing && data) {
      setStatus(data.status);
      setReason(data.reason ?? "");
      setUntil(toLocalInputValue(data.until));
      setHasUntil(Boolean(data.until));
    }
  }, [editing, data]);

  function handleSave() {
    setSubmitError(null);
    const payload: Parameters<typeof updateMutation.mutate>[0] = {
      status,
      ...(reason.trim() !== "" ? { reason: reason.trim() } : { reason: null }),
      ...(hasUntil && until
        ? { until: new Date(until).toISOString() }
        : { until: null }),
    };

    updateMutation.mutate(payload, {
      onSuccess: () => {
        setEditing(false);
      },
      onError: (err) => {
        setSubmitError(
          err instanceof Error ? err.message : "Não foi possível salvar.",
        );
      },
    });
  }

  const sinceText = data ? formatAvailabilityDateTime(data.since) : null;
  const untilText = data ? formatAvailabilityDateTime(data.until) : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand">
            Status
          </p>
          <CardTitle className="mt-1 text-xl">Disponibilidade</CardTitle>
        </div>
        {!isLoading && !isError && data && !editing && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSubmitError(null);
              setEditing(true);
            }}
          >
            <Pencil className="mr-2 h-4 w-4" />
            Editar
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="space-y-3">
            <p className="text-sm text-destructive" role="alert">
              Não foi possível carregar a disponibilidade.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void refetch()}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Tentar novamente
            </Button>
          </div>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma disponibilidade registrada.
          </p>
        ) : editing ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="availability-status">Status</Label>
              <Select
                value={status}
                onValueChange={(value) =>
                  setStatus(value as AvailabilityStatus)
                }
                options={AVAILABILITY_STATUSES.map((s) => ({
                  value: s,
                  label: AVAILABILITY_STATUS_LABELS[s],
                }))}
              >
                <SelectTrigger id="availability-status" />
                <SelectContent />
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="availability-reason">Motivo</Label>
              <Input
                id="availability-reason"
                value={reason}
                maxLength={500}
                placeholder="Ex.: concentração para a corrida"
                onChange={(e) => setReason(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Deixe em branco para limpar o motivo.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="availability-until">Válido até</Label>
              {hasUntil ? (
                <div className="flex gap-2">
                  <Input
                    id="availability-until"
                    type="datetime-local"
                    value={until}
                    onChange={(e) => setUntil(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Limpar data final"
                    onClick={() => {
                      setHasUntil(false);
                      setUntil("");
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setHasUntil(true)}
                >
                  Definir data final
                </Button>
              )}
            </div>

            {submitError && (
              <p className="text-sm text-destructive" role="alert">
                {submitError}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-background/40 p-4 sm:p-5">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-full bg-foreground"
              />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Status atual
                </p>
                <p className="mt-0.5 text-sm font-black uppercase tracking-[0.14em] text-foreground">
                  {AVAILABILITY_STATUS_LABELS[data.status]}
                </p>
              </div>
            </div>

            <dl className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="shrink-0 text-muted-foreground">Disponível desde</dt>
                <dd className="text-right font-medium tabular-nums text-foreground">
                  {sinceText ?? "—"}
                </dd>
              </div>
              {untilText && (
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="shrink-0 text-muted-foreground">Válido até</dt>
                  <dd className="text-right font-medium tabular-nums text-foreground">
                    {untilText}
                  </dd>
                </div>
              )}
            </dl>

            {data.reason && (
              <div className="mt-4 border-t border-border pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Motivo
                </p>
                <p className="mt-1 text-sm leading-relaxed text-foreground">
                  {data.reason}
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>

      {editing && (
        <CardFooter className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={updateMutation.isPending}
            onClick={() => {
              setEditing(false);
              setSubmitError(null);
            }}
          >
            Cancelar
          </Button>
          <Button
            disabled={updateMutation.isPending}
            onClick={handleSave}
          >
            {updateMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              "Salvar"
            )}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
