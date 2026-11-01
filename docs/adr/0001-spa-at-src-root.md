# 0001 · SPA stays at `src/`; server and shared are siblings

Status: accepted · 2026-10-31

## Context

House architecture shows the SPA under `web/` and the server under `server/`. The repo was scaffolded with the
`project` script, which puts the Vite app at the root (`src/`, `index.html`, `vite.config.ts`).

## Decision

Keep the SPA at the root. Add `server/` (Elysia + GraphQL + SQLite), `shared/` (types used by both) and `scripts/`
beside it. One `package.json`, one `tsconfig` graph: `tsconfig.app.json` (SPA + shared), `tsconfig.server.json`
(server, scripts, seed tests; Bun types).

## Consequences

- No Bun workspaces: the server is not a separate deployable.
- The SPA must not import from `server/`; the server may import from `shared/`. Enforced by the two tsconfig
  `include` lists.
- Moving to `web/` later is a mechanical rename if a second package appears.
