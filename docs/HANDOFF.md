# HANDOFF — Dialogue Engine (curto e operacional)

## Estado atual
- Branch: `v4-Living-F1-Universe`
- HEAD: `286a165` — `feat(conversation): enforce universe-scoped conversation ACL` (F7.1)
- Working tree: limpo (após commit deste HANDOFF)
- Última unidade concluída: F7.1 — ACL de Conversation
- F6 encerrada (F6.1–F6.5); F7.0 (análise) concluída em `2207c0f`
- Próximo checkpoint: F7.2 — grants de conhecimento (MemoryCharacter + contexto legado + APIs)

## Roadmap (commits reais)
F5 (concluída): F5.1 `89358c6`, F5.2 `541d0f7`, F5.3 `91d319e`, F5.4 `4c6ac82`.
F6 (concluída): F6.1 `48e83ba`, F6.2 `502f998`, F6.3 `9c1c006`, F6.4 `5719019`, F6.5 `1cc8562`.
F7:
- F7.0 análise — `2207c0f` (`docs/post-v4-dialogue-engine-f7-analysis.md`)
- F7.1 ACL de Conversation — `286a165` (concluída)
- F7.2 grants de conhecimento (MemoryCharacter/contexto legado/APIs) — PENDENTE
- F7.3 audiência de eventos — PENDENTE
- F7.4 F6 audience — PENDENTE
- F7.5 Command Layer + validador — PENDENTE
- F7.6 evals F7 + doc — PENDENTE
F8/F9: não iniciadas.

## Última implementação (F7.1)
- Schema: `ConversationVisibility { PRIVATE, UNIVERSE }` + `Conversation.visibility @default(PRIVATE)`
  (`prisma/schema.prisma`). Migration aditiva
  `prisma/migrations/20261002130000_add_conversation_visibility/migration.sql` (CREATE TYPE +
  ADD COLUMN default). Aplicada e validada em TEST (`migrate deploy`; `migrate status` up to date).
  DEV não tocado.
- Decisão: **NÃO** foi adicionado `Conversation.universeId`. A fonte de verdade do Universe de uma
  Conversation continua sendo `Character.universeId` dos participantes (evita segunda fonte de
  verdade/backfill). `UNIVERSE` existe reservado e fail-closed: em F7.1 o acesso é somente
  participantes para ambos os valores (sem abrir nada). Se F7.x exigir consultas por universe,
  reavaliar com migration+backfill dedicados.
- `conversation.routes.ts`:
  - `characterCompatibleWithUniverse`: ownership (`userId === caller` ou global `null`) e universe
    (`universeId === null` ou do caller); global catalog (null+null) permitido;
  - criação: cada participante precisa ser compatível (rejeita outro usuário/universe com 404 sem
    vazar existência); mantém `ownsAny` (>=1 personagem do caller) e regras DM/GROUP/duplicados;
  - add-participante: deriva o universe da conversa dos participantes (unanimidade; >1 → 409
    `CONFLICT` para dados legados inconsistentes) e valida o novo personagem (404 se incompatível);
  - DTO de conversa passa a expor `visibility`.
- Testes: `conversation.acl.test.ts` (+12) cobre criação válida PRIVATE, cross-universe em
  criação/adición (404 + sem vínculo), personagem inexistente, personagem de outro usuário sem
  universe (legado), acesso legítimo (conversa/mensagens/participantes), bloqueio total a
  não-participante (leitura, PATCH/DELETE, mensagem, context), add por não autorizado, add
  same-universe/global AI, listagem sem vazamento, UNIVERSE fail-closed e regressão DM/duplicados.
  `conversation.test.ts` teve UM caso adaptado: o setup que adicionava personagem de outro usuário
  agora falha por design (404) e o post do outsider vira 404 (antes 403 — mais restritivo, sem
  bypass; não foi enfraquecido).
- Validação real: subconjunto conversation+autonomy+characters 35 files / 509 tests verde (com 1
  flake histórico reproduzido 1x, ver abaixo); suíte completa API 205 files / 2887 tests verde;
  `tsc --noEmit` verde; ESLint conversation verde; build `tsc -p` verde.

## Próxima ação — F7.2 (exata)
Grants de conhecimento (F7.0 seção 20), sem tocar F5/F6 fora do necessário:
- formalizar `MemoryCharacter` como audiência autorizada e garantir que TODOS os caminhos de
  contexto a respeitem: o caminho legado `assembleContext`/`generation.assembly` hoje usa pool
  compartilhado de memórias/eventos de todos os participantes (vazamento dentro da conversa) —
  filtrar por speaker/audiência ou bloquear conteúdo restrito para o caminho legado;
- escopar `GET /api/memories` (já usa participante, revisar exposição de `context`/summary);
- testes reais em TEST DB: memória privada não entra no contexto do outro speaker (F5 ok + legado),
  `knownFacts` sem secret não autorizado; cleanup;
- não criar `Secret`/`KnowledgeGrant` nesta subfase; se necessário, registrar achado e propor a
  menor mudança.

## Flake conhecido (documentado, não mascarado)
`conversation.autonomous.test.ts` #13 ("simulate-turn ... menção") falhou 1x no subset
F7.1 (primeira seleção veio characterB em vez de characterA) e passou isolado e no rerun do
subset e na suíte completa. Mecânica provável: o speaker mencionado pode ser penalizado por
RECENTLY_SPOKE/REDUNDANT_RESPONSE conforme mensagens dos testes anteriores da mesma conversa
(createdAt real vs worldDate fixo) e cair abaixo do minScore, deixando o social baseline vencer.
Hipótese de correção fora do escopo F7.1 (mexeria em scoring F3/F5). Ação: monitorar; se voltar,
tratar em subfase própria com evidência.

## Achados de infraestrutura
- `prisma migrate dev` é interativo (não roda headless) e detectou drift PRÉ-EXISTENTE entre
  schema e migrations: `Conversation_status_idx` presente no banco e ausente no schema; unique
  `Season(universeId, year)` presente no schema e ausente nas migrations; rename de index
  `ExternalBindingDriverSeason`. `migrate status` em TEST diz "up to date" (44→45). NÃO corrigir
  fora de escopo; registrar para uma futura migration de sincronização.
- `prisma generate` falhou no rename do `query_engine-windows.dll.node` (EPERM, arquivo em uso),
  mas os tipos do client foram gerados (`ConversationVisibility` presente em
  `node_modules/.pnpm/@prisma+client.../.prisma/client/index.d.ts`). Testes/tsc verdes.

## Decisões F6 (mantidas)
- Modos: OFF não executa; OBSERVER audit-only; GUIDED sem envelope; FULL executa via pipeline
  F3–F5; PAUSED/STOPPED/REUSED não executam.
- Budgets `AUTONOMY_MAX_CONVERSATIONS_PER_TICK`/`ACTIONS`/`MESSAGES`; evidenceId canônico por raiz
  (`event:<id>`); fingerprint F6.1 inalterado; Command Layer writer único.

## Riscos conhecidos
- F7: pool compartilhado do caminho legado é o maior risco de vazamento (F7.2); `GET /api/events`
  global (F7.3); guarda semântica de secret limitada (F7.5); `UNIVERSE` fail-closed até implemento.
- Conversas legadas cross-universe/inconsistentes permanecem acessíveis aos seus participantes
  (não retro-corrigidas); add-participante nelas retorna 409.
- F6: loop A↔B (cooldown/fingerprint/≤1 por conversa/tick); ticks concorrentes (REUSED).
- Flake #13 acima.

## Regras essenciais
Ver `AGENTS.md`. DEV read-only; TEST com cleanup; um commit por subfase; nunca amend;
atualizar este HANDOFF ao fim de cada subfase; código real prevalece sobre o handoff.

## Prompt de retomada
"Leia `docs/HANDOFF.md`, `AGENTS.md` e `docs/post-v4-dialogue-engine-f7-analysis.md`. Valide Git
(branch, HEAD, working tree). A F6 está encerrada, F7.0/F7.1 concluídas; NÃO repita essas fases.
Execute a próxima ação descrita no HANDOFF (F7.2 — grants de conhecimento: MemoryCharacter +
contexto legado + APIs), com testes em TEST DB e cleanup. Rode testes/typecheck/lint/build, crie
um commit novo, atualize `docs/HANDOFF.md` e pare no checkpoint verde. Não use amend."
