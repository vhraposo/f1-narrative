# HANDOFF — Dialogue Engine (curto e operacional)

## Estado atual
- Branch: `v4-Living-F1-Universe`
- HEAD: `59c1e25` — `test(privacy): complete F7 evals and documentation` (F7.6)
- Working tree: limpo (após commit deste HANDOFF)
- **F7 concluída (F7.0–F7.6)**; F6 encerrada.
- Próximo checkpoint: F8 — UI/microbehaviors (NÃO iniciada)

## Roadmap (commits reais)
F5 (concluída): F5.1 `89358c6`, F5.2 `541d0f7`, F5.3 `91d319e`, F5.4 `4c6ac82`.
F6 (concluída): F6.1 `48e83ba`, F6.2 `502f998`, F6.3 `9c1c006`, F6.4 `5719019`, F6.5 `1cc8562`.
F7 (concluída):
- F7.0 análise — `2207c0f` (`docs/post-v4-dialogue-engine-f7-analysis.md`)
- F7.1 Conversation ACL — `286a165`
- F7.2 Memory audience — `6e390be`
- F7.3 Event audience — `c0bbe39`
- F7.4 F6 audience — `9be1ff4`
- F7.5 Command Layer — `185bdef`
- F7.6 evals/doc — `59c1e25` (`docs/post-v4-dialogue-engine-f7.md`)
F8 (UI/microbehaviors), F9 (benchmark gate): não iniciadas.

## Resumo da F7 (detalhes em docs/post-v4-dialogue-engine-f7.md)
- **ACL de Conversation**: `ConversationVisibility { PRIVATE, UNIVERSE }` default PRIVATE; sem
  `Conversation.universeId` (Universe derivado dos participantes); criação/adição validadas por
  ownership+universe (404 sem enumeração); UNIVERSE fail-closed.
- **Memory audience**: `context.assembly` com `audienceCharacterId`; `generation.assembly` resolve
  speaker antes e injeta a audiência; `GET /context?characterId=` opcional; Memory APIs já
  escopadas por `MemoryCharacter`; F5 assimétrico preservado.
- **Event audience**: `EventVisibility { PUBLIC, RESTRICTED }` default PUBLIC; listagem/leitura
  escopadas; RESTRICTED sem news; contexto por audiência.
- **F6 audience**: auditoria sem gap (ponte exige participante da conversa ∩ evidência); coberto
  por testes; contratos F6 intactos (fingerprint/evidenceId/budgets/cooldown/fairness/REUSED).
- **Command Layer**: RESPOND/SEND_MESSAGE exige target participante da conversa; writer único;
  output validator permanece estrutural (sem detecção semântica de segredo).
- Migrations aditivas: `20261002130000_add_conversation_visibility`,
  `20261002140000_add_event_visibility` (aplicadas/validadas em TEST).
- Validação real: evals F7 20/20; evals F6 E01..E10 verdes; subset afetado 75 files / 1265 tests;
  suíte completa API 210 files / 2933 tests; `tsc --noEmit`, ESLint dos escopos e build verdes.
  DEV intocado; TEST com cleanup.

## Próxima ação — F8 (exata, não iniciada)
F8 — UI/microbehaviors. Antes de implementar: inspecionar o app web (`apps/web`), os contratos
expostos por `conversation.routes`/`event.routes` (agora com `visibility`) e as telas de conversa/
eventos para decidir o menor recorte (expor visibilidade/badges de grupos privados, estados de
autonomia, microbehaviors). Não criar novo writer/pipeline; autorização continua server-side.
DEV read-only; TEST com cleanup; um commit por subfase; atualizar HANDOFF.

## Flake conhecido (documentado, não mascarado)
`conversation.autonomous.test.ts` #13 (characterB antes de characterA) reproduziu 1x na F7.2,
passou isolado e em reruns; não apareceu na F7.6. Mecânica provável: penalties
RECENTLY_SPOKE/REDUNDANT_RESPONSE + timestamps reais vs worldDate fixo. Não corrigir sem
evidência de bug real.

## Achados de infraestrutura
- Drift pré-existente schema↔migrations (`Conversation_status_idx`, unique `Season(universeId,
  year)`, rename de índice `ExternalBindingDriverSeason`) — NÃO corrigido na F7.
- `prisma migrate dev` é interativo: migrations criadas manualmente e aplicadas com `migrate
  deploy` em TEST.
- `prisma generate` pode falhar com EPERM no engine DLL em uso; verificar se os tipos foram
  gerados (`node_modules/.pnpm/@prisma+client.../.prisma/client/index.d.ts`) antes de repetir.

## Limitações F7
- UNIVERSE fail-closed; `/craft` e `/context` sem `characterId` são visão owner-level;
  Memory APIs user-level; conversas legadas cross-universe não retro-corrigidas; sem detecção
  semântica de segredo; sem `Secret`/`KnowledgeGrant`.

## Riscos
- Conteúdo restrito depende de o contexto nunca ser montado sem audiência (correto por design);
  sem guarda textual. Dados legados precisam de auditoria se houver backfill futuro.
- Flake #13 permanece.

## Regras essenciais
Ver `AGENTS.md`. DEV read-only; TEST com cleanup; um commit por subfase; nunca amend;
atualizar este HANDOFF ao fim de cada subfase; código real prevalece sobre o handoff.

## Prompt de retomada
"Leia `docs/HANDOFF.md`, `AGENTS.md` e `docs/post-v4-dialogue-engine-f7.md`. Valide Git (branch,
HEAD, working tree). F6 e F7 estão concluídas; NÃO repita. A próxima fase é F8 (UI/microbehaviors)
— inspecione o código real de `apps/web` e os contratos de API antes de implementar, com testes
quando aplicável, um commit novo e atualização do HANDOFF. Não use amend."
