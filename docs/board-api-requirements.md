# Board API and Code Mode: requirements

Brief for the session that works in `E:\Proyectos\WeFaber\eternum-board`. Written from MyDefense, the first client.
Contract source of truth: [`adr/0002-evidence-from-the-board-api.md`](adr/0002-evidence-from-the-board-api.md).

## Goal

The Board becomes a service other apps and agents can query, because it is going public for other teams. First
consumer: MyDefense, which grades oral and written defense answers against the project's own documents and needs
passages it can cite, with dates and codes. The same operations are exposed to agents as Code Mode ops.

## Where things stand

- Board code: `server/app.ts` (routes, `gate`, `sessionOf`, `sameOrigin`), `server/search.ts` (`SearchService`: cosine
  over `data/index.db` + lexical fallback, `info()`, `passages()`, `rank()`), `server/embed.ts` (embedder client with
  cache), `server/db.ts` (`AuditLog`), `server/domain.ts` (`RateLimiter`, access codes and roles).
- Today's auth is per-person access codes in a cookie session with roles; non-GET requests pass `sameOrigin`. A
  server-to-server call has no cookie and no `Origin`, so it needs its own path.
- Index: 501 cards, 4878 text chunks, EmbeddingGemma 2 (768 dims). Only issues have `created` / `closed`
  (`card.issue`); documents have no date.
- Code Mode standard: `E:\Proyectos\WeFaber\codemode` (`docs/SPEC.md`, package `@wefaber/codemode`, `defineOp`,
  names `product.resource.verb`, scopes `product:read`, two MCP tools `search` + `execute`, generated `spec.json`
  and `client.d.ts`, CI fails when stale).
- The repo's current branch is `fix/board-json-guard` with uncommitted changes that are not yours. Do not touch them.
  Use a new branch from the integration branch (check the repo's convention: `dev` → `main`), in the main folder or in
  `.claude/worktrees/<slug>` only.

## Requirements

### R1 · `POST /api/v1/evidence/search`

```
Authorization: Bearer <app token>
{ "board": "eternum", "query": "…", "limit": 6 }
```

```
200 { "semantic": boolean,
      "passages": [{ "id", "title", "path", "url"|null, "kind": "doc"|"issue", "code"|null, "entrega"|null,
                     "created"|null, "closed"|null, "updated"|null, "text": "≤1200 chars", "score" }] }
```

- `limit` default 6, max 12. `query` max 800 chars; empty query is a 400.
- Semantic ranking when the embedder answers within the existing wait; otherwise lexical, with `semantic: false`.
  Never a 5xx because the embedder is down.
- At most 2 passages per card (as `SearchService.rank` does); `id` is stable across reindexes of unchanged chunks.
- `text` is the chunk without the `title: … | text: ` prefix. `title` is the card title (what Ask Ether already shows).
- `url` is a link a person can open on the Board for that card, or null. Never a `javascript:` or relative URL.
- Documents that require an access code on the Board are not returned unless the token's scope says so (default: no).
- Errors: 401 no/invalid token, 403 token not allowed for that `board`, 400 bad body, 429 rate limited. JSON body
  `{ error: { code, message } }`, same shape as the rest of the Board's API.

### R2 · App tokens

- Tokens are per app and per board(s): `{ id, app, boards[], scope: "board:read", createdAt, revokedAt }`.
- Stored hashed (sha256), shown once at creation, revocable. A CLI script like `scripts/new-codes.ts` is enough:
  `scripts/new-app-token.ts <app> <board,…>`.
- Constant-time comparison. A private board is never readable with a token for another board.
- These routes ignore the cookie session and skip `sameOrigin` (they are not browser calls); cookie-authenticated
  routes keep working exactly as before.

### R3 · Rate limit and audit

- Per token: default 120 requests / minute, configurable. Reuse `RateLimiter`.
- Every call goes to `AuditLog` (new kind `api`): token id, app, board, query (first 600 chars), result count,
  semantic or not, ms, status. Never the token.

### R4 · Document dates

- Every card gets `updated`: last commit date of its file when the docs root is a git checkout, else file mtime.
  Written by the index build (`build/index.ts` / `board.json`), exposed on passages as `updated`.
- Issues keep `created` / `closed`.
- Needed so a grader can say "the latest decision wins" with documents, not only issues.

### R5 · Code Mode ops

Same service layer as R1, no second implementation. Registry in `services/registry.ts` with `defineOp`:

- `board.evidence.search` (the call above)
- `board.card.get` (card, files, links, dates, backlinks)
- `board.timeline.list` (cards changed or issues opened/closed in a date range, newest first)
- scope `board:read`; generated `spec.json` and `client.d.ts`; conformance suite from `@wefaber/codemode` passes.

### R6 · Multi-board readiness

- `board` in the request selects the board config (`config/<slug>.json`); an unknown board is 404.
- No Eternum-specific strings in the new code paths. Today's `config/eternum.json` stays the default.

## Out of scope

- Writing anything through the API. Read-only.
- Changing Ask Ether, the web UI, or the indexing pipeline beyond R4.
- Exposing the embedder. Clients never talk to it; the Board embeds the query.

## Acceptance

- `bun test` and `tsc --noEmit` green (`bun run verify`), with new tests for: bearer auth (missing, wrong, revoked,
  wrong board), a request with no `Origin` succeeds, limit and body validation, lexical fallback when the embedder is
  down, rate limit 429, audit row written without the token, dates present on passages, Code Mode conformance.
- Manual: with the embedder tunnel up, `curl` a query ("argon2id contraseñas") with a token and get cited passages with
  `semantic: true`; with the embedder down, the same call returns `semantic: false`.
- MyDefense end to end: set `MYDEFENSE_BOARD_URL`, `MYDEFENSE_BOARD_TOKEN` (and `MYDEFENSE_BOARD_TEAMS`, default
  `eternum=eternum`), answer a Quiz question, and the correction shows "documentos del Board" and cited sources.
- Docs: a `docs/api.md` in the Board with the contract, and the contract in ADR 0002 stays in sync.

## Order

1. R2 tokens + R1 endpoint + R3 (unblocks MyDefense). 2. R4 dates. 3. R5 Code Mode ops. 4. R6 cleanup.

## Open questions for the Board's owner

- Which Board URL does MyDefense call in production: the public one, or loopback on the same VPS?
- Do other teams' boards share one index or have their own `index.db`? Decides how `board` maps to data.
- Should access-code documents ever be served to an app token (default no)?
