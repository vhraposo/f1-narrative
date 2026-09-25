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
