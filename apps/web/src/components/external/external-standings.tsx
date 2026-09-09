import { SectionHeading } from "@/components/home/section-heading";
import { Card, CardContent } from "@/components/ui/card";
import {
  ExternalSectionEmpty,
  ExternalSectionError,
  ExternalSectionLoading,
} from "@/components/external/external-section-state";
import { ExternalSourceBadge } from "@/components/external/external-source-badge";
import {
  positionSortKey,
  type ExternalStanding,
} from "@/lib/external-world";

export type DriverTeamInfo = {
  teamName: string | null;
  color: string | null;
};

type ExternalStandingsProps = {
  standings: ExternalStanding[];
  driverTeamByExternalId: Record<string, DriverTeamInfo>;
  isLoading: boolean;
  isError: boolean;
  refetching: boolean;
  onRetry: () => void;
};

export function ExternalStandings({
  standings,
  driverTeamByExternalId,
  isLoading,
  isError,
  refetching,
  onRetry,
}: ExternalStandingsProps) {
  const sortedStandings = [...standings].sort(
    (a, b) => positionSortKey(a.position) - positionSortKey(b.position),
  );

  return (
    <section aria-label="Classificação externa" className="space-y-4">
      <SectionHeading
        kicker="Dados Externos"
        title="Classificação"
        action={<ExternalSourceBadge />}
      />
      {isLoading && <ExternalSectionLoading />}
      {isError && (
        <ExternalSectionError
          description="Não foi possível carregar a classificação da fonte."
          refetching={refetching}
          onRetry={onRetry}
        />
      )}
      {!isLoading && !isError && sortedStandings.length === 0 && (
        <ExternalSectionEmpty
          title="Não há classificação da fonte informada."
          description="A classificação vem das posições externas (ExternalStanding) da temporada."
        />
      )}
      {!isLoading && !isError && sortedStandings.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="overflow-x-auto rounded-md border border-border">
              <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                <span className="w-10 shrink-0 text-center">Pos</span>
                <span className="h-4 w-1 shrink-0" aria-hidden="true" />
                <span className="flex-1">Piloto</span>
                <span className="shrink-0 text-right">Pontos</span>
              </div>
              <ol className="divide-y divide-border">
                {sortedStandings.map((standing) => {
                  const team =
                    driverTeamByExternalId[standing.externalDriver.externalId] ??
                    null;
                  const stats =
                    standing.wins || standing.podiums
                      ? `${standing.wins}V · ${standing.podiums}P`
                      : null;
                  return (
                    <li
                      key={standing.id}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <span className="w-10 shrink-0 text-center text-sm font-black tabular-nums text-muted-foreground">
                        {standing.position == null
                          ? "—"
                          : String(standing.position).padStart(2, "0")}
                      </span>
                      <span
                        aria-hidden
                        className="h-4 w-1 shrink-0 rounded-full bg-foreground/10"
                        style={
                          team?.color ? { backgroundColor: team.color } : undefined
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-foreground">
                          {standing.externalDriver.name}
                        </span>
                        {team?.teamName && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {team.teamName}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-black tabular-nums text-foreground">
                          {standing.points ?? "—"}{" "}
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            PTS
                          </span>
                        </span>
                        {stats && (
                          <span className="block text-[11px] font-semibold tabular-nums tracking-wide text-muted-foreground">
                            {stats}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}