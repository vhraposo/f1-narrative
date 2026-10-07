# HANDOFF — Dialogue Engine (curto e operacional)

## Estado atual
- Branch: `v4-Living-F1-Universe`
- HEAD: `3e0ad46` — `feat(availability): derive effective presence windows in runtime consumers`
  (F12); docs/HANDOFF deste ciclo neste commit.
- Working tree: limpo (após commit deste HANDOFF)
- **F9 concluída (Benchmark Gate)**; **F10 concluída (análise)**; **F11 concluída (unificação do
  AI Behavior)**; **F12 concluída (presença/availability efetiva no runtime)**.
- Caminho real da UI validado: Conversations usa `createMessage` + `simulate-turn/plan` +
  `simulate-turn`; o `SEND_MESSAGE` do AI Behavior usa `simulateConversationTurn` com seed; o
  segundo writer (`assembleGenerationBundle`/`persistGeneratedMessage`) foi removido do AI
  Behavior.
- Presença (F12): `CharacterAvailability` é a intenção persistida (status + janela `until`); o
  estado efetivo é derivado pelo helper `availability.policy.ts` no relógio do engine (worldDate/
  última mensagem/`WorldState.currentDate`/`schedule.startsAt`). Sem segundo estado/migration.
- Próximo passo: escolher item do backlog abaixo (nenhum P0/P1 aberto de escrita paralela ou
  estado obsoleto).

## F10 — conclusão (detalhes em docs/post-v4-dialogue-engine-f10.md)
- Análise sem alteração de código (Caso 1/3): a experiência de Conversas já usa o engine
  F3–F7 protegido pelo F9; streaming legado NÃO deve ser religado agora (exigiria refactor).
- Achado P1: `ai-behavior.service.executeSendMessage` (painel de personagem) usa um segundo
  writer (`assembleGenerationBundle` + `persistGeneratedMessage`), ignorando planner/realizer/
  validator/Command Layer; default `nullProvider` torna o caminho inerte (409), mas um provider
  configurado o ativa. Contexto é filtrado por audiência (F7.2), sem P0 de vazamento.
- P0: nenhum. P2: streaming não integrado (intencional); painel SEND_MESSAGE sem provider.
- Benchmark F9 reexecutado após a análise: `F9 BENCHMARK GATE: PASS` (12/12; contadores 0).

## F11 — conclusão (detalhes em docs/post-v4-dialogue-engine-f11.md)
- `ai-behavior.service.executeSendMessage` passou a chamar `simulateConversationTurn` com
  `OpportunityEnvelopeSeed` (`fingerprint: decision.id`, `targetCharacterId: null`,
  `maxDepth: 1`); `Message` nasce apenas no Command Layer, com texto determinístico do realizer.
- `provider` removido do módulo AI Behavior (`ai-behavior.service.ts`, `ai-behavior.routes.ts`,
  `app.ts`); sem LLM no caminho (`metadata.llmUsed === false`).
- Rejeições: ACL/target → `TARGET_NOT_FOUND`; engine/domain gate → `EXECUTION_REJECTED` (409);
  WorldState ausente → `PRECONDITION_FAILED` sanitizado (200 com decision REJECTED/FAILED).
- Testes do ai-behavior adaptados (13/13) sem remover cobertura; provam ausência de marcadores do
  writer legado (`contextJson.family`/`generationKey`) e presença de `language.provider =
  "dialogue-realizer"` + `behavior.reasonCode`.
- Fixtures do ai-behavior passaram a criar `WorldState { key: "default", currentDate }` (pré-
  condição do engine). O engine cria `AiDecision` oficial `CONVERSATION_TURN_DUE`; testes que
  contavam decisões EXECUTED filtraram `contextVersion: "ai-behavior.v1"`.
- Fora do escopo: `CREATE_EVENT` do ai-behavior (Event, não Message), rotas legadas `/turn`,
  `/turn/stream`, `/generate`, streaming.

## F12 — conclusão (detalhes em docs/post-v4-dialogue-engine-f12.md)
- Achado: `until` era persistido/validado/exibido, mas nenhum consumidor o avaliava; a regra de
  disponibilidade estava duplicada em 4 pontos; `PATCH` não iniciava nova janela ao trocar status.
- Implementado (Opção A): `availability.policy.ts` com estado efetivo derivado
  (`resolveEffectiveAvailability`/`isAvailabilityOpen`), aplicado em `conversation.simulation`,
  `conversation.autonomous` (worldDate resolvido antes do planner), `conversation.turn-engine`,
  `behavior.context` (domain gate/scoring) e `world-simulation.tick` (`schedule.startsAt`).
- PATCH de availability: trocar status inicia nova janela (`since = agora`, `until = null` se
  omitido); reason-only preserva status/until. Sem migration; DEV intocado.
- Testes: +7 unitários do helper, +2 no PATCH, +1 no domain gate, +1 no planner, +1 no
  world-simulation; F11 (ai-behavior 13/13) e benchmark F9 PASS intactos.
- Fora do escopo: presença em tempo real (sessão/websocket), availability visível para terceiros,
  derivação de RACE_WEEKEND via WorldState/Eventos.

## Roadmap concluído (commits reais)
F3: F3.1–F3.5 (HEAD F3.5 `b0f7b8b`); docs `docs/post-v4-dialogue-engine-f3.md`.
F5: F5.1 `89358c6`, F5.2 `541d0f7`, F5.3 `91d319e`, F5.4 `4c6ac82`.
F6: F6.1 `48e83ba`, F6.2 `502f998`, F6.3 `9c1c006`, F6.4 `5719019`, F6.5 `1cc8562`.
F7: F7.0 `2207c0f`, F7.1 `286a165`, F7.2 `6e390be`, F7.3 `c0bbe39`, F7.4 `9be1ff4`,
F7.5 `185bdef`, F7.6 `59c1e25`.
F8: F8.1 `f58b41e`, F8.2 `8fff7bd`, F8.3 `5fc7470`, F8.4 `ebfca63`, F8.5 `83caa99`.
F9: gate `199b098`; doc `7c9b417`.
F10: análise `c9eee60`.
F11: F11.1 `d392196`; docs `c190018`.
F12: F12.1 `3e0ad46`; docs/HANDOFF neste commit.

## F9 — Benchmark Gate
- Arquivo: `apps/api/src/modules/conversation/conversation.dialogue-f9-benchmark.test.ts`
  (TEST DB, fixtures próprias, cleanup em `afterAll`, sem LLM/rede, serviços reais).
- Comando: `pnpm benchmark:f9` (raiz) ou `npm run benchmark:f9` (apps/api).
- Cenários B01–B10 + prova de regressão; thresholds hard-zero; budgets de `autonomyBudgets()`.
- Resultado real: `F9 BENCHMARK GATE: PASS` (12/12; contadores todos 0; exit 0).

## Validação real (F12)
- API: `npx tsc --noEmit` verde; ESLint do escopo verde; build `tsc -p` verde.
- Escopo afetado (`availability + behavior + conversation + autonomy + ai-behavior +
  world-simulation`): **45 files / 594 tests** verdes.
- Suíte completa API: **212 files / 2958 tests** — 100% verde (flake histórico não reproduziu).
- Benchmark: `pnpm benchmark:f9` → `F9 BENCHMARK GATE: PASS` antes e depois (12/12; contadores 0).
- Web: `npx tsc --noEmit` verde; **70 files / 519 tests**; `next lint` OK; `next build` OK
  (F12 não alterou web).
- Banco: TEST (`f1_narrative_test`) com fixtures/cleanup; DEV intocado; nenhuma migration.
- F11 regression: `ai-behavior` 13/13 (Command Layer/dialogue-realizer/llmUsed=false intactos).

## Flakes observados
- F12: nenhum flake novo; `pilot-knowledge.provision.test.ts #4` não reproduziu no full.
- Histórico: `pilot-knowledge.provision #4` (falhou no full na F11, passa isolado; documentado
  desde F6); `world-progression`/`biography.lifecycle`/`conversation.autonomous #13` falharam uma
  vez sob pressão na F11 e passaram isoladas. Nenhum é atribuído a F11/F12.

## Backlog futuro (priorizado)
1. Streaming como transporte do realizer determinístico (somente com requisito real de UX).
2. Presença em tempo real (sessão/websocket/heartbeat) — só existe presença de domínio hoje
   (F12); exige infraestrutura nova e requisito de UX.
3. Virtualização de mensagens/auto-resize/skeletons; evals de performance/latência.
4. `CREATE_EVENT` do ai-behavior via pipeline oficial (opcional; hoje writer direto de Event).
5. Derivação automática de RACE_WEEKEND/status via Schedule/WorldState (F12 deixou manual).
6. Guarda semântica de secret (se necessária); sincronização do drift schema↔migrations.
   (P1 da F10 — segundo writer — concluído na F11; presença de domínio concluída na F12.)

## Achados de infraestrutura (mantidos)
- Drift schema↔migrations (`Conversation_status_idx`, unique `Season(universeId, year)`, rename
  de índice) — NÃO corrigido.
- `prisma migrate dev` interativo; migrations via `migrate deploy` em TEST.
- `prisma generate` pode falhar com EPERM no engine DLL; verificar tipos gerados.
- Web usa `.eslintrc.json` via `next lint` (ESLint 9 direto não acha config).

## Regras essenciais
Ver `AGENTS.md`. DEV read-only; TEST com cleanup; um commit por subfase; nunca amend;
atualizar este HANDOFF ao fim de cada subfase; código real prevalece sobre o handoff.

## Prompt de retomada
"Leia `docs/HANDOFF.md`, `AGENTS.md`, `docs/post-v4-dialogue-engine-f9.md`,
`docs/post-v4-dialogue-engine-f10.md`, `docs/post-v4-dialogue-engine-f11.md` e
`docs/post-v4-dialogue-engine-f12.md`. Valide Git (branch, HEAD, working tree). F3–F9
concluídas, F10 análise, F11 (unificação do AI Behavior) e F12 (presença/availability efetiva)
concluídas; NÃO repita. Para verificar o engine, rode `pnpm benchmark:f9`. Para trabalho novo,
escolha um item do backlog priorizado e trate como subfase própria (um commit, testes, HANDOFF).
Não use amend e não faça push."

