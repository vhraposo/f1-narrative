# V3 — Architectural Decisions

Decisões tomadas durante a implementação autônoma da V3. Cada entrada registra contexto, decisão e consequência.

## D-001 — Provider externo incremental (não big-bang)
- **Contexto:** a Jolpica é a única fonte integrada; trocar para um provider universal de uma vez exigiria reescrever todos os escopos de sync.
- **Decisão:** criar `ExternalDataProvider` cobrindo as capacidades novas (`getCircuits`, `getSeasonSchedule`) e manter os demais escopos no `JolpicaClient`. `createExternalDataProvider("jolpica", client)` é o ponto de extensão para F1DB.
- **Consequência:** nenhuma parte nova do código chama Jolpica diretamente; troca de fonte é localizada.

## D-002 — `ExternalCircuit` (mirror global) × `Circuit` (Universe)
- **Decisão:** seguir o padrão existente do projeto: mirror factual global + entidade própria por Universe + binding `[universeId, externalCircuitId]` (via `ensureCircuitForUniverse`).
- **Consequência:** um usuário nunca enxerga ou altera o circuito do outro; o espelho permanece factual.

## D-003 — Campos legados preservados
- **Decisão:** `Race.circuit/country` (strings) permanecem; `Race.circuitId` é opcional e ligado por `onDelete: SetNull`. `ExternalRace` recebeu colunas novas sem remover as antigas.
- **Consequência:** compatibilidade total com dados e rotas atuais; backfill é oportunista.

## D-004 — Idempotência e lock
- **Decisão:** upsert por `[source, externalId]`/`[source, seasonYear, round]` com `contentHash` (padrão do projeto). Controle de concorrência em memória por `[source, scope, seasonYear]` com coalescing: chamadas simultâneas do mesmo escopo compartilham a mesma execução; persistência e fetch no mesmo run.
- **Consequência:** sync repetido não duplica; duas requisições concorrentes não geram dois fetches/persistências.

## D-005 — Auditoria de sincronização
- **Decisão:** toda execução cria `ExternalSyncRun` (RUNNING→SUCCESS/FAILED) com `statistics`, `finishedAt`, `lastSyncedAt` e `error` sanitizado (máx. 300 chars, sem stack). `triggeredById` quando houver usuário.
- **Consequência:** a UI da Fase 6 poderá exibir progresso/resultado sem novo modelo.

## D-006 — Normalização defensiva, sem inventar dados
- **Decisão:** país passa por aliases (`UK→United Kingdom`, `USA→United States`, etc.); coordenadas são validadas por faixa e descartadas se inválidas; circuitos sem `circuitId` ou `circuitName` são pulados; corridas sem `round` são puladas. Não bloquear o lote por um registro inconsistente.
- **Consequência:** dados suspeitos não entram no espelho; lacunas ficam `null` em vez de valores fabricados.

## D-007 — F1DB reservado para assets (não integrado ainda)
- **Contexto:** F1DB é CC BY 4.0 e fornece layouts SVG, comprimento e voltas; Jolpica não fornece nada disso.
- **Decisão:** os campos (`lengthMeters`, `turns`, `direction`, `layoutKey`, `layoutUrl`) existem no modelo, mas permanecem nulos até integração aprovada. Não fazer scraping de Formula1.com.
- **Consequência:** nenhuma dependência nova nem dados inventados; a integração é aditiva quando decidida.

## D-008 — Regra de número de piloto (FIA × gameplay)
- **Contexto:** a regra oficial vigente (2026): números 2–99; `#1` reservado ao campeão; `#17` aposentado (Bianchi); `#0` inelegível; número liberado após 2 temporadas sem uso.
- **Decisão (a implementar na Fase 4):** o backend é autoridade; `#1` só para o campeão anterior; `#17` sempre indisponível; unicidade por temporada via constraint. Qualquer regra de gameplay mais restritiva será documentada aqui.
- **Consequência:** a UI apenas sugere; conflitos de corrida retornam 409 claro.

## D-009 — `TimelineEvent` é infraestrutura temporal, não substitui `Event`
- **Decisão:** `TimelineEvent` registra mudanças de estado do Universe (avanço de tempo e correções de fatos esportivos); o `Event` narrativo continua sendo o registro da história. Não há conversão, espelhamento ou dependência entre os dois.
- **Consequência:** narrativa (memória/RAG/notícias/conversa) permanece intocada; replay temporal não depende do sistema narrativo.

## D-010 — Ordenação determinística e correções retroativas
- **Decisão:** replay ordena por `(worldDate, sequence)`. Correção retroativa é um novo evento com `worldDate` no passado (≤ data atual do mundo) e `supersedesId` opcional (somente mesmo `kind`); durante o replay o evento superseded é ignorado, mas permanece no histórico.
- **Consequência:** editar o passado não sobrescreve nada; o estado derivado é reconstruído deterministicamente. Sem branches/universos alternativos na V3.

## D-011 — Snapshot: baseline + checkpoint por volume
- **Decisão:** snapshot baseline em `sequence 0` no primeiro avanço; checkpoints automáticos a cada 20 eventos; snapshots explícitos via serviço. Estado do snapshot = `WorldState` + `ChampionshipStanding` da temporada corrente.
- **Consequência:** replay não recalcula todo o histórico em toda requisição e o custo é limitado; estratégia simples, sem otimização prematura.

## D-012 — Concorrência por advisory lock do Universe
- **Decisão:** toda mutação temporal toma `pg_advisory_xact_lock(hashtext('timeline:<universeId>'))` dentro da transação; `sequence` é única por universe. Recompute, avanço e correções usam a mesma trava.
- **Consequência:** avanços/correções concorrentes são serializados; falhas fazem rollback total (sem estado parcial).

## D-013 — Um único sistema de progressão
- **Decisão:** a agregação de standings foi extraída para `championship-progression.service.recomputeSeasonStandings` e é usada tanto pela rota `POST /api/races/:raceId/championship/apply` quanto pela timeline (eventos `RACE_RESULT_CORRECTED`).
- **Consequência:** não existe segundo cálculo de campeonato; correções e apply produzem o mesmo resultado para os mesmos fatos.
