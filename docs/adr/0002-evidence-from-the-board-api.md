# 0002 · Evidence comes from the Board's API, never from its files

Status: proposed · 2026-11-01 · needs the Board side (eternum-board) before it works end to end

## Context

Grading an answer only against the stored reference is not enough. The reference can be incomplete or wrong, and a
student may argue something correct that it lacks. The Board (`eternum-board`) already indexes the project's documents
(501 cards, 4878 text chunks, EmbeddingGemma 2), cites sources and knows dates and codes. The Board is also going public
for other teams, so other apps will need its data too.

Reading the Board's `index.db` from MyDefense would tie us to how the Board indexes, break when it changes, and give
any app the whole corpus. The Board needs a front door.

## Decision

The Board exposes a versioned, authenticated API, and the same operations as Code Mode ops
(`@wefaber/codemode`, names `product.resource.verb`, scopes `board:read`). MyDefense is a client of it.

### HTTP contract (v1)

```
POST {board}/api/v1/evidence/search
Authorization: Bearer <app token>        scoped to one or more boards, read-only
{ "board": "eternum", "query": "…", "limit": 6 }
```

```
200 { "semantic": true,
      "passages": [{
        "id": "stable chunk id",
        "title": "Autenticación sesiones y encriptación de credenciales",
        "path": "fuentes/fs/…md",
        "url": "https://… (link a person can open) | null",
        "kind": "doc | issue",
        "code": "ADR-002 | null",
        "entrega": "E2 | null",
        "created": "ISO date | null",
        "closed": "ISO date | null",
        "text": "the chunk (≤ 1200 chars)",
        "score": 0.0
      }] }
```

Errors are plain HTTP statuses. A 4xx/5xx, a timeout (8 s) or an unexpected body means "no evidence": MyDefense then
grades against the stored reference only and says so in the UI.

### Code Mode ops (same registry as the HTTP routes)

- `board.evidence.search` (required, the call above)
- `board.card.get` (a card with its files, links and dates)
- `board.timeline.list` (what changed in a period; dates and references)

### Rules on the Board side

- Tokens are per app and per board; a private board is never readable with another board's token.
- Rate limit and audit per token. The response never includes files that need an access code on the Board.
- The Board embeds the query itself. MyDefense never talks to the embedder.
- Documents need a date (`updated`: last commit or modification). Today only issues carry `created` / `closed`.

## What MyDefense does with it

`gatherEvidence` runs two searches (the question plus the stored answer, and what the student claimed), merges by id and
hands up to 6 passages to the grader as numbered, fenced data with today's date. The grader may cite only those
numbers; anything else is dropped. Outcomes it can report: the stored answer contradicted or short (`referenceIssue`),
a claim the reference lacks but a source backs (counts as covered), and real doubt (`confidence: low` with an
`argument` that gives both sides). Without sources confidence is capped at medium.

Config: `MYDEFENSE_BOARD_URL`, `MYDEFENSE_BOARD_TOKEN`, `MYDEFENSE_BOARD_TEAMS` (`team=board,…`, default
`eternum=eternum`).

## Consequences

- Needs work in eternum-board: the endpoint, app tokens, the dates gap, and the Code Mode registry. Until then MyDefense
  runs reference-only.
- One contract serves MyDefense, other apps and agents (Code Mode), and keeps the Board free to change its index.
- Evidence is as good as the Board's index; the Board's own sources can be wrong too, which is why a doubtful case is
  argued, not decided.
