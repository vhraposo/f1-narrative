# HANDOFF — Dialogue Engine (curto e operacional)

## Estado atual
- Branch: `v4-Living-F1-Universe`
- HEAD: `8a9585f` — `docs: update handoff after F6 completion`
- Working tree: limpo (após commit deste HANDOFF)
- Última unidade concluída: F7.0 — análise arquitetural de private groups/secrets (somente docs)
- F6 encerrada (F6.1–F6.5). F7 NÃO implementada.
- Próximo checkpoint: F7.1 — ACL de conversa (enforcement + visibility aditiva)

## Roadmap (commits reais)
F5 (concluída): F5.1 `89358c6`, F5.2 `541d0f7`, F5.3 `91d319e`, F5.4 `4c6ac82`.
F6 (concluída): F6.1 `48e83ba`, F6.2 `502f998`, F6.3 `9c1c006`, F6.4 `5719019`, F6.5 `1cc8562`.
F7:
- F7.0 análise arquitetural — `docs/post-v4-dialogue-engine-f7-analysis.md` (este commit docs)
- F7.1 ACL de conversa — PENDENTE
- F7.2 grants de conhecimento (MemoryCharacter/contexto legado) — PENDENTE
- F7.3 audiência de eventos — PENDENTE
- F7.4 F6 audience — PENDENTE
- F7.5 Command Layer + validador — PENDENTE
- F7.6 evals F7 + doc — PENDENTE
F8 (UI/microbehaviors), F9 (benchmark gate): não iniciadas.

## F7.0 — resultado da análise (ler o doc completo antes de implementar)
Doc: `docs/post-v4-dialogue-engine-f7-analysis.md`.
Achados centrais do código real:
- `Conversation` não tem universe/owner/visibility; acesso é user-level via
  `ConversationParticipant` (`conversation.routes.ts:79-88` e helpers idênticos nas rotas turn/
  stream/context/autonomous). "Participar = autorizar".
- Criação de conversa só exige `ownsAny` (`conversation.routes.ts:190-276`) e NÃO valida
  ownership/universe dos demais participantes; add-participant aceita qualquer `characterId`
  (`:419-479`). Risco cross-universe/usuário real.
- Não existe secret/audience. O grant implícito é `MemoryCharacter` (quem sabe) e
  `EventCharacter` (quem participou). `ExternalSourceVisibility` é só research.
- Dois caminhos de contexto: F3–F5 por speaker (autorizado por `MemoryCharacter`,
  `memory.retrieval.ts:33-50`, `conversation.dialogue-context.ts:57-76`) e o legado
  `assembleContext` (`context.assembly.ts:348-460`) com POOL COMPARTILHADO de memórias/eventos de
  todos os participantes, injetado no prompt de qualquer speaker (`generation.assembly.ts:482-492`).
  Endpoint `GET /api/conversations/:id/context` expõe o pool.
- `GET /api/events` (`event.routes.ts:96-117`) é global sem escopo; mutação é escopada
  (`:69-89`).
- F6 seleciona conversas ACTIVE com AI participante e todos no mesmo universe
  (`autonomy.opportunities.ts:334-366`); envelope revalida (`autonomy.service.ts:137-165`), mas
  não há visibilidade/audiência a respeitar.
Recomendação: alternativa **D combinada** — endurecer ACL de conversa (ownership/universe +
`Conversation.visibility` aditiva default PRIVATE) + formalizar grants de conhecimento reusando
`MemoryCharacter`/`EventCharacter` e corrigir o pool legado/APIs + `Event.visibility` aditiva
default PUBLIC + F6 respeitar audience + Command Layer revalidando + guarda determinística
opcional no output validator. `Secret`/`KnowledgeGrant` novos NÃO agora (só com requisito de
proveniência/expiração). Migrações aditivas pequenas (2 enums + 2 colunas), sem tocar
fingerprint/evidenceId/budgets da F6.

## Próxima ação — F7.1 (exata)
ACL de conversa (primeira fatia segura):
- validar em criar/adicionar participante: todos os personagens pertencem ao universe do caller
  (e são acessíveis como em `memory.routes.ts:92-109`); bloquear UUID de outro usuário/universe;
- listar/ler conversas apenas para participantes (comportamento atual preservado) e decidir
  `Conversation.visibility` aditiva (default PRIVATE preserva o comportamento);
- testes reais em TEST DB: criação cross-universe rejeitada; personagem estranho não acessa
  conversa/mensagens; listagem não vaza; cleanup completo;
- NÃO alterar F5/F6; se precisar, apenas registrar achado. Um commit, tsc/eslint/build, HANDOFF.

## Decisões F6 (mantidas)
- Modos: OFF não executa; OBSERVER audit-only; GUIDED sem envelope; FULL executa via pipeline
  F3–F5; PAUSED/STOPPED/REUSED não executam.
- Budgets `AUTONOMY_MAX_CONVERSATIONS_PER_TICK`/`ACTIONS`/`MESSAGES`; evidenceId canônico por raiz
  (`event:<id>`); fingerprint F6.1 inalterado; Command Layer writer único.

## Riscos conhecidos
- F7: pool compartilhado do caminho legado é o maior risco de vazamento; fechar antes de prometer
  secrets. Criação cross-universe hoje é possível. `GET /api/events` global. Guarda semântica de
  secret é limitada; defesa primária é contexto autorizado (nunca prompt/LLM).
- F6: loop A↔B (cooldown/fingerprint/≤1 por conversa/tick); cascatas (stop + budgets); ticks
  concorrentes (fingerprint do SimulationTick; REUSED); flake histórico 1x em
  `conversation.autonomous.test.ts` #13 (não reproduzido).

## Regras essenciais
Ver `AGENTS.md`. DEV read-only; TEST com cleanup; um commit por subfase; nunca amend;
atualizar este HANDOFF ao fim de cada subfase; código real prevalece sobre o handoff.

## Prompt de retomada
"Leia `docs/HANDOFF.md`, `AGENTS.md` e `docs/post-v4-dialogue-engine-f7-analysis.md`. Valide Git
(branch, HEAD, working tree). A F6 está encerrada e a F7.0 (análise) concluída; NÃO repita F5/F6
nem reanalise a F7.0. Execute a próxima ação descrita no HANDOFF (F7.1 — ACL de conversa), com
testes em TEST DB e cleanup. Rode testes/typecheck/lint/build, crie um commit novo, atualize
`docs/HANDOFF.md` e pare no checkpoint verde. Não use amend."
