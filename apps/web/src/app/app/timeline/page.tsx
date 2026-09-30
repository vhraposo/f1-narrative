"use client";

import { useState } from "react";

import { ChampionsPanel } from "@/components/timeline/champions-panel";
import { TimelineView } from "@/components/timeline/timeline-view";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

type TimelineTab = "history" | "champions";

export default function TimelinePage() {
  const [tab, setTab] = useState<TimelineTab>("history");
  const [historySeasonId, setHistorySeasonId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="NARRATIVA / LINHA DO TEMPO"
        title="Linha do Tempo"
        description="A história do seu universo, correções aplicadas, campeões e divergências em relação à realidade externa."
      />
      <div
        role="tablist"
        aria-label="Seções da linha do tempo"
        className="flex gap-2 border-b border-border pb-2"
      >
        <Button
          role="tab"
          aria-selected={tab === "history"}
          variant={tab === "history" ? "default" : "ghost"}
          size="sm"
          onClick={() => setTab("history")}
        >
          História
        </Button>
        <Button
          role="tab"
          aria-selected={tab === "champions"}
          variant={tab === "champions" ? "default" : "ghost"}
          size="sm"
          onClick={() => setTab("champions")}
        >
          Campeões
        </Button>
      </div>
      {tab === "history" ? (
        <TimelineView
          key={historySeasonId ?? "all"}
          initialSeasonId={historySeasonId ?? undefined}
        />
      ) : (
        <ChampionsPanel
          onOpenTimeline={(seasonId) => {
            setHistorySeasonId(seasonId);
            setTab("history");
          }}
        />
      )}
    </div>
  );
}
