# HANDOFF — Dialogue Engine (curto e operacional)

## Estado atual
- Branch: `v4-Living-F1-Universe`
- HEAD: `199b098` — `test(api): add deterministic F9 dialogue engine benchmark gate` (F9)
- Working tree: limpo (após commit deste HANDOFF)
- **F9 concluída (Benchmark Gate)**; **roadmap F3–F9 concluído**.
- Próximo estado: sem fase planejada; backlog futuro abaixo.

## Roadmap concluído (commits reais)
F3: F3.1–F3.5 (HEAD F3.5 `b0f7b8b`); docs `docs/post-v4-dialogue-engine-f3.md`.
F5: F5.1 `89358c6`, F5.2 `541d0f7`, F5.3 `91d319e`, F5.4 `4c6ac82`.
F6: F6.1 `48e83ba`, F6.2 `502f998`, F6.3 `9c1c006`, F6.4 `5719019`, F6.5 `1cc8562`.
F7: F7.0 `2207c0f`, F7.1 `286a165`, F7.2 `6e390be`, F7.3 `c0bbe39`, F7.4 `9be1ff4`,
F7.5 `185bdef`, F7.6 `59c1e25`.
F8: F8.1 `f58b41e`, F8.2 `8fff7bd`, F8.3 `5fc7470`, F8.4 `ebfca63`, F8.5 `83caa99`.
F9: gate `199b098`; doc+handoff neste commit.

## F9 — Benchmark Gate
- Arquivo: `apps/api/src/modules/conversation/conversation.dialogue-f9-benchmark.test.ts`
  (TEST DB, fixtures próprias, cleanup em `afterAll`, sem LLM/rede, usa serviços reais).
- Comando: `pnpm benchmark:f9` (raiz) ou `npm run benchmark:f9` (apps/api).
- Cenários: B01 replay determinístico; B02 memória privada; B03 evento restrito; B04 ACL de
  conversa; B05 dedupe por evidenceId canônico; B06 cooldown; B07 budgets; B08 AI↔AI/stop;
  B09 isolamento de Universe; B10 Command Layer guard + prova de regressão (checkers puros).
- Thresholds: zeros duros para vazamento/escrita/cross-universe/duplicata/cooldown/budget/
  mensagens após stop/LLM; budgets lidos de `autonomyBudgets()` (nenhum número inventado).
- Resultado real: `F9 BENCHMARK GATE: PASS` (12/12 testes; contadores todos 0; exit 0).

## Validação real da F9
- Gate: `npm run benchmark:f9` PASS (12 testes).
- API: `npx tsc --noEmit` verde; ESLint do arquivo verde; build `tsc -p` verde; suíte completa
  **211 files / 2945 tests** verdes (inclui F6 E01–E10 e F7 E01–E20).
- Web (regressão F8): `npx tsc --noEmit` verde; **70 files / 519 tests**; `next lint` OK;
  `next build` produção OK.
- Banco: TEST (`f1_narrative_test`) com cleanup; DEV intocado; nenhuma migration nova.
- Flakes: nenhum observado em F9; flake histórico #13 não reproduziu.

## Backlog futuro (não é fase incompleta)
- Presença online real (não existe no backend).
- Integração opcional do streaming legado (`/turn/stream`) ao composer.
- Virtualização de mensagens em volumes altos; auto-resize de composer; skeletons dedicados.
- Guarda semântica de secret (somente se necessária; hoje a defesa é contextual).
- Sincronização do drift pré-existente schema↔migrations.
- Evals de performance/latência (F9 cobre invariantes, não tempo).

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
"Leia `docs/HANDOFF.md`, `AGENTS.md` e `docs/post-v4-dialogue-engine-f9.md`. Valide Git (branch,
HEAD, working tree). O roadmap F3–F9 está concluído; NÃO repita fases. Para verificar o engine,
rode `pnpm benchmark:f9` (gate PASS/FAIL). Para trabalho novo, escolha um item do backlog futuro
e trate como subfase própria (um commit, testes, HANDOFF). Não use amend e não faça push."
