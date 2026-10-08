# Dialogue Engine — F19 (Real-Time Presence Audit)

## F19 — ANALYSIS COMPLETE — NO IMPLEMENTATION REQUIRED

## 1. Objetivo
Avaliar o item de backlog "presença em tempo real (sessão/websocket/heartbeat)": se há consumidor,
requisito ou infraestrutura que justifique implementar, e qual seria o menor incremento coerente
com a arquitetura F3–F18. Analysis-first.

## 2. Estado Git
- Branch `v4-Living-F1-Universe`; HEAD `b992980` (F18 concluída); working tree limpo; origin
  sincronizado; sem push/merge/rebase/reset/amend. DEV read-only.

## 3. Infraestrutura encontrada (código real)
- **Sem websocket/socket.io/SSE de presença**: grep em `apps/**` só encontra o `heartbeat` do SSE
  legado de `/turn/stream` (`conversation-turn-stream.routes.ts:170`), dormente e explicitamente
  fora do escopo (F10/F13).
- **Auth**: `Session` do better-auth (`schema.prisma:266-279`: `expiresAt/createdAt/updatedAt/
  ipAddress/userAgent`) é infraestrutura de autenticação, não um recurso de presença; não há
  endpoint/UI que exponha atividade.
- **Modelo de produto single-player**: `Universe.userId @unique` (`schema.prisma:225`) — um
  universo por usuário, sem compartilhamento/multiusuário; isolamento por userId (F6/F7).
- **Personagens IA** são agentes narrativos sem conexão real; a presença de domínio é
  `CharacterAvailability` + janela `until` (F12), interpretada como aberto/fechado no planner e no
  domain gate.
- **Atividade derivável** de dados existentes: `Message.createdAt`, `Event.createdAt/worldDate`,
  `PilotExperience.occurredAt`, `Conversation.updatedAt`.
- **UI**: participantes de conversa mostram nome/controller/tipo; nenhum indicador de presença ou
  requisito de "online".

## 4. O que "presença" significaria
1. **Usuário humano**: trivially online enquanto usa o app; não há outro usuário no universo para
   observá-lo (1 universo por usuário, sem compartilhamento). Não há consumidor.
2. **Personagens IA**: "online" não é semântico; o que existe é disponibilidade declarada (F12) e
   atividade passada (mensagens/eventos). Exibir "online agora" seria inventar estado sem fonte de
   verdade.
3. **Tempo real**: só faria sentido com multiusuário/compartilhamento (não existente) ou com
   streaming de turno (decidido na F13: não implementar; streaming é transporte, nunca engine).

## 5. Decisão
**Não implementar.** Não há requisito de UX, consumidor, nem modelo multiusuário; adicionar
websocket/heartbeat criaria infraestrutura, estado e superfície de segurança sem uso. Também não
se deve criar um novo estado persistido de presença (violaria o modelo F12: intenção + derivação).

## 6. Modelo recomendado para o futuro (se houver requisito)
- **Last activity derivado on-read** (sem schema): máximo de `Message.createdAt` /
  `Event.createdAt` / `PilotExperience.occurredAt` por personagem, exibido apenas para dados que o
  visualizador já pode acessar (universo do usuário; availability continua privada do dono — F12).
- **Transporte** apenas se realmente necessário: polling do derivado é o menor custo; SSE
  (padrão já existente no legado) somente como transporte do MESMO engine; **nunca** religar
  `/turn/stream` (segunda engine/segundo writer — F10/F13) nem criar event bus/outbox.
- **Não** persistir "online/offline" de IA; se um dia existir multiusuário, definir autorização de
  exposição antes de qualquer UI.

## 7. Segurança
Nenhuma mudança de superfície. Guardrails para o futuro: presença/atividade não pode vazar dados
de universos alheios; availability permanece owner-only (404 para não-dono); nenhum ID externo
ganha autoridade por transporte.

## 8. Testes
Nenhum teste novo (sem implementação). Barreira executada: `pnpm benchmark:f9` → PASS (12/12;
ver §10 sobre o incidente de infraestrutura). Último checkpoint de código é o da F18 (API 212
files / 2961 tests 100% verde; web 519/519).

## 9. Banco
Nenhuma migration/schema change; DEV intocado; TEST não necessário além do benchmark.

## 10. Incidente de infraestrutura (registrado honestamente)
- A primeira execução do benchmark na F19 falhou 11/12 com `PrismaClientInitializationError` e
  ~53s: o **Docker Desktop estava parado** (pipe do daemon ausente) e o container
  `f1nw-postgres` não estava rodando — não era regressão de código.
- Ação: Docker Desktop iniciado (`%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe`),
  `docker compose -f docker/docker-compose.yml up -d`, healthcheck `healthy`.
- Reexecução: `F9 BENCHMARK GATE: PASS` (12/12). Nenhum teste/flake foi mascarado.

## 11. Flakes
Nenhum flake de teste nesta fase; o incidente acima é de ambiente (Docker/Postgres), não de
suíte. Históricos documentados permanecem.

## 12. Limitações
- Sem presença em tempo real (decisão); sem indicador de "última atividade" na UI (sem requisito).
- Qualquer implementação futura exigirá requisito de UX e, se multiusuário, revisão de autorização.

## 13. Achados honestos
- O item de backlog partia de "presença real" como capacidade, mas o produto é single-player: não
  existe observador para presença de usuário nem semântica de "online" para personagens IA.
- A única presença com fonte de verdade é a de domínio (F12), já integrada ao planner/domain
  gate; atividade passada é derivável sem schema novo.
- WebSocket/heartbeat seriam dívida arquitetural sem consumidor.

## 14. Decisões arquiteturais
- Presença = disponibilidade de domínio (F12) + atividade derivada (futuro, on-read); nada
  persistido além da intenção atual.
- Nenhum transporte novo; SSE legado permanece dormente; streaming segue não implementado (F13).
- Backlog de presença em tempo real **encerrado** como análise; reabrir somente com requisito de
  UX/multiusuário.

## 15. Próximo passo
Backlog restante: virtualização/performance (evals) e guarda semântica de secret. Drift (F18),
presença (F19), RACE_WEEKEND (F16), streaming (F13), atomicidades (F14/F15) e consolidação (F17)
encerrados.
