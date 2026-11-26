# v5 — Pipeline de dados (pistas, clima, pilotos, equipes)

## 1. Princípio
**Nada de dados inventados.** Toda informação usada no motor tem origem rastreável, data de
coleta e versão. A ingestão é **offline/versionada** (script/CI), com cache; o runtime lê dados
já validados. Scraping em request é proibido.

## 2. Ativos de dados
| Ativo | Conteúdo | Fonte primária | Frequência |
|---|---|---|---|
| `track-profiles.vN.json` | 24 perfis de pista (geometria, demandas, pit loss, SC, clima) | FIA/F1/Pirelli/FastF1 + revisão humana | anual + pré-corrida |
| `weather-climatology.vN.json` | chuva/temperatura/umidade por circuito/mês | Open-Meteo Archive (ERA5, 1995–2025) | anual |
| `driver-seed.vN.json` | atributos iniciais + potencial + faixa | Jolpica/F1DB (resultados, quali, DNF) + standings + notícias | início de temporada + janela |
| `team-seed.vN.json` | carro/confiabilidade/pit/desenvolvimento | construtores, FastF1, notícias de upgrade | início + janelas |
| `facts-feats.vN.json` | conquistas/recordes para modificadores | dados do universo + histórico | contínuo (por universo) |

Cada JSON inclui no topo: `schemaVersion`, `generatedAt`, `sources[]` (URL + licença + data),
`notes`, e por item `confidence` (0–1) + `reviewedBy` (humano/quando).

## 3. Ingestão
- Jobs Node/TS em `apps/api/src/scripts/` (offline):
  - `ingest-tracks` — coleta/valida/gera perfis; diffs contra versão anterior; relatório.
  - `ingest-weather` — Open-Meteo archive: por lat/lon do circuito, 30 anos, agrega por mês/dia.
  - `ingest-drivers` — Jolpica results/qualifying/standings → métricas → seed com incerteza.
  - `ingest-teams` — construtores, DNF, pit stops, notícias (curadoria manual).
- Cache bruto em `.cache/` (gitignored) + snapshot final versionado em `data/v5/` (revisado).
- Retry/backoff e rate limit; nunca rodar em produção a cada request.

## 4. Normalização e validação
- Schema Zod por ativo; testes de faixa (ex.: pitLoss 15–35s; SC 0–1; pista 1–10).
- Soma de pesos por pista ≤/≥ limites; pelo menos 1 pista de rua e 1 permanente.
- Sem campos nulos obrigatórios; `confidence` < 0,6 exige revisão.
- Teste de "freshness": alerta se snapshot > 12 meses (pistas) / > 3 meses (notícias).
- Proveniência obrigatória: URL + data + licença; dados proprietários não são redistribuídos.

## 5. Seed de piloto (algoritmo)
Entradas por piloto (janela recente + carreira):
- standings (posição/pontos), wins/pódios, média de quali vs companheiro, ritmo de corrida relativo,
  DNF rate, experiência (anos), desempenho em chuva, desempenho no circuito, forma (últimas 5).
Processo:
1. normalizar cada sinal para 0–1 (percentil no grid);
2. mapear para atributos via pesos documentados (ex.: quali 40% classificação + 30% precisão + 30% carro);
3. adicionar incerteza (scouting ±) e potencial;
4. revisão humana para casos limítrofes (rookies com pouca amostra).
Saída: valores 0–100 + `confidence` + `sources`.

## 6. Seed de equipe
- Pontos por corrida, posição de construtores, forma 5, DNF rate, pit stop médio, upgrades
  (notícias com área/força), tendência.
- Mapear para carro (aero/potência/chassi/pneus/confiabilidade/pit/desenvolvimento/estratégia).
- Upgrades entram como modificadores datados e decrescentes; sem upgrade infinito.

## 7. Schema planejado (Prisma — só na fase de implementação)
```
TrackProfile        id, circuitKey, version, country, city, timezone, lat, lon, type, lengthKm,
                    laps, corners, elevationM, drsZones, power, downforce, braking, traction,
                    tyreStress, abrasion, evolution, overtakingDifficulty, pitLossS,
                    safetyCarRate, rainProbability, sources Json, confidence, reviewedAt

DriverAttributes    id, universeId, characterId, version, qualifyingPace, racePace, consistency,
                    braking, cornering, traction, smoothness, adaptability, focus, experience,
                    racecraft, fitness, potential Json, updatedAt
                    @@unique([universeId, characterId, version])

AttributeTraining   id, universeId, characterId, attribute, xp, cost, startedAt, completedAt,
                    fatigueDelta, source (RACE/TRAINING/FEAT)

TeamCarProfile      id, universeId, teamId, seasonId, aero, power, chassis, tyres, reliability,
                    pitCrew, development, strategy, upgrades Json, sources Json, updatedAt
                    @@unique([universeId, teamId, seasonId])

DriverFeat          id, universeId, characterId, kind, label, modifier Json, earnedAt, expiresAt

RacePrediction      id, universeId, raceId, seed, engineVersion, probabilities Json,
                    createdAt  // opcional, para auditoria/replay
```
- TrackProfile global (pistas reais canônicas); permitir override por universo no futuro.
- Nenhuma migração agora; planejar V5.1.

## 8. Integração com o existente
- Reusar clients Jolpica/OpenF1 já presentes (`external-sync`, `external-openf1`) e o
  `universe-init`/`world-simulation` para contexto; não criar novo provider de rede.
- Race/RaceResult/Season/ChampionshipStanding continuam fonte de verdade; o motor só lê.
- UI: painel pré-corrida e de desenvolvimento; sem alterar o chat (F11–F23 preservados).
- F9 (conversation) não é afetado; benchmark continua gate.

## 9. Estado implementado (V5.1)
- Ingestão offline em `apps/api/src/scripts/build-v5-data.ts` (script `v5:build-data`):
  - F1DB local (`data/external/f1db`, CC BY 4.0) para circuitos/calendário/resultados/grids/
    abandono/`positionsGained`/`pitStops`;
  - Open-Meteo Historical em **uma chamada em lote** para as 23 coordenadas (2015–2025);
    fallback por circuito para NASA POWER (dados abertos) em caso de 429/indisponibilidade;
  - saída versionada: `data/v5/track-profiles.v1.json` e
    `data/v5/weather-climatology.v1.json`.
- Builder puro `modules/racing/track-profile.build.ts` com derivados documentados: `dnfRate`,
  `avgPositionsGained`, `pitStopsPerRace`, `sampleStarts`, `overtakingDifficulty` (percentil de
  posições ganhas; proxy, não Pirelli) e `unavailable[]` para campos sem fonte.
- Loader validado `modules/racing/track-profile.read.ts`; testes em
  `modules/racing/track-profile.test.ts` (4/4).
- Ainda ausentes (não inventados): potência, downforce, frenagem, tração, estresse/abrasão de
  pneu, evolução, grip, pit loss, SC, sprint. Exigem Pirelli/FIA/telemetria OpenF1 (ampliar o
  client atual, que só tem `/drivers`).
- **Importante**: os JSONs em `data/v5/` devem ser versionados junto do código V5.1.

## 10. Licenças e limites
- Open-Meteo: CC BY 4.0, atribuição, 10k chamadas/dia (não comercial); dados armazenados com
  atribuição.
- Jolpica/Ergast e F1DB: respeitar termos/atribuição; F1DB CC-BY.
- Pirelli/FIA/F1.com: usar como referência e dados factuais; não redistribuir bases proprietárias;
  registrar links, não copiar conteúdo extenso.
- Scraping: checar robots/ToS, rate limit, cache; preferir API/dataset oficial.
- Notícias: curadoria manual com link e data; não usar texto integral.
