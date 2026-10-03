# HANDOFF — Dialogue Engine (curto e operacional)

## Estado atual
- Branch: `v4-Living-F1-Universe`
- HEAD: `6e390be` — `feat(privacy): enforce memory audience in dialogue context` (F7.2)
- Working tree: limpo (após commit deste HANDOFF)
- Última unidade concluída: F7.2 — audiência de conhecimento (MemoryCharacter)
- F6 encerrada; F7.0/F7.1/F7.2 concluídas
- Próximo checkpoint: F7.3 — audiência de Event (`EventVisibility` + API + contexto)

## Roadmap (commits reais)
F5 (concluída): F5.1 `89358c6`, F5.2 `541d0f7`, F5.3 `91d319e`, F5.4 `4c6ac82`.
F6 (concluída): F6.1 `48e83ba`, F6.2 `502f998`, F6.3 `9c1c006`, F6.4 `5719019`, F6.5 `1cc8562`.
F7:
- F7.0 análise — `2207c0f`; F7.1 ACL de Conversation — `286a165`
- F7.2 audiência de memória — `6e390be` (concluída)
- F7.3 audiência de eventos — PENDENTE
- F7.4 F6 audience — PENDENTE
- F7.5 Command Layer + validador — PENDENTE
- F7.6 evals F7 + doc — PENDENTE
F8/F9: não iniciadas.

## Última implementação (F7.2)
- `context.assembly.ts`: `AssemblyInput.audienceCharacterId?`; seleção de memórias passa a
  filtrar por `MemoryCharacter` do speaker quando informado (fail-closed se não participante;
  também filtra `universeId null|do speaker` quando conhecido). `memoryParticipantLinks`
  separado para listar participantes da memória. Sem speaker (observabilidade `/craft`,
  `/context`) mantém o pool da conversa (owner-level).
- `generation.assembly.ts`: resolve o speaker ANTES de `assembleContext` e passa
  `audienceCharacterId`; prompt (`sectionMemories`) e `context.memories` ficam por speaker.
- `context.routes.ts`: `GET /context?characterId=` opcional valida participante (404 se não) e
  filtra por audiência; sem o parâmetro mantém a visão da conversa.
- Sem mudanças em `memory.routes.ts`/`memory.retrieval.ts`/F5/F6: MemoryCharacter já era o grant;
  APIs de memória já escopam por participante (testes de não vazamento adicionados).
- Testes: `context.memory-audience.test.ts` (+6): legado A/B assimétrico, determinismo,
  F5 retrieval+knownFacts, `/context` filtrado vs pool, APIs de memória por usuário,
  isolamento de Universe. Subset context+generation+memory+conversation+autonomy 63 files /
  1109 tests verde (após rerun; flake #13 1x, ver abaixo). `tsc --noEmit` verde, ESLint
  context/generation verde, build `tsc -p` verde. Sem migration.

## Próxima ação — F7.3 (exata)
Audiência de Event, sem event bus/outbox:
- `EventVisibility { PUBLIC, RESTRICTED }` + `Event.visibility @default(PUBLIC)` (aditivo;
  migration manual no padrão do projeto, aplicada só em TEST);
- `EventCharacter` = audiência quando `RESTRICTED`; `createdBy` também;
- `GET /api/events` escopado (public + restricted autorizados por personagens do usuário);
  mutações já escopadas (`findMutatableEventId`);
- contexto (legado/F5) não inclui evento RESTRICTED para speaker sem audiência; F6.4 bridge
  (`conversation.opportunity-bridge.ts`) e `autonomy.opportunities.ts` não geram sinal/oportunidade
  de evento RESTRICTED para personagem sem audiência; canonicalização `event:<id>` preservada;
- News pública continua; testes em TEST DB com cleanup.

## Flake conhecido (documentado, não mascarado)
`conversation.autonomous.test.ts` #13 falhou 1x no subset F7.2 (characterB antes de characterA);
passou isolado e no rerun do subset. Mecânica provável: penalties RECENTLY_SPOKE/REDUNDANT_RESPONSE
+ timestamps reais vs worldDate fixo derrubam o mencionado abaixo do minScore. Não corrigir em
F7; registrar.

## Achados de infraestrutura
- Drift pré-existente schema↔migrations (`Conversation_status_idx`, unique `Season(universeId,
  year)`, rename de índice) — não corrigir na F7.
- `prisma generate` pode falhar com EPERM no engine DLL em uso; verificar se os tipos foram
  gerados antes de repetir.
- `prisma migrate dev` é interativo: criar migration manualmente e aplicar com `migrate deploy`
  em TEST.

## Decisões F6/F7 (mantidas)
- Modos F6: OFF não executa; OBSERVER audit-only; GUIDED sem envelope; FULL executa via F3–F5;
  PAUSED/STOPPED/REUSED não executam. Budgets/evidenceId/fingerprint inalterados.
- F7.1: sem `Conversation.universeId`; Universe derivado dos participantes; `UNIVERSE` fail-closed.

## Riscos conhecidos
- Event global (F7.3); secret detection semântica não será usada como autorização (F7.5);
  conversas legadas cross-universe permanecem; flake #13.

## Regras essenciais
Ver `AGENTS.md`. DEV read-only; TEST com cleanup; um commit por subfase; nunca amend;
atualizar este HANDOFF ao fim de cada subfase; código real prevalece sobre o handoff.

## Prompt de retomada
"Leia `docs/HANDOFF.md`, `AGENTS.md` e `docs/post-v4-dialogue-engine-f7-analysis.md`. Valide Git.
F6 e F7.0–F7.2 estão concluídas; não repita. Execute a próxima ação (F7.3 — audiência de Event)
com testes em TEST DB/cleanup, tsc/eslint/build, um commit novo e atualização do HANDOFF."
