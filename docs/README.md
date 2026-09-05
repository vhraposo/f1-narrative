

# F1 Narrative Universe — Docs

Este diretório contém a documentação técnica do projeto.

## Índice

- Visão geral e arquitetura (em construção)
- Convenções de código (em construção)
- Decisões de design (em construção)

## Variáveis de ambiente — Ollama (apps/api)

Geração narrativa real usa o `OllamaProvider` (endpoint OpenAI-compatible do
Ollama). O provider é selecionado no composition root (`server.ts`), nunca no
cliente:

| Variável | Default | Descrição |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | URL base do servidor Ollama |
| `OLLAMA_MODEL` | *(nenhum)* | Modelo (ex.: `llama3.2`). **Ausente → NullProvider (assembly-only)** |
| `OLLAMA_TIMEOUT_MS` | `30000` | Timeout HTTP em ms |

Comportamentos:

- Sem `OLLAMA_MODEL` → `/generate` permanece **assembly-only (200)**, como antes.
- Com `OLLAMA_MODEL` → `/generate` pode produzir `mode="generated"` (**201** + Message AI persistida).
- Configuração inválida com `OLLAMA_MODEL` presente (`BASE_URL`/`TIMEOUT_MS`) → erro no startup (fail-closed, sem fallback silencioso).
- Ollama configurado mas indisponível → servidor continua de pé; `/generate` retorna **500 PROVIDER_ERROR** sem persistir Message AI.
- `/craft` ignora sempre a leitura de env (QA assembly-only).
