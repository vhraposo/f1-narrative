# F1 Narrative Universe — Roadmap Oficial

> Documento oficial de planejamento das fases futuras do F1 Narrative Universe.
> Este roadmap é adotado a partir da conclusão da **Fase 9** e é a fonte única de
> referência para o planejamento das próximas etapas.

---

## 1. Visão arquitetural

O sistema representa um **universo narrativo de Fórmula 1** no qual:

1. **Character** é o ator central do universo.
2. **User** representa a conta da aplicação (não é personagem).
3. Character pode ser controlado por **USER** ou **AI**.
4. Character pode ser piloto ou não; **DriverProfile** representa apenas o perfil
   esportivo opcional do Character.
5. Character possui personalidade/DNA, aparência, background, preferências,
   memória, relações, disponibilidade e agenda.
6. **Events** representam acontecimentos do universo.
7. **Memory** pode envolver múltiplos Characters e pode ser originada por Event.
8. **WorldState** representa a linha temporal atual do universo.
9. **Conversations** são compostas por Characters e Messages.
10. O chat futuramente utiliza o estado do universo para determinar as interações.
11. **External Research** é uma feature futura.
12. **Embeddings/RAG** são explicitamente posteriores à implementação inicial de Memory.
13. IA autônoma, scheduler, SSE, Web Search e comportamento autônomo são fases futuras.

Princípio central de ordenação: as fases seguem **dependências arquiteturais do
produto**, não a ordem das tabelas no schema. **Memory** é a fundação do contexto
narrativo.

---

## 2. Princípios de ordenação

1. Character é o ator central.
2. DriverProfile é perfil esportivo opcional do Character (não uma entidade independente).
3. User é conta da aplicação, não personagem.
4. WorldState representa o estado temporal do universo.
5. **Chat nunca é dono do WorldState** — ele o *lê*, não o controla.
6. Event representa acontecimentos do universo.
7. Memory pode envolver múltiplos Characters e pode ser originada por Event.
8. Relationship é única por par de Characters (simétrica, sem A→B e B→A).
9. RaceResult representa resultado esportivo determinístico.
10. Incidentes narrativos de corrida pertencem a **Events**, não a RaceResult.
11. **NewsItem** é derivado/relacionado a **Event**.
12. **ExternalSource** é separado de **NewsItem** (pesquisa externa ≠ notícia do universo).
13. **RAG/embeddings ficam depois de Memory** — nunca implementados junto com a Fase de Memory.
14. **IA fica separada do CRUD de Conversation** (camada de decisão/geração, não de dados).
15. Evitar abstrações criadas apenas para possibilidades futuras (criar abstração quando a fase a exigir).

---

## 3. Estado consolidado

| Fase | Escopo | Status |
|---|---|---|
| Fase 1–6 | auth, characters, drivers, teams, relationships, championship | concluídas |
| Fase 7 | Events + News | **ACCEPTED** |
| Fase 8 | WorldState | **ACCEPTED** |
| Fase 9 | Availability + Schedule | **ACCEPTED** |

O schema já possui modelos preparados — sem implementação funcional completa —
para: `Memory`, `MemoryCharacter`, `Conversation`, `ConversationParticipant`,
`Message`, `ExternalSource`.

---

## 4. Fases futuras

### 4.1 Fase 10 — Memory

**Objetivo:** tornar Memory uma fundação persistente e consultável do contexto
narrativo do universo.

**Entidades envolvidas:**
- `Memory`
- `MemoryCharacter`
- `Event` como origem opcional

**Dependências:**
- Character
- Event

**O que implementar:**
- CRUD de Memory
- associação de uma Memory a múltiplos Characters (`MemoryCharacter`)
- origem opcional por Event
- conteúdo
- resumo
- contexto estruturado
- importância
- fonte/canon conforme modelo existente
- *retrieval* **determinístico** por relações/filtros/índices

**O que NÃO implementar nesta fase:**
- embeddings
- pgvector
- RAG
- IA
- geração automática de memória
- integração automática com Chat

> Nota importante: na Fase 10, "*retrieval*" significa **somente recuperação
> determinística** por relações/filtros/índices. **Não** significa retrieval semântico.

### 4.2 Fase 11 — Conversation / Chat

**Objetivo:** criar a camada persistente de conversas entre Characters.

**Entidades envolvidas:**
- `Conversation`
- `ConversationParticipant`
- `Message`

Mensagens devem suportar remetente claramente identificável:
- `USER_CHARACTER`
- `AI_CHARACTER`
- `SYSTEM`

**Dependências:**
- Character
- Memory
- WorldState

**O que implementar:**
- criação de Conversation
- participantes
- mensagens
- leitura/persistência
- autorização de acesso
- contexto referencial do universo

**O que NÃO implementar nesta fase:**
- geração automática por IA
- agentes autônomos
- scheduler
- web search
- RAG
- embeddings
- Conversation como **proprietária do WorldState**

> Regra arquitetural: **Conversation lê o estado do universo; não é dona dele e
> não deve controlá-lo.**

### 4.3 Fase 12 — IA / Context Assembly

**Objetivo:** montar contexto narrativo e produzir comportamento/respostas de
personagens.

**Fontes de contexto:**
- Character/DNA
- Memory
- WorldState
- Conversation/Message

**Dependências:**
- Character/DNA
- Memory
- WorldState
- Conversation/Message

**O que implementar:**
- montagem de contexto (context assembly)
- seleção/ranking **determinístico inicial** de memórias
- integração com provedor de LLM
- geração de respostas
- persistência de mensagens produzidas por IA
- memória derivada quando apropriado

**O que NÃO implementar nesta fase:**
- RAG vetorial
- Web Search
- External Research
- scheduler/autonomia total
- SSE/streaming, salvo decisão posterior explícita

> Regra: IA é a camada de **decisão/geração**. Não acoplar a geração de IA ao
> CRUD estrutural de Conversation.

### 4.4 Fase 13 — External Research / RAG

**Objetivo:** adicionar pesquisa externa e recuperação semântica ao contexto do
universo.

**Entidades envolvidas:**
- `ExternalSource`
- `Memory` e seus embeddings
- infraestrutura vetorial, quando necessária

**Dependências:**
- Memory
- IA (Context Assembly) como consumidora

**O que implementar:**
- ingestão de fontes externas
- embeddings
- armazenamento vetorial
- retrieval semântico
- integração com Context Assembly

**O que NÃO implementar nesta fase:**
- fundir `ExternalSource` com `NewsItem`
- transformar `NewsItem` em fonte externa
- comportamento autônomo total sem supervisão

> Regra: `ExternalSource` representa pesquisa/fonte externa. `NewsItem` continua
> representando notícia do universo. Mantêm-se separados.

---

## 5. Matriz de dependências

```
F1–9
  ↓
F10 Memory
  ↓
F11 Conversation / Chat
  ↓
F12 IA / Context Assembly
  ↓
F13 External Research / RAG
```

Dependências específicas:

- **Character / Event → Memory** (Fase 10)
- **Character / Memory / WorldState → Conversation** (Fase 11)
- **Character / DNA / Memory / WorldState / Conversation → IA** (Fase 12)
- **Memory / IA → External Research / RAG** (Fase 13)

> **RAG NÃO deve ser implementado junto da Memory.**

---

## 6. Fronteiras arquiteturais

| Assunto | Fronteira |
|---|---|
| Memory × RAG | RAG/embeddings ficam depois de Memory; nunca junto. |
| Conversation × WorldState | Conversation lê o estado; não é dona e não o controla. |
| IA × Conversation | IA é camada de decisão/geração; não acoplada ao CRUD de Conversation. |
| ExternalSource × NewsItem | Mantidos separados; ExternalSource não é notícia do universo. |
| Abstrações futuras | Evitar abstrações criadas apenas por possibilidade futura. |

---

## 7. Critérios de conclusão

Cada fase futura, ao ser executada, deve registrar:

- **objetivo**
- **entidades**
- **dependências**
- **escopo** (o que implementar)
- **não-escopo** (o que NÃO implementar)
- **critérios de aceite**
- **backend tests**
- **typecheck**
- **lint**
- **build**
- **smoke E2E**
- **persistência/DB** quando aplicável
- **integridade DEV/TEST** quando aplicável

---

## 8. Estado atual do roadmap

| Fase | Status |
|---|---|
| Fase 1–6 | concluídas |
| Fase 7 | **ACCEPTED** |
| Fase 8 | **ACCEPTED** |
| Fase 9 | **ACCEPTED** |
| Fase 10 | **ACCEPTED** |
| Fase 11 | **ACCEPTED** |
| Fase 12 | **ACCEPTED** |
| Fase 13 | **ACCEPTED** |

Todas as fases planejadas — **10 (Memory), 11 (Conversation/Chat), 12 (IA/Context
Assembly), 13 (External Research/RAG)** — foram concluídas e aceitas. Não há
outras fases planejadas além destas.