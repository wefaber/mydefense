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

| Var                  | Default             | Notes                                                     |
| -------------------- | ------------------- | --------------------------------------------------------- |
| `MYDEFENSE_PORT`     | `5191`              | Loopback only (`127.0.0.1`); Nginx fronts it              |
| `MYDEFENSE_DB`       | `data/mydefense.db` | Prod: `/home/hermes/data/mydefense/mydefense.db`          |
| `MYDEFENSE_DIST`     | `dist`              | Built SPA                                                 |
| `MYDEFENSE_FILES`    | `<db dir>/files`    | Uploaded material (`<teamId>/<id>`), never in the docroot |
| `MYDEFENSE_KEY_FILE` | unset               | Server key file for accounts; keep outside the repo       |
| `NODE_ENV`           |                     | `production` turns GraphiQL off, session cookie `Secure`  |

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

F2 tables: `users`, `sessions`, `recovery_codes`, `members`, `invites`, `materials`. Authenticated reads and writes go
through `server/db/workspace.ts` (`Workspace`): non-members get `NOT_FOUND` (a private team does not exist for them),
members who are not directors get `FORBIDDEN` on writes. The last director cannot be removed or demoted. Isolation
tests: `server/db/workspace.test.ts`, `server/auth.test.ts`.

## API

`/graphql` only, via Yoga. Limits in `server/graphql/limits.ts`: depth 8, query text 4000 chars, page size clamped to
1..100, unexpected errors masked, GraphiQL outside production only. Plain HTTP: `/health`, `/ready`, static files.

Accounts: `@wefaber/accounts` (argon2id, recovery codes, no email). Session cookie `md_session` (HttpOnly, SameSite=Lax,
Path=/, Secure in production); only a sha256 of the token is stored. Auth, team, identity, invite, member and material
mutations live in `server/graphql/schema.ts`, rate limited.

Upload: `POST /api/teams/:slug/materials` (multipart `file`). Extension → mime allowlist, magic-byte check, 10 MB, 50 per
team. No download endpoint yet (F3 reads files server side).

CSRF: non-GET requests need `Origin` equal to `Host` / `x-forwarded-host`, else 403 `CROSS_SITE`; `cors: false`.
**Nginx must send `proxy_set_header Host $host;`** or every write is rejected.

Practice stays anonymous and read-only: the browser keeps progress in `localStorage`.

## Privacy

Practice stores nothing server-side. Progress (ratings, quiz tallies, last identity) lives in `localStorage` under
`mydefense-v1:<team>`. The UI says so.

## Delivery

Per house: GitOps on the WeFaber runner, blue/green (`mydefense@blue` / `@green`, ports 5191 / 5192), `/ready` on the
slot then on the real domain. Domain still to confirm with Faku. Workflow lands once the repo exists on GitHub.
