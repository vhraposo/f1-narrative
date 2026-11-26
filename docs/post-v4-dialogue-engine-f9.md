# Dialogue Engine — F9 (Benchmark Gate)

## 1. Objetivo
Fechar tecnicamente o Dialogue Engine F3–F8 com um gate de regressão determinístico,
mensurável e reproduzível que protege as invariantes de F5, F6, F7 e F8. Não cria engine,
pipeline, writer, tick, event bus, outbox ou framework de benchmark novo.

## 2. Problema que F9 resolve
As fases F5–F8 têm evals e testes próprios, mas não havia um comando único que respondesse
objetivamente “o engine continua determinístico, privado, orçado e replay-safe?”. O F9 agrega
as invariantes críticas em cenários com thresholds hard (zero violações) e exit code.

## 3. Estado inicial
Branch `v4-Living-F1-Universe`; HEAD `83caa99` (F8 concluída); working tree limpo; origin
sincronizado. F6 E01–E10 e F7 E01–E20 já existiam; evals F3/F5/F6/F7 e suítes verdes.

## 4. Arquitetura real encontrada
- Pipeline determinístico F3–F5 (`simulateConversationTurn`, planner/realizer/validator).
- F6: `buildAutonomyOpportunityPlan` + `runAutonomousTick` (seleção, envelope, budgets,
  cooldown, dedupe, evidenceId canônico).
- F7: ACL de conversa, `MemoryCharacter`, `EventCharacter`/`EventVisibility`, Command Layer.
- F8: UI (`apps/web`) coberta pela suíte web; sem impacto no gate backend.

## 5. Arquitetura do benchmark
- Vitest como runner (`apps/api/src/modules/conversation/conversation.dialogue-f9-benchmark.test.ts`),
  TEST DB (`f1_narrative_test`), fixtures próprias e cleanup em `afterAll`.
- Cenários B01–B10 exercitam os serviços reais (autonomia, contexto, retrieval, Command Layer,
  rotas via `app.inject`). Nenhum mock de writer; stub de provider local apenas para inspeção de
  contexto (sem rede/LLM).
- Checkers puros exportados (`countLeaks`, `countCrossUniverse`, `countDuplicateEvidence`,
  `countBudgetViolations`) usados pelos cenários e pela prova de regressão (F9.6).
- Relatório impresso no stdout + exit code do vitest (0 PASS, ≠0 FAIL).
- Comandos: `pnpm benchmark:f9` (raiz) ou `npm run benchmark:f9` (apps/api).

## 6. Cenários
| ID | Cenário | Mede | Threshold |
|---|---|---|---|
| B01 | Deterministic replay | plano/fingerprint/evidenceId iguais; tick repetido REUSED; sem decisões novas | divergência = 0 |
| B02 | Private knowledge isolation | A vê Memory X; B não vê (retrieval, knownFacts, contexto legado/prompt) | vazamento = 0 |
| B03 | Restricted event isolation | A vê evento restrito; B não; audit só do autorizado | vazamento = 0 |
| B04 | Conversation ACL | dono 200; terceiro 404 em leitura/escrita; cross-universe add rejeitado | vazamento/escrita = 0 |
| B05 | Opportunity dedupe | evento + memória derivada + change canônico → 1 seleção, candidateCount ≥4 | duplicata canônica = 0 |
| B06 | Cooldown | tick1 seleciona; tick2 bloqueia; tick3 libera | violação = 0 |
| B07 | Budget enforcement | seleção/envelopes/ações/mensagens ≤ budgets reais; 1 conversa/oportunidade | violação = 0 |
| B08 | AI↔AI | abertura sem USER; stop natural; profundidade ≤ `AUTONOMY_MAX_MESSAGES_PER_TICK` | violação/loop = 0 |
| B09 | Universe isolation | memória/evento/decisão de A nunca em B | cross-universe = 0 |
| B10 | Command Layer guard | target fora da conversa → REJECTED `TARGET_NOT_PARTICIPANT`, sem Message | escrita indevida = 0 |

Extra: `F9.6 regression proof` semeia entradas inválidas nos checkers e prova que detectam a
violação (leak, cross-universe, evidência duplicada, budget) sem alterar código de produção.

## 7. Métricas agregadas (execução real)
```
Determinism:                    PASS
Privacy leakage:                0
Unauthorized writes:            0
Cross-universe violations:      0
Duplicate canonical evidence:   0
Cooldown violations:            0
Budget violations:              0
Messages after stop:            0
LLM calls (deterministic path): 0
F9 BENCHMARK GATE: PASS
```

## 8. Thresholds e justificativa
- Invariantes de segurança/isolamento/dedupe/replay/stop são **hard zeros** (qualquer ocorrência
  é regressão).
- Budgets não foram inventados: usam `autonomyBudgets()` (`AUTONOMY_MAX_CONVERSATIONS_PER_TICK`,
  `AUTONOMY_MAX_ACTIONS_PER_TICK`, `AUTONOMY_MAX_MESSAGES_PER_TICK`) e o cap de profundidade do
  envelope derivado de `AUTONOMY_MAX_MESSAGES_PER_TICK`.
- Nenhum threshold de qualidade subjetiva/percentual foi criado.

## 9. Resultados
- `npm run benchmark:f9`: **12/12 testes**, relatório PASS, exit 0.
- API: `tsc --noEmit` verde; ESLint do arquivo do gate verde; build `tsc -p` verde;
  suíte completa **211 files / 2945 tests** verdes (inclui F6 E01–E10, F7 E01–E20 e o gate).
- Web: `tsc --noEmit` verde; **70 files / 519 tests**; `next lint` OK; `next build` OK.

## 10–12. Determinismo / replay / privacy
B01 garante fingerprint/evidenceId/plano iguais e tick REUSED sem duplicar decisões. B02/B03
garantem que memória privada e evento restrito não chegam a retrieval, knownFacts, prompt ou
audit do personagem não autorizado. B09 garante que nada atravessa universos.

## 13. Budgets
B07/B08 comprovam limites de conversas, ações, mensagens e profundidade; nenhum budget novo foi
introduzido.

## 14–18. Regressões F5–F8
O gate adiciona proteção agregada; as suítes existentes continuam sendo a primeira linha.
F5 (emotion/topic/memory/knowledge asymmetry), F6 (opportunity/dedupe/cooldown/budgets/AI↔AI),
F7 (ACL/Memory audience/Event audience/F6 audience/Command Layer) e F8 (web) permanecem verdes
na regressão completa.

## 19. Limitações
- O gate mede invariantes, não latência/performance nem qualidade subjetiva.
- B04 depende de sign-up/rotas reais; é a única parte que toca HTTP (sem LLM).
- Thresholds de budget usam as env/defaults correntes (se um budget for mal configurado por env,
  o gate usa o valor real — por design).
- Não há mutação real de código de produção no gate; a prova de regressão é por checkers.
- Duplicação intencional pequena com evals F6/F7 (o gate agrega, não substitui).

## 20. Riscos
- Alterações de schema/migrations fora do padrão podem exigir atualizar fixtures do gate.
- O gate roda na suíte completa também; qualquer flake no TEST DB afeta ambos.
- Cobertura de Event PUBLIC/RESTRICTED por contexto/API está no gate via B03 (restricted); PUBLIC
  fica coberto pelas suítes F7.

## 21. Flake histórico
`conversation.autonomous.test.ts` #13 não reproduziu em F9 (0 ocorrências nas execuções).
Permanece documentado e não mascarado.

## 22. Achados honestos
- B10 falhou na primeira execução porque o fixture criava só 2 personagens e o “target fora da
  conversa” era `undefined` — o gate detectou o cenário malformado, o que comprova sensibilidade
  a configuração incorreta. Corrigido no fixture do cenário.
- `countLeaks`/`countCrossUniverse`/`countDuplicateEvidence`/`countBudgetViolations` são a mesma
  lógica usada pelos checks e pela prova de regressão.

## 23. Arquivos alterados
- Criado: `apps/api/src/modules/conversation/conversation.dialogue-f9-benchmark.test.ts`.
- Alterados: `apps/api/package.json` (script `benchmark:f9`), `package.json` (script raiz),
  `docs/post-v4-dialogue-engine-f9.md`, `docs/HANDOFF.md`.
- Não alterados propositalmente: planner/realizer/validator/Command Layer/ACL/contexto/schema.

## 24. Comandos de execução
- Gate: `pnpm benchmark:f9` (raiz) ou `npm run benchmark:f9` (apps/api).
- Suítes: `pnpm --filter @f1nw/api test`, `pnpm --filter @f1nw/web test`.

## 25. Como interpretar PASS/FAIL
`F9 BENCHMARK GATE: PASS` exige todos os cenários PASS e todos os contadores zerados; qualquer
falha de teste/cenário/contador resulta em FAIL e exit code ≠ 0, bloqueando regressões.

## 26. Próximos passos
Roadmap F3–F9 concluído. Backlog futuro: presença real, integração opcional do streaming legado,
virtualização de mensagens, guarda semântica de secret (se necessária), sincronização do drift
de migrations, evals de performance/latência.
