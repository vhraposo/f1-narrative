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

## 3.2 V5.2–V5.4 implementadas como domínio puro (sem persistência ainda)
### V5.2 — `modules/racing/driver-development.ts`
- 10 atributos (`qualifyingPace`, `racePace`, `consistency`, `tireManagement`, `racecraft`,
  `starts`, `wetWeather`, `adaptability`, `composure`, `technicalFeedback`), potencial por
  atributo, idade/experiência, forma, moral, confiança e fadiga.
- `effectiveAttributes` (fadiga penaliza físicos; confiança penaliza compostura), treino com
  custo crescente, retorno decrescente por headroom, teto de potencial, fator de idade e
  programas padrão; IA escolhe o maior headroom; `advanceAge`/`recover`.
- `simulateDevelopmentSeason` limita ganho total (teste: ≤45 em 24 sessões) e nunca ultrapassa
  potencial. **7 testes.**

### V5.3 — `modules/racing/team-development.ts`
- 8 dimensões (`aero`, `power`, `chassis`, `tyres`, `reliability`, `pitCrew`, `development`,
  `strategy`), potencial, upgrades com `availableFrom`, confiança, custo e histórico.
- Rejeita duplicado/sem orçamento/sem headroom; ganho decrescente; `teamStrength` ponderado.
  **6 testes.**

### V5.4 — `modules/racing/race-probability.ts`
- Força = 58% piloto (efetivo por fadiga/confiança, seco/chuva, rua, dificuldade de
  ultrapassagem) + 42% equipe (pesos por tipo de pista) + bônus de casa pequeno.
- Grade por quali simulada (ritmo de quali + carro + ruído semeado); corrida por Gumbel/Monte
  Carlo com bônus de grade proporcional à dificuldade de ultrapassagem, DNF por confiabilidade/
  risco da pista/chuva e clima amostrado da climatologia real.
- Saída: win/pódio/pontos/top10/DNF/posição esperada/distribuição/força, grade, probabilidade de
  chuva; RNG determinístico (mulberry32 + hash). **8 testes** (normalização, determinismo,
  sensibilidade a força/chuva/casa/DNF/grade).
- Usa `TrackProfile` real, mas **ainda não há rota/API/UI nem backtest walk-forward**; isso é
  pré-requisito de aceite da V5.4 completa (calibração).

## 4. Fases restantes (não implementadas nesta execução)
- **V5.2+ (persistência)** — migração TEST estendendo `DriverAttribute`/`TeamPerformance`,
  adaptação de `qualifying`/`race-simulation`/`evolution`, seed via Jolpica/universo, rotas/UI.
- **V5.4+ (calibração)** — backtest walk-forward com log loss/Brier/ECE vs baseline de grade;
  feature flag `race_probability_v5`; ajustar pesos só com evidência.
- **V5.5** — motor oficial por voltas **(não criar paralelo ao `race-simulation` existente)**:
  extrair/estender o serviço atual com pneus, pit, SC/VSC, ultrapassagem, RNG semeado e
  persistência única via Command Layer (`RaceResult`/`RaceSessionResult`/pontos/timeline/WorldState).
- **V5.6** — carreira: ligar treino/upgrades ao calendário e ao banco (feature flag), feats,
  moral/confiança, memórias/reações autônomas.
- **V5.7** — UI (atributos/treino/equipe/previsão/corrida/histórico) + validação de temporada.

## 5. Por que parar aqui
V5.1–V5.4 estão em checkpoint verde (25 testes novos, tsc, F9). As fases seguintes exigem
migrações e integração com os módulos existentes (não greenfield) e validação estatística. Criar
um simulador paralelo ou UI sem integração violaria a arquitetura. Próximo passo exato:
**V5.2 de persistência** (migração TEST + adaptação dos consumidores), depois calibração V5.4,
depois V5.5 sobre o simulador existente.
