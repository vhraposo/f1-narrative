# HANDOFF — Dialogue Engine (curto e operacional)

## Estado atual
- Branch: `v4-Living-F1-Universe`
- HEAD: `ebfca63` — `feat(web): surface restricted event visibility and respect reduced motion` (F8.4)
- Working tree: limpo (após commit deste HANDOFF)
- **F8 concluída (UI/microbehaviors)**; F5/F6/F7 encerradas.
- Próximo checkpoint: F9 — benchmark gate (NÃO iniciado)

## Roadmap (commits reais)
F5: F5.1 `89358c6`, F5.2 `541d0f7`, F5.3 `91d319e`, F5.4 `4c6ac82`.
F6: F6.1 `48e83ba`, F6.2 `502f998`, F6.3 `9c1c006`, F6.4 `5719019`, F6.5 `1cc8562`.
F7: F7.0 `2207c0f`, F7.1 `286a165`, F7.2 `6e390be`, F7.3 `c0bbe39`, F7.4 `9be1ff4`,
F7.5 `185bdef`, F7.6 `59c1e25`.
F8:
- F8.1 mensagens/reply/dia — `f58b41e`
- F8.2 composer (teclado/limites/erros) — `8fff7bd`
- F8.3 visibility/participantes/estados de acesso — `5fc7470`
- F8.4 event badge + reduced motion — `ebfca63`
- F8.5 testes/doc/HANDOFF — este commit
F9 (benchmark gate): não iniciado.

## Resumo da F8 (detalhes em docs/post-v4-dialogue-engine-f8.md)
- Frontend `apps/web` evoluído sem novo backend/endpoint/migration: mensagens com agrupamento,
  separadores de dia, reply preview, timestamps `<time>`; composer com Enter/Shift+Enter,
  `maxLength=5000`, mapeamento de erros 400/401/403/404/429/5xx e preservação do texto em falha;
  header com badge de `visibility` (Privada / Universo com semântica honesta), pilha de avatares
  de participantes e estados de acesso (404/403 sem vazamento); auto-scroll inteligente com
  indicador “N novas mensagens”; typing indicator derivado do plano real (`simulate-turn/plan`);
  badge “Restrito” em eventos RESTRICTED; `motion-reduce` em spinners/typing.
- Decisão: manter o pipeline determinístico F3–F5 (`simulate-turn`) como engine da conversa;
  NÃO religar o streaming legado `/turn/stream` (provider LLM) para não alterar semântica.
- Privacidade: autorização permanece server-side (F7); UI não renderiza conteúdo restrito e trata
  403/404 como ausência de acesso; sem secret no DOM; sem proteção client-side como autoridade.
- DTOs web: `Conversation.visibility?`, `Event.visibility?`, `MessageContextJson.dialogue?`
  (opcionais; backend já os fornece).

## Validação real da F8
- Web: `npx tsc --noEmit` verde; `npx vitest run` **70 files / 519 tests**; `next lint` OK
  (warnings pré-existentes); `next build` produção OK.
- API: `npx tsc --noEmit` verde; subset conversation/autonomy/context/events/behavior
  **51 files / 745 tests** (inclui evals F6 E01–E10 e F7 E01–E20); suíte completa
  **210 files / 2933 tests** verdes.
- Backend: NÃO alterado; nenhuma migration; DEV intocado; TEST usado apenas nas suítes de teste.
- Nenhum teste removido/enfraquecido; sem skip/todo/sleep novo; sem flake novo observado.

## Próxima ação — F9 (exata, não iniciado)
F9 — benchmark gate. Antes de implementar: inspecionar o que já existe de benchmark/evals
(`conversation.dialogue-*-evals.test.ts`, docs F3–F8) e definir o gate mínimo (métricas
determinísticas, budgets, regressão F5–F8) sem novo pipeline. DEV read-only; TEST com cleanup;
um commit por subfase; atualizar HANDOFF.

## Flake conhecido (histórico, não mascarado)
`conversation.autonomous.test.ts` #13 (characterB antes de characterA) — reproduzido 1x na F7.2,
passou isolado/reruns; não apareceu na F7.6 nem na F8. Mecânica provável: penalties
RECENTLY_SPOKE/REDUNDANT_RESPONSE + timestamps reais vs worldDate fixo. Não corrigir sem
evidência de bug real.

## Achados de infraestrutura (mantidos)
- Drift pré-existente schema↔migrations (`Conversation_status_idx`, unique `Season(universeId,
  year)`, rename de índice) — NÃO corrigido.
- `prisma migrate dev` é interativo; migrations aplicadas com `migrate deploy` em TEST.
- `prisma generate` pode falhar com EPERM no engine DLL em uso; verificar tipos gerados antes.
- Web usa `.eslintrc.json` via `next lint` (ESLint 9 não encontra `eslint.config` para o binário
  direto); usar `npx next lint`.

## Limitações F8
- Sem presença online real; sem virtualização; sem auto-resize de composer/skeletons dedicados;
  streaming legado não integrado; badge Restrito apenas no card de evento.

## Riscos
- `visibility` opcional no DTO web (default PRIVATE/PUBLIC) — alinhado ao backend.
- Indicador de novas mensagens depende de geometria do scroller.
- Flake histórico #13 permanece documentado.

## Regras essenciais
Ver `AGENTS.md`. DEV read-only; TEST com cleanup; um commit por subfase; nunca amend;
atualizar este HANDOFF ao fim de cada subfase; código real prevalece sobre o handoff.

## Prompt de retomada
"Leia `docs/HANDOFF.md`, `AGENTS.md` e `docs/post-v4-dialogue-engine-f8.md`. Valide Git (branch,
HEAD, working tree). F5–F8 estão concluídas; NÃO repita. A próxima fase é F9 (benchmark gate) —
inspecione o código real de evals/benchmark antes de implementar, com testes, um commit novo e
atualização do HANDOFF. Não use amend."
