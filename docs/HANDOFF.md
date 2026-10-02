# HANDOFF — Dialogue Engine (curto e operacional)

## Estado atual
- Branch: `v4-Living-F1-Universe`
- HEAD: `1cc8562` — `test(conversation): complete F6 evals and documentation` (F6.5)
- Working tree: limpo (após commit deste HANDOFF)
- Última fase concluída: F6.5 (F6 encerrada de F6.1 a F6.5)
- Subfase atual: nenhuma; F7 não iniciada
- Próximo checkpoint: F7 — private groups/secrets (não iniciada)

## Roadmap (commits reais)
F5 (concluída):
- F5.1 emotion — `89358c6`
- F5.2 topic — `541d0f7`
- F5.3 memory — `91d319e`
- F5.4 knowledge asymmetry + buildDialogueContext — `4c6ac82`

F6 (concluída):
- F6.1 conversation opportunity — `48e83ba`
- F6.2 seleção no autonomy tick — `502f998`
- F6.3 execução de envelope a partir da oportunidade (AI↔AI, TEST DB) — `9c1c006`
- F6.4 ponte eventos→oportunidade — `5719019`
- F6.5 evals F6-E01..E10 + full API/build + doc F6 — `1cc8562`

F7 (private groups/secrets), F8 (UI/microbehaviors), F9 (benchmark gate): não iniciadas.

## Última implementação (F6.5)
Fechamento da F6 com evals e documentação, sem novo mecanismo:
- `conversation/conversation.dialogue-f6-evals.test.ts`: evals F6-E01..E10 + agregação de métricas,
  em TEST DB com fixtures próprias e cleanup em `afterAll`. Resultados reais (todos PASS):
  E01 evento gera oportunidade (audit WORLD_EVENT, `event:<id>`); E02 personagem irrelevante
  excluído; E03 personagem relevante inicia (FULL, replyTo real); E04 AI→AI espontâneo sem USER;
  E05 reação relationship-aware (RELATIONSHIP_SIGNAL + target preservado); E06 duplicata bloqueada
  (evento + memória derivada + changes → mesma evidência, 1 audit); E07 cooldown bloqueia e libera;
  E08 stop natural sem fala adicional; E09 isolamento de Universe; E10 replay determinístico
  (plano idêntico + tick REUSED).
- `docs/post-v4-dialogue-engine-f6.md`: documento da fase (objetivo, arquitetura, F6.1–F6.5,
  fluxo, budgets, dedupe, cooldown, fingerprint/evidenceId, isolamento, AI↔AI, modos, Command
  Layer, testes/evals, resultados, limitações, riscos, decisões, próximos passos).
- Validação real: eval F6 rodada 2x verde (sem flake); subset conversation+autonomy 31 files /
  451 tests; suíte completa API 204 files / 2875 tests; `tsc --noEmit` verde; ESLint do escopo
  (conversation+autonomy) verde; build `tsc -p` verde. DEV somente leitura; TEST com cleanup;
  nenhuma migration.

## Próxima ação — F7 (exata)
Private groups/secrets. Antes de implementar: inspecionar o código real de `Conversation`/
`ConversationParticipant`/`Message` e das rotas/permissões existentes para definir o menor
recorte de privacidade (grupos privados, secrets por grupo) sem novo writer/pipeline; manter
Command Layer como writer único e Context Assembly com apenas contexto autorizado. DEV read-only;
TEST com fixtures/cleanup; um commit por subfase; atualizar este HANDOFF ao final.

## Decisões F6 (tomadas)
- Iniciativa automática só em GUIDED/FULL; OFF não executa; OBSERVER audit-only; GUIDED sem
  execução de envelope; FULL executa envelope via pipeline F3–F5; PAUSED/STOPPED/REUSED não
  executam.
- `AUTONOMY_MAX_CONVERSATIONS_PER_TICK=2` (env-configurável); envelope respeita também
  `AUTONOMY_MAX_ACTIONS_PER_TICK` e `AUTONOMY_MAX_MESSAGES_PER_TICK`.
- Não criar novo SimulationTick, event bus/outbox, pipeline textual ou writer.
- Reutilizar `evaluateBehaviorDecision`, Command Layer e `simulateConversationTurn`
  (planner/realizer/validator/contexto por speaker).
- Uma oportunidade = um envelope de conversa (0..N falas, AI↔AI permitido); primeira fala vem
  da oportunidade; continuação/stop vêm do planner existente.
- Consumo da oportunidade: a seleção em memória da F6.2 (fonte do audit) é passada ao envelope
  com fingerprint/evidenceId; não recomputar `buildAutonomyOpportunityPlan` no mesmo tick.
- F6.4: evidência derivada de Event usa a raiz canônica `event:<id>` (evento, memória derivada e
  relationship change derivado convergem para o mesmo evidenceId).
- Evals F6 ficam em TEST DB, determinísticas, com cleanup completo; sem mocks de writer.

## Riscos conhecidos (F6)
- Loops A↔B entre envelopes → cooldown + fingerprint + ≤1 envelope/conversa/tick (F6.2/F6.3).
- Cascatas → janela/stop do planner + budgets de ações/mensagens/conversas do tick.
- Ticks concorrentes → fingerprint/lock do SimulationTick existente; tick repetido = REUSED.
- Duplicação → fingerprint por evidência/janela + evidenceId canônico por raiz (F6.4).
- Custo LLM → caminho autônomo sem provider; realizer determinístico default.
- Vazamento entre universos → queries escopadas + validação de participantes + F5 por speaker.
- Fingerprint de linhas derivadas de evento mudou com a canonicalização F6.4 (documentado; sem
  dados F6 em produção).
- Flake histórico 1x em `conversation.autonomous.test.ts` #13 (não reproduzido; passou isolado e
  nos reruns completos desta execução).

## Regras essenciais
Ver `AGENTS.md`. DEV read-only; TEST com cleanup; um commit por subfase; nunca amend;
atualizar este HANDOFF ao fim de cada subfase; código real prevalece sobre o handoff.

## Prompt de retomada
"Leia `docs/HANDOFF.md` e `AGENTS.md`. Valide Git (branch, HEAD, working tree). Confirme que
o HEAD é o checkpoint registrado. A F6 está encerrada (F6.1–F6.5). Não repita fases concluídas.
Execute a próxima ação descrita no HANDOFF (F7 — private groups/secrets) somente após inspecionar
o código real relevante. Rode os testes/typecheck/lint, crie um commit novo, atualize
`docs/HANDOFF.md` e pare no checkpoint verde. Não use amend."
