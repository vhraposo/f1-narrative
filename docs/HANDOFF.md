# HANDOFF — Dialogue Engine (curto e operacional)

## Estado atual
- Branch: `v4-Living-F1-Universe`
- HEAD: `7c9b417` — `docs: complete F9 benchmark gate documentation` (F9)
- Working tree: limpo (após commit deste HANDOFF)
- **F9 concluída (Benchmark Gate)**; **F10 concluída como análise (sem implementação)**.
- Caminho real da UI validado: Conversations usa `createMessage` + `simulate-turn/plan` +
  `simulate-turn` (engine determinístico F3–F7 + Command Layer). Nenhum acesso pelo web a
  `useStreamingTurn`/`useGenerateMessage`/`useAutonomousTurn` fora de lib/hooks/testes.
- Próximo passo: backlog P1 (unificar/desativar `ai-behavior` SEND_MESSAGE) ou itens F9.

## F10 — conclusão (detalhes em docs/post-v4-dialogue-engine-f10.md)
- Análise sem alteração de código (Caso 1/3): a experiência de Conversas já usa o engine
  F3–F7 protegido pelo F9; streaming legado NÃO deve ser religado agora (exigiria refactor).
- Achado P1: `ai-behavior.service.executeSendMessage` (painel de personagem) usa um segundo
  writer (`assembleGenerationBundle` + `persistGeneratedMessage`), ignorando planner/realizer/
  validator/Command Layer; default `nullProvider` torna o caminho inerte (409), mas um provider
  configurado o ativa. Contexto é filtrado por audiência (F7.2), sem P0 de vazamento.
- P0: nenhum. P2: streaming não integrado (intencional); painel SEND_MESSAGE sem provider.
- Benchmark F9 reexecutado após a análise: `F9 BENCHMARK GATE: PASS` (12/12; contadores 0).

## Roadmap concluído (commits reais)
F3: F3.1–F3.5 (HEAD F3.5 `b0f7b8b`); docs `docs/post-v4-dialogue-engine-f3.md`.
F5: F5.1 `89358c6`, F5.2 `541d0f7`, F5.3 `91d319e`, F5.4 `4c6ac82`.
F6: F6.1 `48e83ba`, F6.2 `502f998`, F6.3 `9c1c006`, F6.4 `5719019`, F6.5 `1cc8562`.
F7: F7.0 `2207c0f`, F7.1 `286a165`, F7.2 `6e390be`, F7.3 `c0bbe39`, F7.4 `9be1ff4`,
F7.5 `185bdef`, F7.6 `59c1e25`.
F8: F8.1 `f58b41e`, F8.2 `8fff7bd`, F8.3 `5fc7470`, F8.4 `ebfca63`, F8.5 `83caa99`.
F9: gate `199b098`; doc `7c9b417`.
F10: análise/docs neste commit.

## F9 — Benchmark Gate
- Arquivo: `apps/api/src/modules/conversation/conversation.dialogue-f9-benchmark.test.ts`
  (TEST DB, fixtures próprias, cleanup em `afterAll`, sem LLM/rede, serviços reais).
- Comando: `pnpm benchmark:f9` (raiz) ou `npm run benchmark:f9` (apps/api).
- Cenários B01–B10 + prova de regressão; thresholds hard-zero; budgets de `autonomyBudgets()`.
- Resultado real: `F9 BENCHMARK GATE: PASS` (12/12; contadores todos 0; exit 0).

## Validação real (F9, ainda referência para o código atual)
- API: `npx tsc --noEmit` verde; ESLint do arquivo verde; build `tsc -p` verde; suíte completa
  **211 files / 2945 tests** verdes (inclui F6 E01–E10 e F7 E01–E20).
- Web: `npx tsc --noEmit` verde; **70 files / 519 tests**; `next lint` OK; `next build` OK.
- F10 não reexecutou as suítes completas porque nenhum arquivo de código foi alterado; o
  benchmark F9 foi reexecutado e segue verde.
- Banco: TEST (`f1_narrative_test`) com cleanup; DEV intocado; nenhuma migration.
- Flakes: nenhum em F9/F10; flake histórico #13 não reproduzido.

## Backlog futuro (priorizado)
1. **P1**: unificar/desativar `ai-behavior` SEND_MESSAGE (segundo writer) em fase própria com
   testes; hoje inerte por default, ativo se `generationProvider` configurado.
2. Presença online real (não existe no backend).
3. Streaming como transporte do realizer determinístico (somente com requisito real de UX).
4. Virtualização de mensagens/auto-resize/skeletons; evals de performance/latência.
5. Guarda semântica de secret (se necessária); sincronização do drift schema↔migrations.

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
"Leia `docs/HANDOFF.md`, `AGENTS.md`, `docs/post-v4-dialogue-engine-f9.md` e
`docs/post-v4-dialogue-engine-f10.md`. Valide Git (branch, HEAD, working tree). F3–F9 concluídas
e F10 concluída como análise; NÃO repita. Para verificar o engine, rode `pnpm benchmark:f9`.
Para trabalho novo, escolha um item do backlog priorizado (P1 do ai-behavior primeiro) e trate
como subfase própria (um commit, testes, HANDOFF). Não use amend e não faça push."

