# Dialogue Engine — F14 (CREATE_EVENT & Event Command Architecture)

## F14 — COMPLETE (Opção A: pequena correção de atomicidade)

## 1. Objetivo
Determinar a autoridade única correta de criação de `Event` e se o caminho `CREATE_EVENT` do AI
Behavior a respeita — sem presumir simetria com `Message`/F11. Analysis-first; implementar apenas
mudança pequena, segura e justificável.

## 2. Estado inicial / Git
- Branch `v4-Living-F1-Universe`; HEAD `392bdff` (F13 analysis-only); working tree limpo; 3 commits
  à frente de origin (sem push).
- F10/F11/F12/F13 concluídas; DEV read-only; TEST com fixtures/cleanup.

## 3. Inventário real de writers de `Event` (produção)
| Writer | Módulo | Motivo | Autoridade | Validações | Transação |
|---|---|---|---|---|---|
| `createEventWithDerivations` | `events/event-create.ts` | writer ÚNICO: `event.create` + `eventCharacter.createMany` + `syncNewsForEvent` + `applyEventEvolution` | exige `Prisma.TransactionClient` (não cria fora de tx) | FK/unique do schema; derivations determinísticas | sempre dentro da tx do caller |
| HTTP `POST /api/events` | `events/event.routes.ts:158-176` | criação manual pelo usuário | auth + `validateEventPayloadContext` (contexto/universo) | schema zod + contexto | `prisma.$transaction` |
| World simulation | `world-simulation.tick.ts:302` | agenda/schedule vira Event | tick idempotente por janela + payload `scheduleId` | budgets, universo, schedule due | `prisma.$transaction` |
| Command Layer oficial | `behavior.commands.ts:153-189` (`executeCreateEventCommand`) | decisão oficial `CREATE_EVENT` (WORLD_ADVANCED/SCHEDULE_DUE/AUTONOMOUS_TICK) | `executeBehaviorDecision` (domain gate + fingerprint + advisory lock) | `requireAiCharacter`, target in-universe, tipos SOCIAL/PERSONAL/RELATIONSHIP | **mesma tx** do command + update da decisão (`behavior.execution.ts:234-326`) |
| AI Behavior (painel) | `ai-behavior.service.ts:276-376` (`executeCreateEvent`) | decisão legada `ai-behavior.v1` (RACE_FINISHED etc.) | claim `EXECUTING` + cooldown + `requireOwnedAiCharacter` | race/season no universo, `validateEventParticipants` (universo + ownership), dedupe por payload | **antes**: tx do Event separada do update da decisão; **depois (F14)**: uma única tx |

Writers em testes (`prisma.event.create`) são fixtures, não produção. **Não existe segundo writer
de Event**: todos os caminhos de produção usam `createEventWithDerivations`.

## 4. Arquitetura encontrada
- `Event` é entidade global sem `universeId` (como Season/Race); isolamento/visibilidade via
  `createdById` (User) + `EventCharacter` (participantes) + `visibility` (F7.3:
  `eventVisibilityScope`). Derivações (News, Memory/Relationship via `applyEventEvolution`) são
  parte do domínio e só acontecem dentro do writer compartilhado.
- O AI Behavior **não** cria Event por conta própria: usa o mesmo domain service. Ele é um
  segundo *command path* legado (decisão `ai-behavior.v1` própria), não um writer paralelo — não
  é o caso do F11 (`persistGeneratedMessage` era writer distinto).
- `Event` e `Message` são domínios distintos: Event é fato do mundo com derivações; Message é
  conversa. `CREATE_EVENT` **não** tem relação legítima com planner/realizer/validator/Dialogue
  Engine; não foi roteado para lá.
- O Command Layer oficial de comportamento já cobre `CREATE_EVENT` com fingerprint/duplicate
  check e tx única, mas produz conteúdo diferente (título/descrição por `reasonCode`) do evento
  legado do painel (comentário sobre a corrida atual com `payload.origin=ai_behavior`). Unificar
  mudaria semântica do Event exibido — não é "pequena mudança"; decisão: **não unificar**.

## 5. Invariantes derivadas do código/schema
- **Universe**: validações explícitas em todos os caminhos (race/season/participantes/target);
  IDs manipulados → 403 `TARGET_NOT_IN_UNIVERSE`/`UNIVERSE_MISMATCH`; Event sem `universeId`
  isola por criador/participantes/universo dos personagens (F7.3).
- **Character**: EventCharacter `@@unique([eventId, characterId])`, cascade; AI Behavior exige
  ator incluído nos participantes (`decideBehavior` monta `[ator, userCharacter]`), ≥2 validados,
  ownership de USER characters.
- **WorldState**: `worldDate` nullable no schema; AI Behavior usa `WorldState.currentDate`
  (fallback `new Date()` apenas se ausente); official usa `request.worldDate`; sem constraint
  temporal (passado/futuro permitidos).
- **Schedule**: Schedule ≠ Event; world-sim materializa schedules em Events com dedupe por
  `payload.simulation.scheduleId` + idempotência do tick.
- **Audience**: `visibility` (PUBLIC/RESTRICTED) + EventCharacter; RESTRICTED visível a
  criador/participantes (F7.3); payload do ai-behavior não carrega dado privado.
- **Idempotência**: AI Behavior → cooldown 30min (`AI_COOLDOWN_MS.CREATE_EVENT`) + claim lock +
  dedupe por `payload.raceId/origin/characterId` na avaliação; official → `actionFingerprint` +
  `ACTION_DUPLICATE`; world-sim → tick/janela; HTTP manual não deduplica (intencional).
- **Causalidade**: payload carrega `origin`, `raceId`, `characterId`, `decisionId`; `AiDecision`
  tem `executedEventId` + metadata de execução.

## 6. Segurança
- ACL/ownership: `requireOwnedAiCharacter` (personagem do usuário), `validateEventParticipants`
  (universo + USER characters do próprio usuário), race/season no universo (403), claim por
  personagem com advisory lock. Nenhum bypass introduzido.
- Universe isolation: cross-universe rejeitado antes do writer (teste existente + asserção nova
  de "zero Event").
- Audience: derivações e visibilidade inalteradas; nenhum payload novo exposto.
- Privilege escalation: decisão manipulada para corrida de outro universo → REJECTED, sem Event.

## 7. Atomicidade (correção F14)
Antes:
```text
claim (tx) → EXECUTING
$transaction(createEventWithDerivations)   // Event commitado
aiDecision.update(EXECUTED, executedEventId) // tx separada
```
Falha/crash entre as duas → Event sem decisão EXECUTED; retry após `FAILED` poderia duplicar
Event (cooldown não conta FAILED). Depois:
```text
claim (tx) → EXECUTING
$transaction { createEventWithDerivations; aiDecision.update(EXECUTED, executedEventId) }
```
Mesmo padrão do Command Layer oficial (`behavior.execution.ts`). Em rejeição/erro, a tx reverte
por completo (zero Event) e o catch marca REJECTED/FAILED — sem estado parcial novo.

## 8. Concorrência e idempotência
- Mesma decisão executada 2x em paralelo: claim advisory lock + `updateMany(DECIDED)` garante
  1 execução (`[200, 409]`), exatamente 1 Event — coberto por teste novo.
- Duas decisões CREATE_EVENT do mesmo personagem: cooldown 30min rejeita a segunda
  (`assertBehaviorAllowed`); dedupe por payload evita nova decisão para a mesma corrida.
- Nenhum mecanismo novo foi criado; reutilizados os existentes.

## 9. Decisão
**Opção A** — pequena correção de atomicidade no caminho legado do AI Behavior. Não foi criada
engine/abstração nova; `Event` mantém seu domínio próprio e seu writer único.

## 10. Implementação
- `ai-behavior.service.ts`: `executeCreateEvent` agora executa `createEventWithDerivations` +
  `aiDecision.update(EXECUTED, executedEventId)` na **mesma** `prisma.$transaction` e retorna a
  decisão atualizada.
- `ai-behavior.test.ts`: +1 teste de concorrência de `CREATE_EVENT`; asserção de
  `payload.decisionId`; asserção de "zero Event" na rejeição cross-universe.

## 11. Testes
- `ai-behavior`: **14/14** (antes 13; +1).
- Foco `ai-behavior + behavior + events`: **135/135** (um rerun; ver Flakes).
- API full: **212 files / 2959 tests** — 100% verde.
- Web: `tsc` verde; **70 files / 519 tests**; `next lint` OK; `next build` OK (sem alteração web).
- Regressão F11/F12: ai-behavior `dialogue-realizer`/`llmUsed=false`/Command Layer intactos;
  availability/until/worldDate intactos; F13 (sem streaming) inalterado.

## 12. Benchmark F9
`pnpm benchmark:f9` → `F9 BENCHMARK GATE: PASS` (12/12) antes e depois; thresholds intactos.

## 13. Banco
Nenhuma migration/schema change; DEV intocado; TEST com fixtures/cleanup.

## 14. Flakes
- Novo/transiente: uma execução do foco (`ai-behavior+behavior+events`, 11 files) falhou 1 teste
  sob pressão e o rerun passou 135/135; não reproduzido; suíte full 100% verde. Não atribuído à
  F14 (classe dos transientes históricos sob pressão).
- Históricos (`pilot-knowledge.provision #4`, etc.): não reproduzidos nesta fase.

## 15. Limitações
- Atomicidade é garantida estruturalmente (tx única); não há teste de injeção de falha entre as
  operações (não factível sem mocks frágeis).
- `executeSendMessage` (F11) mantém o update da decisão legada fora das txs do engine — mesma
  classe de gap, fora do escopo F14; documentado como item de alinhamento futuro.
- HTTP manual `POST /api/events` não deduplica (intencional, criação humana).
- `Event` sem `universeId` continua modelo global com isolamento por criador/participantes.

## 16. Achados honestos
- O problema do F11 (writer conflitante) **não** existe para Event: writer único desde antes.
- O AI Behavior usa o domain service correto, mas tem um command path legado próprio; unificar
  com o Command Layer oficial mudaria o conteúdo do Event (semântica visível) — não feito.
- O gap real era só a atomicidade `AiDecision ↔ Event`, corrigido com ~10 linhas.
- `payload.decisionId` e `executedEventId` fecham a causalidade decisão→Event.

## 17. Decisões arquiteturais
- `Event` tem domínio próprio; autoridade = `createEventWithDerivations` (tx obrigatória).
- `CREATE_EVENT` não passa pelo Dialogue Engine (Message ≠ Event).
- Não unificar o command path legado com `behavior.commands.ts` sem requisito de produto
  (evitaria mudança semântica do evento).
- Toda criação de Event por decisão é atômica com o estado da decisão.

## 18. Próximo passo
Backlog do HANDOFF: alinhar atomicidade de `executeSendMessage` (item pequeno futuro), presença em
tempo real (se houver requisito), performance/virtualização, derivação de RACE_WEEKEND, secret
guard e drift schema↔migrations. Streaming permanece não implementado (F13).
