# Dialogue Engine — F7.0 (análise arquitetural: private groups / secrets)

## Estado
- Branch `v4-Living-F1-Universe`; HEAD inicial da análise: `8a9585f` (doc pós-F6; F6.5 em `1cc8562`).
- F6 encerrada. Esta execução é ANÁLISE: nenhum código de produção, migration, schema ou teste alterado.
- Método: leitura direta do schema Prisma, rotas, serviços, context assembly e F6. Código real prevalece.

## 1. Estado atual (resumo executivo)
- `Conversation` não tem `universeId`, `ownerId` nem `visibility`; acesso é derivado de
  `ConversationParticipant` (personagens) e a autorização de API é **user-level**: o usuário
  enxerga qualquer conversa em que **algum personagem seu** participa.
- Não existe conceito de secret/segredo/audience. O mais próximo hoje é:
  - `Memory` + `MemoryCharacter` = "quais personagens sabem desta memória";
  - `Event` + `EventCharacter` = "quais personagens participaram deste acontecimento";
  - `ExternalSourceVisibility` (PRIVATE/SHARED/PUBLIC) existe **apenas** para fontes externas de
    research, não para narrativa.
- Há **dois caminhos de contexto** com garantias diferentes:
  1. F3–F5 (`simulateConversationTurn`): retrieval **por speaker** (`retrieveRelevantMemories` por
     `characterId`) + `knowledgeContext` assimétrico — autorizado por `MemoryCharacter`.
  2. Legado (`executeTurn` → `assembleContext` → `generation.assembly`): **pool compartilhado** de
     memórias e eventos de todos os participantes; só persona/pilot/relationships são por speaker.
- F6 respeita `ConversationParticipant` e Universe para selecionar/envelopar, mas não existe
  audiência/visibilidade a respeitar.

## 2. Modelo atual (referências)
- `Conversation` — `prisma/schema.prisma:1099`: id, title, type (GROUP/DM), status
  (ACTIVE/PAUSED/COMPLETED/CANCELLED), participants, messages, ragFrames. Sem universe/owner/visibility.
- `ConversationParticipant` — `:1114`: (conversationId, characterId, joinedAt), único por par.
- `Message` — `:1132`: conversationId, senderType (USER_CHARACTER/AI_CHARACTER/SYSTEM),
  characterId?, content, contextJson, createdAt. Sem visibility/audience.
- `Memory` — `:1152`: universeId?, eventId?, experienceId?, timelineEventId?, derivedKey,
  importance, source, content/summary/context, participants (`MemoryCharacter`).
- `MemoryCharacter` — `:1194`: (memoryId, characterId). **É o grant de conhecimento existente.**
- `Relationship` — `:1210`: par simétrico + dimensions JSON; `RelationshipChange` guarda
  dimensão/delta/sourceType/sourceId/fingerprint (sem visibility).
- `Event` — `:1236`: global (sem universeId), createdById?, worldDate, payload; participantes via
  `EventCharacter` (`:1262`). De facto a audiência é `createdBy ∪ participants`.
- `Character` — `:319`: userId?, universeId?, controlledBy (USER/AI). `User` — `:187`: 1 Universe
  (`Universe.userId @unique`).

## 3. Autorização atual (mapa real)
- Conversas (rotas): helper `accessibleConversationId` = existe `ConversationParticipant` com
  `character.userId === userId`:
  - `conversation.routes.ts:79-88`; `conversation-turn.routes.ts:18-27`;
    `conversation-turn-stream.routes.ts:30-34`; `context.routes.ts:20-29`;
    `conversation-autonomous.routes.ts:26-32` (`accessibleConversation`).
- Criação de conversa: `conversation.routes.ts:190-276` exige apenas `ownsAny` (ao menos um
  personagem do caller) e **não valida ownership/universe dos demais participantes**
  (`:213-235`, `:247-253`). Consequência: é possível incluir UUID de personagem de outro
  usuário/universe; a partir daí o outro usuário passa a enxergar a conversa e as mensagens.
- Adicionar participante: `conversation.routes.ts:419-479` — após o check de acesso, aceita
  **qualquer** `characterId` (`:449-467`), sem checar universo/ownership.
- Mensagens: `conversation.routes.ts:524-580` — acesso user-level + `validateMessageSender`
  (`:90-161`) valida sender (USER dono / AI / SYSTEM sem remetente). `SYSTEM` pode ser criado em
  qualquer conversa acessível.
- Memórias: `memory.routes.ts` usa `isOwnedByUser` (`:81-87`), `characterAccessible` (`:92-109`,
  aceita personagem próprio, AI do próprio Universe ou catálogo global) e `accessibleMemoryId`
  (`:114-123`, user possui ≥1 participante da memória).
- Eventos: `event.routes.ts` `findMutatableEventId` (`:69-89`) restringe mutação a criador/
  personagens do usuário/universe (ou ADMIN); **`GET /api/events` (`:96-117`) não tem filtro de
  escopo algum** (só type/importance opcionais) — qualquer usuário autenticado lista todos os eventos.
- Relacionamentos: rotas escopadas por `characterA/B.userId`; `RelationshipChange` não é exposto
  em rota dedicada.
- Autonomia: `autonomy.service.ts` (rotas) usa `ensureUniverse` + owner do Universe.

Conclusão: **existir participação = autorização**. Não há distinção entre "membro", "dono",
"público" ou "autorizado a saber um fato".

## 4. Fluxo de contexto atual e quem decide o que um personagem pode saber
- Caminho F5 (autorizado por personagem):
  - `conversation.simulation.ts` monta contexto por speaker (retrieval por `characterId`) e
    `conversation.dialogue-context.ts:57-76` (`buildDialogueKnowledgeContext`) só inclui fatos de
    memórias autorizadas (participante + universe).
  - `memory.retrieval.ts:33-50`: `status ACTIVE`, `participants.some.characterId = speaker`,
    `universeId ∈ {do universo, null}`. É a fronteira de conhecimento efetiva hoje.
- Caminho legado (pool compartilhado):
  - `context.assembly.ts:241` `assembleContext` recebe apenas `conversationId`/`userId` (sem
    checar membership internamente; o caller checa).
  - Memórias: `:348-419` — união de `MemoryCharacter` de **todos** os participantes, sem filtro
    por speaker; `selectedMemories` vira `context.memories`.
  - Eventos: `:421-460` — união de `EventCharacter` de todos os participantes.
  - `generation.assembly.ts`: `sectionMemories`/`sectionEvents` (`:482-492`, `:760-761`) injetam
    esse pool no prompt de **qualquer** speaker; persona/pilot/relationships são por speaker
    (`:307-345`, `:396-425`).
  - Endpoint de observação `GET /api/conversations/:id/context` (`context.routes.ts:31-70`) devolve
    o pool compartilhado a qualquer usuário com ≥1 personagem participante.
- Decisão: **no F5 quem decide é `MemoryCharacter`; no caminho legado ninguém decide** — o pool é
  compartilhado entre os participantes da conversa.

Pontos onde um secret poderia escapar hoje:
1. Prompt do caminho legado (memórias/eventos compartilhados entre speakers).
2. `GET /api/conversations/:id/context` (pool bruto).
3. `GET /api/memories` (qualquer participante lê a memória inteira, incluindo `context`).
4. `GET /api/events` (global, sem escopo).
5. `Message.contextJson` (metadados de geração persistidos e devolvidos no select de mensagens).
6. F6: seleção/envelope usam participantes como audiência, mas não existe visibilidade formal.

## 5. F6 — onde privacidade entra
- Seleção: `autonomy.opportunities.ts:334-366` (conversa ACTIVE, ≥2 participantes, todos do mesmo
  universe, com AI autônomo). Não há filtro de visibilidade.
- Ponte: `conversation.opportunity-bridge.ts` gera sinal para `characterIds` que estão
  simultaneamente na conversa e na evidência (evento/memória/relationship). De facto a
  evidência já limita quem pode iniciar.
- Envelope: `autonomy.service.ts:137-165` revalida conversa ACTIVE, speaker/target participantes
  e todos no mesmo universe; `:442` usa o `userId` do owner.
- Riscos: (a) conversa privada inexistente hoje; se F7 criar visibilidade, a seleção precisa
  filtrar; (b) evento/memória "privados" sem audiência formal podem gerar sinal se um personagem
  não autorizado constar como participante por engano; (c) envelope AI↔AI herda os participantes
  da conversa — a audiência é a conversa, não a evidência.

## 6. Conceitos existentes comparáveis a secret
- `MemoryCharacter`: **grant de conhecimento implícito** (quem sabe). Já é usado pelo F5.
- `EventCharacter`: audiência do acontecimento (quem participou).
- `Memory.context`/`derivedKey`/`source`: metadados; `Memory.source` (CanonSource) não é ACL.
- `RelationshipChange`: derivado interno; sem exposição direta.
- `ExternalSourceVisibility`: apenas research externo; não reutilizar para narrativa (semântica
  diferente: fontes, não personagens).
- Não existe `Secret`, `KnowledgeGrant`, `Audience`, `visibility` narrativo. Porém, **um secret
  pode ser representado hoje por `Memory` restrita a `MemoryCharacter` de A (fato conhecido por A)**
  — a lacuna é de **enforcement**, não de modelo, na maioria dos cenários.

## 7. Alternativas arquiteturais
Critérios: complexidade, migrations, segurança, impacto F5/F6/F8/F9, risco de vazamento, teste,
determinismo, compatibilidade.

A. Somente `ConversationParticipant` como ACL.
- Complexidade baixa; sem migration. Cobre "quem está na conversa", mas **não** modela
  conhecimento (secret conhecido por A sem estar em conversa), não corrige o pool legado, não
  escopa `/api/events`, e mantém criação de conversa cross-universe. Risco alto de vazamento.
- Veredito: insuficiente sozinha.

B. Visibilidade/audience na `Conversation`.
- Migration aditiva (`visibility`, enum) + enforcement. Resolve grupos privados e listagem.
- Não resolve secrets (fato pode vazar dentro da conversa via pool legado e via APIs de memória/
  evento). Risco médio-alto se aplicada sozinha.
- Veredito: necessária para grupos, insuficiente para secrets.

C. Modelo explícito `Secret`/`KnowledgeGrant`.
- Modela conhecimento com proveniência/expiração; migration média/grande.
- Duplica `MemoryCharacter` (que já é um grant) se usado para memórias; sem Conversation ACL não
  fecha grupos; exige integração em retrieval/knowledge/APIs/F6 e validador.
- Veredito: só se houver requisito real de proveniência/confiança/expiração (F7.x futuro);
  prematuro agora.

D. Combinar Conversation ACL + grants de conhecimento (reuso de `MemoryCharacter`/`EventCharacter`).
- Conversation: enforcement de criação/participação/listagem + `visibility` explícita.
- Conhecimento: formalizar `MemoryCharacter` como audiência autorizada e aplicar em **todos** os
  caminhos de contexto (F5 já ok; corrigir legado/APIs); eventos com audiência formal
  (`createdBy ∪ EventCharacter` + `visibility` para não quebrar o comportamento global atual).
- Complexidade média; migrations aditivas pequenas; fecha os caminhos de vazamento reais;
  preserva F5/F6 (fingerprint/evidenceId intactos) e determinismo.
- Veredito: **recomendada**.

E. Outra (indicada pelo código): tratar `Memory` como portadora canônica de secret e `Event` como
  acontecimento com audiência, sem novo agregado `Secret`, enquanto não houver requisito de
  proveniência/expiração. É a forma pragmática da D; um `KnowledgeGrant` só seria justificado se
  o secret precisar existir sem um `Memory`/`Event` ou com confiança/expiração por grant.

## 8. Recomendação
**D (combinada), implementada em fatias**, com estas decisões:
1. ACL de conversa explícita e enforcement de criação/participação (ownership/universe), com
   `Conversation.visibility` aditiva (default preserva o comportamento atual: participants-only).
2. Conhecimento: `MemoryCharacter` é a autoridade de "quem sabe"; corrigir o caminho legado para
   filtrar por speaker/audiência e escopar as APIs de memória.
3. Eventos: audiência formal (`createdById ∪ EventCharacter`) e `Event.visibility` aditiva com
   default que preserva o comportamento global atual (público), permitindo eventos restritos.
4. F6: seleção, ponte e precondition do envelope passam a respeitar a visibilidade da conversa e a
   audiência da evidência, sem alterar fingerprint/evidenceId nem budgets.
5. Autorização nunca via LLM; Command Layer valida audiência antes de escrever; opcionalmente o
   OUTPUT VALIDATOR ganha uma guarda determinística de termos de secrets não autorizados
   (bounded), mas a defesa primária é não incluir o secret no contexto.

## 9. Justificativa
A, sozinha, deixa o vazamento principal (pool de memórias no caminho legado + APIs globais).
B, sozinha, cria grupos privados sem garantir que um fato conheça apenas seu dono.
C é prematura e duplicaria `MemoryCharacter`. D usa o que o domínio já tem (`MemoryCharacter`/
`EventCharacter`), fecha os caminhos reais, mantém a arquitetura (DOMAIN/planner/realizer/
validator/Command Layer) e é testável de forma determinística, sem delegar autorização ao LLM.

## 10. Modelo de dados proposto (mínimo)
Aditivo e compatível:
- `enum ConversationVisibility { PRIVATE, UNIVERSE }` e `Conversation.visibility @default(PRIVATE)`.
  - `PRIVATE`: hoje (somente participantes listados). `UNIVERSE`: personagens do mesmo universe
    podem ser adicionados/são elegíveis (uso futuro de grupos abertos). Não criar `PUBLIC` global
    enquanto não houver descoberta entre universes.
- `enum EventVisibility { PUBLIC, RESTRICTED }` e `Event.visibility @default(PUBLIC)`.
  - `PUBLIC`: comportamento atual (news/global). `RESTRICTED`: visível a `createdBy` +
    `EventCharacter` do universe. Secret narrativo = Event RESTRICTED com participantes definidos
    e/ou Memory restrita por `MemoryCharacter`.
- Sem mudanças em `Memory`/`MemoryCharacter`/`Message`/`Relationship`.
- `Secret`/`KnowledgeGrant` NÃO agora; documentar gatilho: necessidade de proveniência,
  confiança, expiração ou conhecimento sem `Memory`/`Event` correspondente.

## 11. Migrations necessárias (quando implementar)
- F7.1: `ConversationVisibility` + coluna default PRIVATE (aditiva).
- F7.3: `EventVisibility` + coluna default PUBLIC (aditiva).
- Nenhuma migração destrutiva; nenhuma alteração de índices obrigatória. Validar em TEST; DEV read-only.

## 12. Pontos exatos de integração
- `conversation.routes.ts`: criar/adicionar participante (ownership+universe+visibility),
  listar/ler (membership + visibility), `SYSTEM` message.
- `memory.routes.ts`: `accessibleMemoryId`/listagem passam a exigir personagem autorizado
  (já é o critério) e não expor `context` sensível fora da audiência.
- `event.routes.ts`: `GET /api/events` escopado (`createdById`/`EventCharacter`/universe) e
  `Event.visibility`.
- `context.assembly.ts` + `generation.assembly.ts`: filtrar memórias/eventos por speaker/audiência
  ou desabilitar o pool compartilhado para conteúdo RESTRICTED.
- `conversation.simulation.ts` `loadPlanInput` e `conversation.autonomous.ts`: checar
  visibilidade/audiência além do ownership.
- `autonomy.opportunities.ts` (filtro da conversa + ponte) e `autonomy.service.ts`
  `validateEnvelopeConversation` (visibility/audience).
- `behavior.commands.ts` (RESPOND/SEND_MESSAGE/etc.): revalidar conversa/audiência antes de
  escrever (Command Layer).
- `conversation.dialogue-output.ts`: guarda determinística opcional de termos de secret.

## 13. Impacto F5
- Retrieval já é por speaker; `buildDialogueKnowledgeContext` já filtra. Impacto baixo: apenas
  declarar `MemoryCharacter` como audiência formal e cobrir com testes; nenhuma mudança de
  algoritmo. Nenhum secret entra no `knowledgeContext` fora da audiência.

## 14. Impacto F6
- Adicionar filtro de visibilidade da conversa na seleção e no precondition do envelope; garantir
  que a ponte só gere sinal para personagens na audiência da evidência (já próximo disso).
- Fingerprint/evidenceId/budgets/cooldown permanecem; E01..E10 devem continuar verdes.
- Novo teste: evento RESTRICTED não gera oportunidade para personagem externo.

## 15. Impacto F8
- DTOs de conversa passam a expor `visibility`; listagem filtra privadas; UI precisa de badges e
  fluxo de entrada em grupo privado. Nenhuma decisão de autorização na UI (server-side).

## 16. Impacto F9
- Cenários de benchmark devem incluir tentativas de acesso não autorizado (API e contexto) e
  verificar que o planner/realizer não recebem conteúdo restrito; determinismo preservado
  (ACL determinística, sem LLM).

## 17. Estratégia de testes (mapa dos cenários exigidos)
- Personagem autorizado vê secret: F7.2 (retrieval/knowledge) e F7.4 (oportunidade).
- Não autorizado não vê: F7.2 (contexto/API) e F7.4 (seleção).
- Grupo privado vê conteúdo; fora do grupo não vê: F7.1 (ACL).
- Conversa privada não aparece para não autorizado: F7.1.
- Memória privada não entra no contexto errado: F7.2 (F5 e legado).
- `knownFacts` sem secret não autorizado: F7.2.
- Evento privado não cria oportunidade para externo: F7.3/F7.4.
- Oportunidade F6 respeita audience: F7.4.
- AI→AI respeita audience: F7.4.
- Universe A não vaza para B: F7.1/F7.4.
- Replay determinístico: todos (E10 estendida).
- Autorização não depende do LLM: F7.5 (Command Layer + validador determinístico).
- Command Layer rejeita operação não autorizada: F7.5.
- Acesso direto à API protegido (não só UI): F7.1/F7.3 (rotas reais em TEST DB).
- Cleanup em TEST; DEV read-only.

## 18. Riscos
- O pool compartilhado do caminho legado é o vazamento mais grave; se F7 não o corrigir, secrets
  serão cosméticos.
- Vazamento semântico via LLM (parafrasear um secret recebido) — mitigar por contexto autorizado
  + guarda determinística bounded; nunca por prompt.
- Criação de conversa cross-universe/ownership hoje é possível e precisa ser fechada antes de
  qualquer feature de grupo privado.
- `GET /api/events` global expõe títulos/descrições/payloads.
- Migrations aditivas com defaults errados podem enfraquecer semântica; escolher defaults que
  preservem o comportamento atual.
- `Message.contextJson` pode carregar metadados de geração; revisar o que é persistido/devolvido.
- Performance de filtros adicionais é baixa (queries já escopadas por participante).

## 19. Perguntas em aberto
1. "Grupo privado" significa apenas participants-only (comportamento atual endurecido) ou
   universe-open (`UNIVERSE`)?
2. Secrets precisam de proveniência/confiança/expiração (justificaria `KnowledgeGrant`)?
3. Quem pode criar/editar/excluir um grupo privado: qualquer participante dono ou um owner explícito?
4. Como um secret é "divulgado" entre personagens (evento, mensagem, comando de domínio)?
5. O caminho legado (`/turn`, `/generate`) continua existindo para conversas restritas ou deve ser
   bloqueado/deprecado?
6. Guarda do validador: termos exatos/fingerprints (determinístico) é suficiente para o aceite?
7. Observabilidade/QA precisa de acesso privilegiado a conteúdo restrito (ADMIN)?

## 20. Decomposição proposta (checkpoints)
- **F7.1 — ACL de conversa**: enforcement de criação/participação (ownership+universe), listagem,
  `Conversation.visibility` (default PRIVATE), testes de acesso direto à API (cross-universe,
  personagem estranho, conversa privada oculta). Migration aditiva.
- **F7.2 — Grants de conhecimento**: formalizar `MemoryCharacter` como audiência; filtrar o pool
  do caminho legado por speaker/audiência; escopar `GET /api/memories`; testes de memória privada
  no F5 e no legado; `knownFacts` sem vazamento.
- **F7.3 — Audiência de eventos**: `Event.visibility` (default PUBLIC), `GET /api/events` escopado,
  mutação por audiência; testes de evento restrito.
- **F7.4 — F6 audience**: filtro de visibilidade na seleção e no envelope; ponte só para
  audiência; testes E-F7 (evento restrito não gera oportunidade; AI→AI respeita audience).
- **F7.5 — Command Layer + validador**: revalidação de audiência no writer; guarda determinística
  de secret no output validator; testes de rejeição e de não dependência do LLM.
- **F7.6 — evals F7 + doc**: evals determinísticas em TEST DB (autorizado/não autorizado,
  grupos, secrets, universo, replay) + `docs/post-v4-dialogue-engine-f7.md`.

Cada subfase: um commit, testes + tsc + eslint + build, HANDOFF atualizado. Nenhuma delas deve
alterar fingerprint/evidenceId da F6 nem a cadeia DOMAIN→PLANNER→REALIZER→VALIDATOR→COMMAND LAYER.
