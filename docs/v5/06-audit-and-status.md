# v5 — Auditoria do sistema existente e status de implementação

## 1. Auditoria (código real)
A V5 **não parte do zero**. Já existem, em produção/testes:
- `DriverAttribute` (4 atributos: speed, consistency, racecraft, aggression) e
  `TeamPerformance` (3: carSpeed, reliability, operations), ambos por `seasonId`.
- `simulation/qualifying.service.ts` e `simulation/race-simulation.service.ts` calculando
  quali/corrida a partir desses atributos + performance de equipe.
- `race-weekend` orquestrando sessões, resultados (`RaceSessionResult`, `RaceResult`), timeline e
  WorldState; `championship-progression` gerando pontos/standings; `evolution` evoluindo
  atributos/performance entre temporadas; `timeline` com correções; `race-consequences`.
- `external-sync` (Jolpica), `f1db` (dataset local CC BY 4.0, com circuitos/coordenadas/layouts/
  corridas/resultados/grids/abandonos/`positionsGained`/`pitStops`), `external-openf1` (apenas
  `/drivers` no código atual), `calendar/next-race`, `circuits` (catálogo/DB).
- UI existente de performance/atributos e páginas de equipe/piloto.
- Dialogue Engine e Command Layer preservados (F9 gate).

## 2. Gaps reais vs visão V5
| Área | Hoje | V5 |
|---|---|---|
| Atributos | 4 genéricos | 10 situacionais + potencial/fadiga/moral/forma |
| Treino | manual/evolução por corrida | programas por calendário, custo, potencial, IA |
| Equipe | 3 números | 8 dimensões + upgrades datados |
| Pista | `Circuit` geométrico | perfil completo com demandas, pneu, pit loss, SC, clima |
| Clima | ausente | climatologia por circuito/mês + por sessão |
| Previsão | não existe | probabilidades calibradas (PL/ROL/MC) |
| Corrida oficial | simulação existente (verificar aderência a voltas) | simulação por voltas + SC/VSC + estratégia |
| Carreira social | partial (relationships/events/memory) | feats, reações autônomas, memória esportiva |
| UI | performance básica | painéis de evolução/previsão/equipe/carreira |

## 3. O que foi implementado nesta etapa — V5.1 (completa)
### Dados de pista (real + derivado)
- `apps/api/src/modules/racing/track-profile.ts` — tipos, schema Zod, invariantes, campos
  indisponíveis explícitos.
- `apps/api/src/modules/racing/track-profile.build.ts` — builder puro:
  - geometria/circuito: F1DB (nome, país, cidade, tipo, sentido, lat/lon, extensão, curvas);
  - corrida: nome oficial, voltas, layout, mês do evento;
  - derivados de resultados reais (mesmo layout, últimas 12 temporadas): `dnfRate`,
    `avgPositionsGained`, `pitStopsPerRace`, `sampleStarts`;
  - `overtakingDifficulty` = percentil relativo de `avgPositionsGained` entre circuitos (1–10),
    documentado como **proxy** (não substitui avaliação Pirelli/FIA);
  - `unavailable[]` explícito para potência/downforce/frenagem/tração/pneu/abrasão/evolução/grip/
    pit loss/SC/sprint (não inventados);
  - proveniência por circuito (F1DB CC BY 4.0 + Open-Meteo ou NASA POWER) e confiança.
- `apps/api/src/modules/racing/track-profile.read.ts` — loader com validação e cache.
- `apps/api/src/scripts/build-v5-data.ts` — ingestão **offline**:
  - Open-Meteo Historical em lote (23 coordenadas) → climatologia 2015–2025;
  - fallback NASA POWER por circuito se Open-Meteo falhar (429);
  - resultados F1DB com `positionsGained`/`pitStops` (loader estendido);
  - escreve `data/v5/weather-climatology.v1.json` e `data/v5/track-profiles.v1.json`;
  - nenhuma chamada de rede em runtime.
- Dataset gerado: **23 circuitos** do calendário 2026 (F1DB `v2026.15.1`), clima 12 meses por
  circuito; destaque real: Interlagos nov ≈57% de dias de chuva, Mônaco jun ≈24%, Monza set ≈39%
  (valores de climatologia, não opinião). Madrid (`madring`, novo) sem histórico → derivados
  nulos e documentados.
- Testes: `conversation`/F9 intactos; `track-profile.test.ts` 4/4 (builder, invariantes,
  cobertura/proveniência); tsc limpo; F9 **PASS**.

### Limitações V5.1
- Potência/downforce/frenagem/tração/degradação/pit loss/SC/sprint ainda **não têm fonte
  implementada**; ficam `null` + `unavailable` até ingestão Pirelli/FIA/OpenF1 telemetria.
- `overtakingDifficulty` é proxy de posições ganhas, não avaliação geométrica; sujeito a viés de
  caos/SC. Será substituído/ajustado por dado curado.
- OpenF1 no projeto só busca `/drivers`; não há ingestão de pits/weather/race control.
- Dataset cobre o calendário F1DB 2026 (23 corridas); se o universo tiver pista extra, gera
  ausência documentada (não inventa).
- **Os JSONs `data/v5/*.json` precisam ser versionados junto do código** para o teste de dataset
  real passar em CI.

## 4. Fases restantes (não implementadas nesta execução)
- **V5.2** — migrar `DriverAttribute` para os 10 atributos + potencial/forma/fadiga/moral;
  seed pelo universo (Jolpica/resultados) com faixa de incerteza; treino por calendário, custo
  crescente, IA de treino; testes de não-inflação em temporada.
- **V5.3** — migrar `TeamPerformance` para 8 dimensões; seed por construtores/forma/DNF/pit;
  upgrades datados com fonte/confiança; testes por dimensão.
- **V5.4** — motor de previsão (Plackett–Luce/ROL + Monte Carlo) sobre perfis reais; backtest
  walk-forward com log loss/Brier/ECE vs baseline grid; feature flag.
- **V5.5** — simulação oficial por voltas (pneus, pit, SC/VSC, ultrapassagem) com RNG semeado;
  persistência via Command Layer (`RaceResult`/`RaceSessionResult`/pontos/timeline/WorldState).
- **V5.6** — carreira: treino por calendário, feats, moral/confiança, memórias/reações autônomas.
- **V5.7** — UI (atributos/treino/equipe/previsão/corrida/histórico) + validação de temporada.

## 5. Por que parar aqui
A V5.1 entrega a fundação de dados reais e validada. As fases seguintes exigem migrações e
refactors dos módulos de simulação/evolução existentes (não greenfield) e validação estatística;
executá-las sem esse cuidado violaria a regra de não declarar concluído sem evidência. O próximo
checkpoint recomendado é **V5.2** (atributos/treino) com migração TEST e testes de inflação.
