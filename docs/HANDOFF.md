# HANDOFF — Dialogue Engine (curto e operacional)

## Estado atual
- Branch: `v4-Living-F1-Universe`
- HEAD: `185bdef` — `feat(privacy): enforce command layer authorization` (F7.5)
- Working tree: limpo (após commit deste HANDOFF)
- Última unidade concluída: F7.5 — Command Layer + validator
- F6 encerrada; F7.0–F7.5 concluídas
- Próximo checkpoint: F7.6 — evals F7 + doc + fechamento

## Roadmap (commits reais)
F5 (concluída): F5.1 `89358c6`, F5.2 `541d0f7`, F5.3 `91d319e`, F5.4 `4c6ac82`.
F6 (concluída): F6.1 `48e83ba`, F6.2 `502f998`, F6.3 `9c1c006`, F6.4 `5719019`, F6.5 `1cc8562`.
F7:
- F7.0 análise — `2207c0f`; F7.1 ACL de Conversation — `286a165`
- F7.2 audiência de memória — `6e390be`; F7.3 audiência de eventos — `c0bbe39`
- F7.4 F6 audience — `9be1ff4`; F7.5 Command Layer — `185bdef` (concluída)
- F7.6 evals F7 + doc — PENDENTE
F8/F9: não iniciadas.

## Última implementação (F7.5)
- `behavior.commands.ts` (Command Layer, writer único): no handler de RESPOND/SEND_MESSAGE, além
  do `requireTargetInUniverse`, o `targetCharacterId` (quando presente) precisa ser participante
  da conversa; caso contrário `BehaviorError TARGET_NOT_PARTICIPANT` (403) e a transação é
  revertida (AiDecision vira REJECTED, sem Message).
- Sem detecção semântica de segredo no output validator (mantido estrutural, conforme decisão).
- `behavior.authorization.test.ts` (+6): speaker válido→EXECUTED; alvo fora da conversa→REJECTED
  TARGET_NOT_PARTICIPANT; alvo de outro universe→UNIVERSE_MISMATCH; alvo inexistente→
  TARGET_NOT_FOUND; API direta com remetente fora da conversa→403 sem Message; executor de turno
  autônomo não aceita speaker fora da conversa (executed false, sem Message).
- Subset behavior+conversation+autonomy 38 files / 513 tests verde; `tsc`, ESLint behavior e build
  verdes. Nenhum segundo writer criado.

## Próxima ação — F7.6 (exata)
Evals F7 + documento + fechamento:
- criar bateria F7-E01..E20 (padrão F3.5/F6, TEST DB, fixtures próprias, cleanup, determinístico)
  cobrindo ACL de conversa, MemoryCharacter/contexto legado/API, Event PUBLIC/RESTRICTED,
  F6 audience, Command Layer e isolamento de Universe;
- rodar evals F7, evals F6 (E01..E10), subset conversation/autonomy, memory/context, ACL,
  suíte completa API, `tsc --noEmit`, ESLint dos escopos alterados e build API;
- criar `docs/post-v4-dialogue-engine-f7.md` (objetivo, F7.0–F7.6, modelo de autorização,
  ACL, MemoryCharacter, EventCharacter, visibility, contexto legado, F5/F6, Command Layer,
  validator, isolamento, migrations, testes/evals, resultados, riscos, limitações, decisões,
  arquitetura final, o que NÃO foi implementado, próximos passos F8);
- marcar F7 concluída no HANDOFF e definir F8 como próximo checkpoint.

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
