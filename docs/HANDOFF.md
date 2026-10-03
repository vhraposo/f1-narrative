# HANDOFF — Dialogue Engine (curto e operacional)

## Estado atual
- Branch: `v4-Living-F1-Universe`
- HEAD: `c0bbe39` — `feat(privacy): enforce event audience` (F7.3)
- Working tree: limpo (após commit deste HANDOFF)
- Última unidade concluída: F7.3 — audiência de Event
- F6 encerrada; F7.0/F7.1/F7.2/F7.3 concluídas
- Próximo checkpoint: F7.4 — F6 audience

## Roadmap (commits reais)
F5 (concluída): F5.1 `89358c6`, F5.2 `541d0f7`, F5.3 `91d319e`, F5.4 `4c6ac82`.
F6 (concluída): F6.1 `48e83ba`, F6.2 `502f998`, F6.3 `9c1c006`, F6.4 `5719019`, F6.5 `1cc8562`.
F7:
- F7.0 análise — `2207c0f`; F7.1 ACL de Conversation — `286a165`
- F7.2 audiência de memória — `6e390be`; F7.3 audiência de eventos — `c0bbe39` (concluída)
- F7.4 F6 audience — PENDENTE
- F7.5 Command Layer + validador — PENDENTE
- F7.6 evals F7 + doc — PENDENTE
F8/F9: não iniciadas.

## Última implementação (F7.3)
- Schema: `EventVisibility { PUBLIC, RESTRICTED }` + `Event.visibility @default(PUBLIC)`
  (migration `20261002140000_add_event_visibility`, `migrate deploy` em TEST, status up to date).
- `createEventWithDerivations` aceita `visibility`; `event.schema` aceita `visibility` opcional
  (create/PATCH); `event.routes` expõe `visibility` no select e escopa leitura:
  `GET /api/events` e `GET /api/events/:id` só retornam PUBLIC ou RESTRICTED com
  `createdById`/personagem do usuário/universe (helper `eventVisibilityScope`).
- `syncNewsForEvent`: evento RESTRICTED não gera NewsItem e remove notícia existente ao ser
  reclassificado.
- `context.assembly`: com `audienceCharacterId`, eventos considerados são apenas os vinculados à
  audiência, e a query exige PUBLIC ou participante da audiência; participantes do evento seguem
  completos. Sem speaker (observabilidade) mantém o pool.
- F6: audiência de evento já era imposta por `EventCharacter` (bridge/alocação só geram sinal para
  participantes do evento que também estão na conversa) — testado, sem mudança de contrato
  (fingerprint/evidenceId/budgets intactos).
- Testes: `event.visibility.test.ts` (+7): PUBLIC acessível, RESTRICTED invisível a terceiros
  (lista/GET), audiência EventCharacter, ciclo de news, contexto por audiência, F6 restricted
  (só autorizado), F6 public + replay do plano. `event.test.ts` atualizado (campo `visibility` no
  contrato de chaves). Subset events+news+world-simulation+context+generation+conversation+autonomy
  67 files / 1137 tests verde (após corrigir a expectativa de chaves; flake #13 não apareceu nesse
  run). `tsc`, ESLint eventos/news/context/generation e build verdes.

## Próxima ação — F7.4 (exata)
F6 audience (sem reconstruir o pipeline):
- auditar `autonomy.opportunities.ts`/`conversation.opportunity-bridge.ts`/`conversation.opportunity.ts`/
  `autonomy.service.ts` para garantir que uma oportunidade só exista se o speaker estiver na
  audiência da evidência (MemoryCharacter, EventCharacter, par de RelationshipChange, goal do
  próprio personagem) e que F5/F6 dedupe/fingerprint/evidenceId/cooldown/budgets não mudem;
- cobrir: PUBLIC vs RESTRICTED, Memory restricted, event-derived Memory/RelationshipChange não
  contornando audiência, A/B autorizados vs C não autorizado, isolamento de Universe, FULL/GUIDED/
  OFF/OBSERVER com audiência, replay determinístico e dedupe; E01..E10 continuam verdes;
- se não houver gap estrutural, registrar isso no HANDOFF e entregar a subfase como cobertura de
  testes + eventuais gates mínimos (sem tocar contratos F6).

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
