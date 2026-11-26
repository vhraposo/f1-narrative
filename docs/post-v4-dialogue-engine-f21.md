# Dialogue Engine — F21 (Secret Semantic Guard Audit)

## F21 — COMPLETE — SMALL SECRET HYGIENE FIX

## 1. Objetivo
Fechar o último item do backlog ("guarda semântica de secret, se necessária"): determinar se
existe caminho de vazamento de secrets no runtime e aplicar apenas correção pequena e concreta.

## 2. Estado inicial / Git
- Branch `v4-Living-F1-Universe`; HEAD `fd1c8c4` (F20 concluída); working tree limpo; 3 commits à
  frente de origin; sem push/merge/rebase/reset/amend. DEV read-only.

## 3. Superfície de secrets mapeada (código real)
- `apps/api/src/config/env.ts`: schema zod com `BETTER_AUTH_SECRET`, `DATABASE_URL`,
  `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` (opcionais) e configurações não-secretas
  (URLs/timeouts). `COHERE_API_KEY` e `OLLAMA_*` são lidos via `process.env` em pontos de
  composição (`app.ts:96`, `server.ts:7`, `ollama-provider.ts`, `external-embedding-provider.ts`).
- **Nenhum secret entra em contexto/prompt/persistência**: context assembly (F5), Dialogue
  Engine, generation e Command Layer não leem `process.env` (grep: env só aparece em
  config/app/server/providers/auth). `Message.contextJson`, Memory/Event payloads carregam
  metadados de domínio, nunca env.
- **Logs**: Fastify com `logger: { level }` (sem `redact`), mas nenhum código loga env; o logger
  padrão registra método/URL/host/remoteAddress (não headers/cookies/body).
- **Erros**: rotas de domínio sanitizam (`AiBehaviorError`/`BehaviorError`/`Conversation*Error`
  com códigos; F11/F14/F15). Não há `setErrorHandler` global: 500 inesperado usa o handler padrão
  do Fastify (pode expor `error.message` de erro interno — informação de internals, não secret de
  env nos caminhos mapeados). Registrado como hardening futuro opcional.
- **Repositório**: `git ls-files` só tem `.env.example` (placeholders locais); `.env` ignorado;
  `.env.keys` ausente (dotenvx não é dependência); nenhum log/backup rastreado; arquivos proibidos
  pelo AGENTS ausentes.

## 4. Decisão
- **Nenhuma guarda semântica de runtime é necessária**: não existe caminho em que secret entre em
  conteúdo de domínio, prompt, persistência ou resposta. Criar um "detector de secret" sem
  caminho real seria abstração sem uso.
- **Correção pequena aplicada (higiene de repositório)**: `.gitignore` cobria `.env`,
  `.env.local` e `.env.*.local`, mas não variantes como `.env.production`/`.env.test`. Agora:
  `.env` + `.env.*` com negação `!.env.example` (mantém o exemplo rastreável).

## 5. Implementação
- `.gitignore`: bloco Environment passa a `/.env`, `/.env.*`, `!.env.example` (commit `609f31d`).
- Sem código de produção alterado; sem comentários novos.

## 6. Verificação
- `git check-ignore -v`: `.env`, `.env.production`, `.env.local`, `.env.test` → ignorados por
  `.gitignore:11/12`; `.env.example` → **não** ignorado (negation ok); `git status` limpo exceto
  o próprio `.gitignore`.

## 7. Testes
- Nenhum teste novo (mudança não-runtime). Barreira: `pnpm benchmark:f9` → PASS (12/12).
- Último checkpoint de código: F20 (web 519/519 + build; API 212/2961 na F18).

## 8. Banco
Nenhuma migration/schema change; DEV intocado.

## 9. Flakes
Nenhum nesta fase.

## 10. Limitações
- Tokens OAuth do better-auth ficam em `Account` (domínio de auth, criptografia em repouso não
  avaliada) — fora do escopo.
- Testes leem `BETTER_AUTH_SECRET` para forjar sessão (test-only, TEST DB).
- Sem `setErrorHandler` global: 500 inesperado pode expor mensagem interna (não secret); hardening
  opcional futuro.

## 11. Achados honestos
- A premissa "guarda semântica de secret" não se confirmou: não há caminho de vazamento no
  runtime mapeado; o único gap concreto era de higiene de `.gitignore`.
- O produto já tem sanitização de erros nos caminhos de domínio (F11/F14/F15) e o logger não
  captura headers/body.

## 12. Decisões arquiteturais
- Não criar detector/abstração de secret sem caminho real.
- Higiene de repositório como guarda preventiva (`.env.*` ignorado, exemplo preservado).
- Backlog de secret **encerrado**; reabrir apenas se surgir caminho real (ex.: novo provider que
  ecoe credenciais em erro/log).

## 13. Próximo passo
Backlog do HANDOFF esvaziado dos itens acionáveis: resta apenas paginação/virtualização do
histórico de conversas, condicionada a requisito de produto, e hardening opcional do handler
global de erros.
