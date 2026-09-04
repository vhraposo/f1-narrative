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
  AVAILABILITY_STATUSES,
  type AvailabilityStatus,
} from "@/lib/availability";
import { useAvailability, useUpdateAvailability } from "@/hooks/use-availability";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// Converter um datetime ISO de volta para o valor aceito pelo input datetime-local.
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

  // Preenche o formulário quando entra em edição ou o dado muda.
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

    // ApiError (404/400) já tem mensagem amigável; qualquer outro erro genérico.
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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-xl">Disponibilidade</CardTitle>
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
              <select
                id="availability-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as AvailabilityStatus)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {AVAILABILITY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
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
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="text-right">{data.status}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Desde</dt>
              <dd className="text-right">{formatDate(data.since)}</dd>
            </div>
            {data.reason && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Motivo</dt>
                <dd className="text-right">{data.reason}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Até</dt>
              <dd className="text-right">{formatDate(data.until)}</dd>
            </div>
          </dl>
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