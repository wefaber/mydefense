# Architecture

Extends the WeFaber house architecture (`~/.claude/standards/ARCHITECTURE.md`). Only specifics and deviations here.
Kind: **product** (public, privacy-first).

## Shape

One Bun process: Elysia shell + GraphQL (Yoga + Pothos) at `/graphql` + static SPA + in-process jobs (F3+).

```
mydefense/
├── src/            React SPA (Vite root, kept from the scaffold; see ADR 0001)
│   ├── app/        providers, router
│   ├── features/   teams · practice
│   └── lib/        graphql client, progress store
├── server/
│   ├── index.ts    boot (config, db, migrate, listen on loopback)
│   ├── app.ts      Elysia shell: /health, /ready, /graphql, static + SPA fallback
│   ├── config.ts   env
│   ├── graphql/    schema.ts (Pothos) · limits.ts
│   └── db/         schema.ts · connection.ts · migrate.ts · catalog.ts (scoped reads) · seed-eternum.ts · migrations/
├── shared/         types shared by SPA and server
├── scripts/        dev, seed, repo checks
├── seed/eternum/   copy of lux `docs/defensa/data.js` (input of the seed only)
└── docs/           ROADMAP, adr/
```

## Ports and env

| Var              | Default             | Notes                                            |
| ---------------- | ------------------- | ------------------------------------------------ |
| `MYDEFENSE_PORT` | `5191`              | Loopback only (`127.0.0.1`); Nginx fronts it     |
| `MYDEFENSE_DB`   | `data/mydefense.db` | Prod: `/home/hermes/data/mydefense/mydefense.db` |
| `MYDEFENSE_DIST` | `dist`              | Built SPA                                        |
| `NODE_ENV`       |                     | `production` turns GraphiQL off                  |

Server env file: `~/deploy/env/mydefense.env`. Never in the repo.

## Data

SQLite (`bun:sqlite`, WAL, `foreign_keys=ON`, `busy_timeout`) + Drizzle, ULID ids. Schema in `server/db/schema.ts`;
migrations generated with `bun run db:generate` and applied at boot.

F1 tables: `teams`, `identities`, `defenses`, `sections`, `points`, `questions`, `resources`. Every table below `teams`
carries a non-null `team_id` (denormalized) and is read only through `server/db/catalog.ts`, which takes the team id
first. Isolation test: `server/db/catalog.test.ts`.

Deviation from the ROADMAP domain model: a point's question has `group = point`, not `own` / `cross`. Whether it is
"own" or "cross" depends on who is practicing (the point's owner identity), so the client derives it. Groups:
`point | bank | topic | custom`.

## API

`/graphql` only, via Yoga. Limits in `server/graphql/limits.ts`: depth 8, query text 4000 chars, page size clamped to
1..100, unexpected errors masked, GraphiQL outside production only. Plain HTTP: `/health`, `/ready`, static files.

F1 is read-only (no mutations): the browser keeps progress in `localStorage`.

## Privacy

Practice stores nothing server-side. Progress (ratings, quiz tallies, last identity) lives in `localStorage` under
`mydefense-v1:<team>`. The UI says so.

## Delivery

Per house: GitOps on the WeFaber runner, blue/green (`mydefense@blue` / `@green`, ports 5191 / 5192), `/ready` on the
slot then on the real domain. Domain still to confirm with Faku. Workflow lands once the repo exists on GitHub.
