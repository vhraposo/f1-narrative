

# F1 Narrative Universe

Um universo narrativo da Fórmula 1 — monorepo de desenvolvimento.

## Estrutura

```text
f1-narrative-universe/
├── apps/
│   ├── web/        # Frontend: Next.js + React + TypeScript + Tailwind + shadcn/ui
│   └── api/        # Backend: Node.js + TypeScript + Fastify + Prisma
├── packages/
│   └── shared/     # Código compartilhado entre web e api
├── docs/           # Documentação do projeto
├── prisma/         # Schema e migrações do Prisma
├── docker/         # Configurações de Docker (PostgreSQL)
├── .env.example
└── README.md
```

## Stack

- **Frontend**: Next.js + React + TypeScript
- **Estilização**: Tailwind CSS
- **UI**: shadcn/ui
- **Backend**: Node.js + TypeScript + Fastify
- **Banco de dados**: PostgreSQL + Prisma
- **Gerenciador de pacotes**: pnpm (monorepo via workspaces)
- **Testes (futuro)**: Vitest + Playwright
- **Ambiente local**: Docker

## Pré-requisitos

- Node.js >= 20
- pnpm >= 9
- Docker (para o PostgreSQL local)

## Instalação

```bash
cd f1-narrative-universe
pnpm install
```

## Configuração de ambiente

Copie o arquivo de exemplo e ajuste conforme necessário:

```bash
cp .env.example .env
```

O arquivo `.env` contém a URL do banco de dados e as variáveis das aplicações. Ele é usado pelo Docker, pelo Prisma e pelas aplicações.

## Executando

### 1. Inicializar o PostgreSQL via Docker

```bash
pnpm docker:up
```

### 2. Rodar migrações do Prisma (inicial)

```bash
pnpm db:generate   # gera o Prisma Client
pnpm db:migrate    # cria o banco e as tabelas
```

### 3. Executar frontend e backend juntos

```bash
pnpm dev
```

### Executar separadamente

```bash
pnpm dev:web   # frontend em http://localhost:3000
pnpm dev:api   # backend em http://localhost:3001
```

### Autenticação e rotas

A autenticação é feita via [Better-Auth](https://better-auth.com) com e-mail e senha. O fluxo é: ao acessar a aplicação, o usuário não autenticado é redirecionado para `/login`; ali pode entrar ou seguir para `/register` para criar uma conta. Após autenticar, o usuário é direcionado para a área autenticada em `/app`, onde pode encerrar a sessão ("Sair"), voltando para `/login`. A rota `/app` é protegida: sem sessão ativa, o usuário é redirecionado para `/login`.

Rotas públicas e autenticadas:

- `/login` — entrada (pública)
- `/register` — cadastro (pública)
- `/app` — área autenticada (protegida)

Variáveis de ambiente relevantes para a autenticação (ver `.env`/`.env.example`):

- `BETTER_AUTH_URL` — URL pública da API usada pela autenticação (ex.: `http://localhost:3001`)
- `BETTER_AUTH_SECRET` — segredo usado para assinar os tokens de sessão
- `NEXT_PUBLIC_API_URL` — URL da API vista pelo navegador (ex.: `http://localhost:3001`)
- `CLIENT_ORIGIN` — origem do frontend usada no CORS (ex.: `http://localhost:3000`)

Para gerar um segredo forte em desenvolvimento:

```bash
openssl rand -base64 32
```

### Prisma Studio

```bash
pnpm db:studio
```

### Parar o Docker

```bash
pnpm docker:down
```

## Comandos úteis

| Comando | Descrição |
| --- | --- |
| `pnpm dev` | Sobe web e api em modo desenvolvimento |
| `pnpm build` | Compila todos os pacotes |
| `pnpm lint` | Executa o lint em todos os pacotes |
| `pnpm test` | Executa os testes (API: Vitest; Web: sem testes ainda) |
| `pnpm db:generate` | Gera o Prisma Client |
| `pnpm db:migrate` | Aplica/gera migrações do banco |
| `pnpm db:studio` | Abre o Prisma Studio |

## Próximos passos

Este repositório está apenas inicializado (scaffolding inicial). As funcionalidades de negócio serão adicionadas em etapas futuras.
