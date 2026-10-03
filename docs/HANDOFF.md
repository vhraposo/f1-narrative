# HANDOFF — Dialogue Engine (curto e operacional)

## Estado atual
- Branch: `v4-Living-F1-Universe`
- HEAD: `9be1ff4` — `test(autonomy): cover F6 audience enforcement` (F7.4)
- Working tree: limpo (após commit deste HANDOFF)
- Última unidade concluída: F7.4 — F6 audience
- F6 encerrada; F7.0–F7.4 concluídas
- Próximo checkpoint: F7.5 — Command Layer + validator

## Roadmap (commits reais)
F5 (concluída): F5.1 `89358c6`, F5.2 `541d0f7`, F5.3 `91d319e`, F5.4 `4c6ac82`.
F6 (concluída): F6.1 `48e83ba`, F6.2 `502f998`, F6.3 `9c1c006`, F6.4 `5719019`, F6.5 `1cc8562`.
F7:
- F7.0 análise — `2207c0f`; F7.1 ACL de Conversation — `286a165`
- F7.2 audiência de memória — `6e390be`; F7.3 audiência de eventos — `c0bbe39`
- F7.4 F6 audience — `9be1ff4` (concluída)
- F7.5 Command Layer + validador — PENDENTE
- F7.6 evals F7 + doc — PENDENTE
F8/F9: não iniciadas.

## Última implementação (F7.4)
- Auditoria confirmou que a audiência no F6 já é estrutural (sem gap de contrato):
  `conversation.opportunity-bridge.ts` só emite sinal para `characterIds` ∩ participantes da
  conversa ∩ participantes da evidência (EventCharacter/MemoryCharacter/par do change); memória
  filtra `universeId`; goal do próprio personagem; envelope revalida participantes/universe.
- Nenhum código de produção alterado (contratos F6 preservados: fingerprint, evidenceId canônico,
  budgets, cooldown, fairness, tick REUSED).
- `autonomy.f7-audience.test.ts` (+7): evento RESTRICTED só para autorizado; memória privada só
  para o dono; evento + memória/change derivados não contornam audiência; isolamento de Universe;
  FULL executa envelope só do speaker autorizado; OFF/OBSERVER/GUIDED respeitam audiência sem
  envelope; replay/dedupe determinísticos (candidateCount ≥4, selected 1).
- Subset autonomy+conversation 33 files / 470 tests verde; `tsc`, ESLint autonomy e build verdes.
- Achado: canonicalização de RelationshipChange depende de `sourceType=EVENT` + `sourceId`; um
  `sourceId` divergente gera evidência própria (sem risco de segurança, apenas sem dedupe com o
  evento). Dados reais vêm de `applyEventEvolution` com sourceId correto.

## Próxima ação — F7.5 (exata)
Command Layer + validador (defesa em profundidade, sem detecção semântica de segredo):
- `behavior.commands.ts`: no handler de RESPOND/SEND_MESSAGE, exigir que o `targetCharacterId`
  (quando presente) seja participante da Conversation (hoje só valida universe do alvo);
- garantir que `executeBehaviorDecision` rejeita (REJECTED/erro controlado) tentativas com
  conversa inválida, speaker fora da conversa, target fora da conversa, universo inconsistente —
  sem criar segundo writer;
- validar que o caminho autônomo (F6) e o caminho manual/`runAutonomousConversationTurn` herdam o
  gate; mensagem legítima continua 201/EXECUTED;
- NÃO adicionar detecção semântica de segredo no output validator; manter validator estrutural;
- testes TEST DB (API + Command Layer direto) cobrindo bypass e regressão.

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
