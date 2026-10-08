# Dialogue Engine — F15 (SEND_MESSAGE Decision/Result Atomicity Audit)

## F15 — ANALYSIS COMPLETE — NO IMPLEMENTATION REQUIRED

## 1. Objetivo
Auditar o gap apontado no F14: o update da `AiDecision` legada em `executeSendMessage` fica fora
das transações internas do Dialogue Engine. Determinar se é gap real de atomicidade, separação
intencional correta, ou necessidade de correção pequena — sem presumir simetria com o F14.

## 2. Estado Git
- Branch `v4-Living-F1-Universe`; HEAD `2a4b6eb` (F14 concluída); working tree limpo; 5 commits à
  frente de origin; sem push. DEV read-only; TEST com fixtures/cleanup.

## 3. Fluxo real de SEND_MESSAGE (confirmado no código)
```text
AiBehaviorPanel → POST /api/ai-behavior/execute
→ executeCharacterDecision (ai-behavior.service.ts:104)
  → pré-check: requireOwnedAiCharacter + decisão DECIDED + actionType executável
  → claim tx (advisory lock ai-behavior:<characterId>):
      assertBehaviorAllowed (cooldown 5min SEND_MESSAGE + limite 5/h)
      AiDecision DECIDED → EXECUTING
  → executeSendMessage (ai-behavior.service.ts:216)
      validateMessageTarget (participação/ownership/universo)
      WorldState.currentDate obrigatório
      simulateConversationTurn(maxDepth: 1, opportunity seed {fingerprint: decision.id})
        → planner → contexto por speaker → realizer determinístico → validator
        → runAutonomousConversationTurn
          → evaluateBehaviorDecision (CONVERSATION_TURN_DUE)
          → executeBehaviorDecision (behavior.execution.ts:234-326):
              TX ÚNICA com advisory lock behavior-exec:<characterId>:
                AiDecision oficial → EXECUTING
                handler = executeMessageCommand → message.create (Command Layer)
                AiDecision oficial → EXECUTED + executedMessageId + metadata
      → fora do engine: AiDecision legada → EXECUTED + executedMessageId (service:269-273)
  → catch: AiBehaviorError → REJECTED (policyCode); erro inesperado → FAILED
```
`maxDepth: 1` ⇒ exatamente 1 mensagem por execução (reações não rodam). `recoverStaleExecutions`
marca `EXECUTING` com mais de 15min como `FAILED` + `EXECUTION_STALE`.

## 4. Autoridade de Message
- **Um único writer de produção**: `executeMessageCommand` (`behavior.commands.ts:120-145`)
  dentro da transação do Command Layer (`behavior.execution.ts`). Rotas legadas
  (`/turn`, `/turn/stream`, `/generate`, `persistGeneratedMessage`) continuam dormentes e fora do
  caminho (F10/F11/F13).
- O AI Behavior não escreve Message: apenas aciona o engine (F11) e atualiza a decisão legada.

## 5. Fronteira transacional do engine
- `executeBehaviorDecision` **abre sua própria transação** e nela persiste Message + decisão
  oficial (EXECUTED + `executedMessageId`) atomicamente. Contexto, retrieval e realizer rodam
  fora dessa tx; o realizer é determinístico e síncrono (nenhum LLM preso em transação).
- `simulateConversationTurn` executa múltiplas transações curtas (uma por step) e só retorna após
  persistir; não aceita `TransactionClient` externo e não há event sink.
- A decisão legada (`ai-behavior.v1`) é uma linha de claim/auditoria separada; seu update não
  pertence à tx do engine.

## 6. Atomicidade — o que já é garantido
- Message ↔ decisão oficial `CONVERSATION_TURN_DUE`: **atômico** (mesma tx; falha reverte ambos).
- Claim legado → EXECUTING: commitado antes da execução (necessário para concorrência).
- Update legado → EXECUTED + `executedMessageId`: fora da tx do engine (o gap em análise).

## 7. Cenários de falha (modelagem explícita)
| Cenário | Estado no banco | Retry | Duplicação? | Mecanismo |
|---|---|---|---|---|
| 1. Engine falha/rejeita antes de persistir | 0 Message; decisão oficial REJECTED/ausente; legada REJECTED/FAILED (catch) | permitido após correção | não | catch classifica |
| 2. Message commitada; update legado falha | Message + oficial EXECUTED; legada EXECUTING (catch tenta REJECTED/FAILED) | mesmo decisionId → 409 (status ≠ DECIDED); após stale 15min → FAILED, retry continua 409 | **não** | claim + pré-check + stale recovery |
| 3. Legada EXECUTED sem Message | **impossível** (update só ocorre após `simulation.executed && step`) | — | — | ordem do código |
| 4. Crash entre Message e update legado | idem cenário 2; no restart `recoverStaleExecutions` → FAILED | bloqueado | não | stale recovery |
| 5. Mesmo `decisionId` 2x simultâneo | 1 Message; 1 legada EXECUTED; outro 409 | 409 | **não** | advisory lock + `updateMany(DECIDED)` (teste F11: `[200,409]`, 1 Message) |
| 6. Duas decisões diferentes, mesmo personagem | 2ª rejeitada COOLDOWN 409 | 409 | não | cooldown 5min sobre EXECUTING/EXECUTED + advisory lock |

Resultado: não há duplicação de Message, Message órfã, retry incorreto nem estado EXECUTED sem
efeito. O único efeito do cenário 2/4 é a linha **legada** terminar FAILED embora a ação tenha
acontecido — inconsistência de auditoria, limitada ao update de uma linha imediatamente após o
retorno do engine, com recuperação determinística em 15min.

## 8. Idempotência existente
- Claim: advisory lock `ai-behavior:<characterId>` + `DECIDED → EXECUTING` (impede reexecução).
- Cooldown: `AI_COOLDOWN_MS.SEND_MESSAGE = 5min` sobre status EXECUTING/EXECUTED + limite 5/h.
- Engine: advisory lock `behavior-exec:<characterId>`, `NO_DUPLICATE_ACTION` (context fingerprint)
  e `ACTION_DUPLICATE` na decisão oficial.
- `Message` não tem unique key de dedupe (index `conversationId, createdAt`) — desnecessário: a
  idempotência é no nível da decisão, que é o contrato de execução.
- O `fingerprint: decision.id` do seed de oportunidade **não é persistido** (tipo
  `OpportunityEnvelopeSeed`; usado só para validar o seed) → não existe chave natural para
  correlacionar/ reparar a linha legada sem acoplamento ou schema novo.

## 9. Opções avaliadas
- **A (status quo)** — escolhida: fronteira do engine preservada; Message↔decisão oficial
  atômicos; linha legada é auditoria com recuperação limitada. Sem duplicação.
- **B** (produzir fora da tx e `tx { persist Message; update legada }`): exigiria o ai-behavior
  escrever a Message validada — segundo writer; **proibido**.
- **C** (passar `TransactionClient` ao engine): seguraria tx através de retrieval/realizer e
  conflita com a tx própria de `executeBehaviorDecision`; transação gigante; **proibido**.
- **D** (finalize na mesma tx da persistência): exigiria o Command Layer conhecer a decisão
  legada — acoplamento engine↔ai-behavior em 4 camadas; não é pequeno/seguro.
- **E**: nenhuma opção superior encontrada no código.

## 10. Segurança
Nenhuma mudança de código. O caminho mantém `requireOwnedAiCharacter`, universo, target,
participação, senderType, ownership da conversa e Command Layer como writer. Guardrail para
qualquer refactor futuro: nenhum `messageId`/`characterId`/`conversationId`/`universeId`
fornecido externamente pode ganhar autoridade por participar de uma transação.

## 11. Implementação
Nenhuma. Sem arquivos de código alterados.

## 12. Testes
Nenhum teste novo (sem implementação; não criar teste artificial de baixo valor). Cobertura
existente relevante: F11 `ai-behavior` 14/14 (happy path, engine rejection, ACL/target, cooldown,
concorrência `[200,409]` com 1 Message, isolamento, sanitização) e `behavior`/`conversation`
(F9/F12). Último checkpoint de código permanece o da F14: API **212 files / 2959 tests** verdes;
web 70/519 + tsc/lint/build.

## 13. Benchmark F9
`pnpm benchmark:f9` → `F9 BENCHMARK GATE: PASS` (12/12; thresholds intactos). Sem implementação,
não há "depois".

## 14. Banco
Nenhuma migration/schema change; DEV intocado; TEST não necessário nesta fase. Constatações:
`Message` sem unique de dedupe (por design); `AiDecision.executedMessageId` sem FK (referência
lógica, como `executedEventId`).

## 15. Flakes
Nenhum novo nesta fase. Históricos documentados no HANDOFF permanecem; nenhum reproduzido.

## 16. Limitações
- A linha legada pode terminar FAILED em crash window (cenário 2/4); aceito e documentado, com
  stale recovery de 15min. Não há teste de injeção de falha (não factível sem mocks frágeis).
- Não existe chave persistida ligando a decisão legada à execução oficial; correlação exigiria
  acoplamento/schema (não justificado).
- O gap do F14 (`CREATE_EVENT`) era local e foi fechado; aqui a escrita é propriedade do engine.

## 17. Achados honestos
- A separação **não** é equivalente ao F14: lá as duas escritas eram locais ao ai-behavior; aqui a
  Message pertence ao Command Layer do engine e não pode ser "puxada" para a tx do chamador sem
  violar writer único ou criar transação longa.
- A garantia forte que importa (Message ↔ decisão oficial do engine) já é atômica desde F3–F7.
- O gap residual é de auditoria da linha legada, não de efeito de domínio.
- Tentar "corrigir por simetria" levaria a acoplamento engine↔legacy ou segundo writer.

## 18. Decisões arquiteturais
- Manter a fronteira transacional do Dialogue Engine; a decisão legada é claim/auditoria com
  recuperação (`recoverStaleExecutions`), não parte da tx de persistência.
- Não introduzir segundo writer, transação longa, hook de engine ou migration.
- Documentar o comportamento como aceito; se um requisito de auditoria exata surgir, reabrir com
  desenho dedicado (ex.: registrar correlação no metadata oficial via seed — mudança de contrato
  do engine a avaliar).

## 19. Próximo passo
Backlog do HANDOFF: presença em tempo real (com requisito), performance/virtualização, derivação
de RACE_WEEKEND, secret guard, drift schema↔migrations. Streaming permanece não implementado
(F13); `CREATE_EVENT` com writer único e atomicidade corrigida (F14); `SEND_MESSAGE` auditado sem
correção necessária (F15).
