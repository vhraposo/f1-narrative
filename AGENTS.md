# AGENTS.md — F1 Narrative Universe

Regras permanentes para qualquer agente que trabalhe neste repositório.

## Desenvolvimento por checkpoints
O projeto é implementado em fases/subfases. Cada subfase é uma unidade independente.
Ao concluir uma subfase:
1. executar os testes relevantes (suíte de conversation + suíte afetada);
2. validar TypeScript (`npx tsc --noEmit` no pacote alterado);
3. validar ESLint do escopo alterado;
4. executar build/checks aplicáveis;
5. confirmar `git status` (working tree limpo);
6. criar UM commit novo;
7. atualizar `docs/HANDOFF.md` (estado, commit, próximo passo).

Nunca reescrever commits anteriores. Nunca usar `git commit --amend` sem autorização
explícita. Nunca `reset --hard`/`clean -fd`. Nunca push/merge/squash sem pedido.

## Continuidade de contexto
O histórico da conversa é CONTEXTO VOLÁTIL. O repositório e o Git são a fonte de verdade.
`docs/HANDOFF.md` é a memória persistente do projeto.
Ao iniciar uma nova sessão:
1. ler `docs/HANDOFF.md`;
2. validar branch/HEAD/working tree com Git;
3. comparar o handoff com o código real;
4. corrigir divergências antes de implementar.
O código real prevalece sobre qualquer documento ou resumo.

## Context budget
Não tentar concluir várias subfases só para evitar interrupção. Quando o contexto ficar
grande: concluir a unidade atual se estiver próxima do fim; caso contrário parar no último
checkpoint verde, atualizar o HANDOFF e registrar o próximo passo exato. Nunca sacrificar
correção arquitetural para "fechar" uma fase.

## Banco de dados
- DEV (`f1-narrative`): somente leitura. Nunca criar/alterar Message, Memory, Relationship,
  Decision, WorldState em DEV durante QA.
- TEST (`f1_narrative_test`): usar para fixtures/integração, sempre com cleanup.
- Migrations: somente quando realmente necessárias, justificadas e testadas em TEST.

## Arquitetura do Dialogue Engine (inegociável)
- DOMAIN decide; PLANNER decide quem/intenção/replyTo/continuidade/stop; REALIZER escreve;
  OUTPUT VALIDATOR valida; COMMAND LAYER é o writer único; CONTEXT ASSEMBLY fornece contexto
  autorizado; LLM apenas formula dentro de contratos.
- Nunca usar prompt para substituir regra de domínio. Nunca vazar contexto privado.
- `deterministic` é o default de planner/realizer; LLM atrás de flag.

## Testes
Não remover testes para fazer suíte passar. Não mascarar flake. Flakes conhecidos devem ser
reproduzidos e documentados. Full API/build só podem ser declarados verdes após execução real.

## Arquivos proibidos em commit
`opencode-109i-backup.json`, `.env`, credentials, secrets, logs, screenshots, temporários.
