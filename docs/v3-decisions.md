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

## D-014 — Eventos de calendário são auditoria estado-neutra
- **Decisão:** `RACE_SCHEDULED` e `RACE_UPDATED` registram mudanças do calendário na timeline, mas o replay/recompute os ignora (não alteram `WorldState` nem standings). A timeline continua determinística e idempotente.
- **Consequência:** calendário tem trilha de auditoria sem criar acoplamento com o estado derivado; `Race` permanece fato materializado.

## D-015 — Override do Universe preservado por snapshot externo
- **Decisão:** cada binding de corrida guarda `contentHash` + `externalSnapshot` (último valor externo). O sync só atualiza um campo do `Race` se ele ainda for igual ao snapshot; campos editados pelo usuário são preservados. Sem sistema completo de edição de calendário nesta fase.
- **Consequência:** sync externo não sobrescreve silenciosamente decisões do usuário; backfill legado (snapshot nulo) atualiza uma vez e passa a guardar.

## D-016 — Next Race é estado do Universe
- **Decisão:** `GET /api/next-race` deriva previous/current/next de `WorldState` + `Race`/`Circuit` do Universe (ordem determinística `round, date, id`; classificação por `currentRaceId` e status). Nenhuma consulta à Jolpica em tempo de leitura; `totalRounds` é dinâmico.
- **Consequência:** a UI nunca escolhe a próxima corrida pela resposta externa; sem dados inventados (campos ausentes = `null`).

## D-017 — Materialização serializada por Universe
- **Decisão:** `universeInitService.execute` toma o advisory lock do Universe **antes** de montar o plano, reutilizando o lock da timeline. Corridas com dados incompletos são materializadas com campos nulos.
- **Consequência:** execuções concorrentes não duplicam corridas/bindings/eventos; um registro inconsistente não derruba o lote (D-006).

## D-018 — Número é escopo de temporada
- **Decisão:** a autoridade do número é `SeasonDriverEntry.number` (opção B); `DriverProfile.number` permanece como cache de compatibilidade, sincronizado apenas quando a entry pertence à temporada corrente do `WorldState`.
- **Consequência:** trocar de temporada não herda número automaticamente; leituras legadas continuam funcionando; board/atribuição sempre por temporada.

## D-019 — Regras FIA traduzidas para gameplay
- **Decisão:** referência 2026 F1 Regulations (Section A, Issue 03, 25/06/2026, publicada em 05/08/2026, WMSC 23/06/2026; A2.4 idêntico à Issue 02 — verificado em 28/09/2026, Art. A2.4). Gameplay: range 1–99, `#17` reservado, `#1` apenas para o campeão da temporada anterior do mesmo Universe, unicidade por temporada.
- **Consequência:** divergências FIA/gameplay são intencionais e documentadas; erros semânticos (`NUMBER_RESERVED`, `CHAMPION_ONLY`, `NUMBER_ALREADY_USED`) expõem o motivo.

## D-020 — Concorrência por constraint + P2002
- **Decisão:** unicidade garantida por índice único `[seasonId, number]`, com `P2002` convertido em `NUMBER_ALREADY_USED` (409); sem lock de aplicação para atribuição.
- **Consequência:** corrida de requisições concorrentes resulta em um vencedor e um 409 previsível.

## D-021 — Auditoria de número via timeline
- **Decisão:** reutilizar `NUMBER_CORRECTED` no `TimelineEvent` (worldDate = data corrente do world, causado por usuário), aplicado de forma idempotente no replay.
- **Consequência:** mudanças ficam auditáveis e reproduzíveis sem schema novo de eventos.

## D-022 — Referência regulatória vigente: Section A Issue 03
- **Decisão:** a referência normativa de números de piloto passa a ser a FIA 2026 F1 Regulations — Section A [General Provisions] — Issue 03 (documento de 25/06/2026, WMSC 23/06/2026, publicado no site da FIA em 05/08/2026). Verificação de 28/09/2026: Art. A2.4 idêntico à Issue 02 (A2.4.1 first-come/pedido de troca; A2.4.2 `#1` do campeão + reserva do número anterior; A2.4.3 forfeiture; A2.4.4 demais pilotos; A2.4.5 1–99 exceto 17).
- **Consequência:** D-008, D-018 e D-019 permanecem válidas sem ajustes de comportamento; novas Issues devem repetir esta verificação antes de qualquer alteração de código.
