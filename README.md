# Grokathon London 2026

An AI-powered data analysis platform built with [Grok](https://x.ai/) (xAI). Ask questions in natural language, and an AI agent queries your data sources — Rill Data projects, Snowflake warehouses, or raw SQL — and returns answers with full tool-call transparency.

Built at the xAI Grokathon, London 2026.

## What it does

- **Natural language data analysis** — Chat with an AI agent that writes and executes SQL, explores schemas, and synthesizes results.
- **Dual agent modes** — Switch between a *specialized* mode (11 Rill-specific tools for metrics, models, dashboards) and a *general* mode (bash + SQL for anything).
- **Snowflake integration** — Connect to Snowflake with encrypted credential storage, explore schemas, and run queries.
- **Sandbox environments** — Spin up isolated containers (via Daytona) with a web-based file browser, terminal, and code editor.
- **Streaming responses** — Agent reasoning and tool calls stream to the UI in real time via SSE.

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, TanStack Router, TanStack Query, TailwindCSS, shadcn/ui, CodeMirror |
| Backend | Hono, tRPC, Node.js |
| AI | Vercel AI SDK, xAI Grok |
| Database | SQLite/Turso, Drizzle ORM |
| Sandboxes | Daytona SDK |
| Data | Snowflake SDK, Rill Data, DuckDB |
| Monorepo | Turborepo, pnpm workspaces |

## Getting started

### Prerequisites

- Node.js 20+
- pnpm 10+

### Setup

```bash
pnpm install
cp apps/server/.env.example apps/server/.env
# Fill in your API keys (XAI_API_KEY, DATABASE_URL, etc.)
```

### Database

```bash
pnpm run db:push
```

### Run

```bash
pnpm run dev
```

- Frontend: [http://localhost:3001](http://localhost:3001)
- Backend: [http://localhost:3000](http://localhost:3000)

## Project structure

```
grokathon-london-2026/
├── apps/
│   ├── web/              # React frontend
│   └── server/           # Hono + tRPC backend
├── packages/
│   ├── agent/            # Grok AI agent, tools, and services
│   ├── api/              # tRPC routers (agent, snowflake, sandbox)
│   ├── db/               # Drizzle schema and database client
│   ├── env/              # Validated environment variables (t3-oss/env)
│   └── config/           # Shared TypeScript and Biome config
```

## Environment variables

See [`.env.example`](.env.example) for the full list. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Turso/SQLite connection string |
| `XAI_API_KEY` | Yes | xAI Grok API key |
| `CREDENTIALS_ENCRYPTION_KEY` | Yes | Encryption key for stored credentials |
| `CORS_ORIGIN` | Yes | Frontend URL |
| `DAYTONA_API_KEY` | No | For sandbox environments |
| `BROWSER_USE_API_KEY` | No | For browser automation |

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all apps in dev mode |
| `pnpm build` | Build all apps |
| `pnpm check-types` | TypeScript type checking |
| `pnpm run check` | Biome linter |
| `pnpm run db:push` | Push schema to database |
| `pnpm run db:studio` | Open Drizzle Studio |

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for Railway, Fly.io, and Docker deployment guides.
