import { SectionHeading } from "@/components/home/section-heading";
import { Card, CardContent } from "@/components/ui/card";
import {
  ExternalSectionEmpty,
  ExternalSectionError,
  ExternalSectionLoading,
} from "@/components/external/external-section-state";
import { ExternalSourceBadge } from "@/components/external/external-source-badge";

export type ExternalSeasonSummaryLeader = {
  name: string;
  points: number | null;
  teamName: string | null;
};

type ExternalOverviewProps = {
  year: number;
  teamsCount: number;
  driversCount: number;
  racesCount: number;
  resultsCount: number;
  leader: ExternalSeasonSummaryLeader | null;
  isLoading: boolean;
  isError: boolean;
  refetching: boolean;
  onRetry: () => void;
};

function MetricTile({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col justify-between gap-3 pt-6">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </span>
        <span className="text-4xl font-black tabular-nums tracking-tight text-foreground">
          {value}
        </span>
      </CardContent>
    </Card>
  );
}

export function ExternalOverview({
  year,
  teamsCount,
  driversCount,
  racesCount,
  resultsCount,
  leader,
  isLoading,
  isError,
  refetching,
  onRetry,
}: ExternalOverviewProps) {
  const hasData =
    teamsCount > 0 || driversCount > 0 || racesCount > 0 || resultsCount > 0;

  return (
    <section aria-label="Visão geral externa" className="space-y-4">
      <SectionHeading
        kicker="Dados Externos"
        title="Visão geral"
        action={<ExternalSourceBadge />}
      />
      {isLoading && <ExternalSectionLoading />}
      {isError && (
        <ExternalSectionError
          description="Não foi possível carregar o resumo da temporada na fonte."
          refetching={refetching}
          onRetry={onRetry}
        />
      )}
      {!isLoading && !isError && !hasData && (
        <ExternalSectionEmpty
          title={`Não há dados da fonte para ${year}.`}
          description="O resumo é montado apenas com o que a fonte informou para a temporada selecionada."
        />
      )}
      {!isLoading && !isError && hasData && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile label="Equipes" value={teamsCount} />
          <MetricTile label="Pilotos" value={driversCount} />
          <MetricTile label="Corridas" value={racesCount} />
          <MetricTile label="Resultados" value={resultsCount} />
          {leader && (
            <Card className="h-full border-brand/30 bg-brand/5 lg:col-span-4">
              <CardContent className="flex flex-col justify-between gap-3 pt-6 sm:flex-row sm:items-end">
                <div className="min-w-0 space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Líder do campeonato
                  </span>
                  <p className="truncate text-2xl font-black tracking-tight text-foreground">
                    {leader.name}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {leader.teamName ?? "Equipe não informada"}
                  </p>
                </div>
                <p className="shrink-0 text-right">
                  <span className="text-3xl font-black tabular-nums tracking-tight text-foreground">
                    {leader.points ?? "—"}
                  </span>{" "}
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    PTS
                  </span>
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </section>
  );
}