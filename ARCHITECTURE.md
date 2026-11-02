# Architecture

Extends the WeFaber house architecture (`~/.claude/standards/ARCHITECTURE.md`). Only specifics and deviations here.
Kind: **product** (public, privacy-first).

## Shape

One Bun process: Elysia shell + GraphQL (Yoga + Pothos) at `/graphql` + static SPA + in-process jobs (F4+).

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
│   └── db/         schema.ts · connection.ts · migrate.ts · catalog.ts (scoped reads) · seed-eternum.ts (also run at every boot) · migrations/
├── shared/         types shared by SPA and server
├── scripts/        dev, seed, repo checks
├── seed/eternum/   copy of lux `docs/defensa/data.js` (input of the seed only)
└── docs/           ROADMAP, adr/
```

## Ports and env

| Var                                                                            | Default             | Notes                                                                                                                                                                                             |
| ------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MYDEFENSE_PORT`                                                               | `5191`              | Loopback only (`127.0.0.1`); Nginx fronts it                                                                                                                                                      |
| `MYDEFENSE_DB`                                                                 | `data/mydefense.db` | Prod: `/home/hermes/data/mydefense/mydefense.db`                                                                                                                                                  |
| `MYDEFENSE_DIST`                                                               | `dist`              | Built SPA                                                                                                                                                                                         |
| `MYDEFENSE_FILES`                                                              | `<db dir>/files`    | Uploaded material (`<teamId>/<id>`), never in the docroot                                                                                                                                         |
| `MYDEFENSE_KEY_FILE`                                                           | unset               | Server key file for accounts; keep outside the repo                                                                                                                                               |
| `MYDEFENSE_GITHUB_ORG`, `_CLIENT_ID`, `_CLIENT_SECRET`, `MYDEFENSE_PUBLIC_URL` | unset               | GitHub login and org-gated team creation (ADR 0004). All four or none. `PUBLIC_URL` is the site origin; the callback is `<PUBLIC_URL>/auth/github/callback`                                       |
| `MYDEFENSE_GITHUB_IMPORT_TOKEN`                                                | unset               | Turns on "Importar desde un repo": a fine-grained token with read-only Contents on the org repos (the GitHub login org). Needs the four variables above. Only fresh members of the org may use it |
| `MYDEFENSE_EMBED_URL`, `MYDEFENSE_EMBED_MODEL`                                 | unset               | The house embedder (`@wefaber/embed`, EmbeddingGemma 2), e.g. `http://127.0.0.1:8891/v1/embeddings` on the VPS. Unset: indexed sources are searched by words only                                 |
| `DEEPSEEK_API_KEY`                                                             | unset               | Turns grading on (DeepSeek); or `MYDEFENSE_LLM_URL` / `_MODEL` / `_KEY` for another endpoint                                                                                                      |
| `MYDEFENSE_BOARD_URL`                                                          | unset               | Board base URL; with `MYDEFENSE_BOARD_TOKEN` turns evidence on. `MYDEFENSE_BOARD_TEAMS` maps `team=board,…` (default `eternum=eternum`)                                                           |
| `CARTESIA_API_KEY`                                                             | unset               | Turns voice answers on (needs the LLM too); `CARTESIA_VERSION` optional                                                                                                                           |
| `NODE_ENV`                                                                     |                     | `production` turns GraphiQL off, session cookie `Secure`                                                                                                                                          |

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

F2 tables: `users`, `sessions`, `recovery_codes`, `github_links`, `members`, `invites`, `materials`; F4 knowledge: `sources`, `source_files`, `chunks` and the FTS5 table `chunks_fts` (ADR 0005), `generation_runs` (draft of the defense). Authenticated reads and writes go
through `server/db/workspace.ts` (`Workspace`): non-members get `NOT_FOUND` (a private team does not exist for them),
members who are not directors get `FORBIDDEN` on writes. The last director cannot be removed or demoted. Isolation
tests: `server/db/workspace.test.ts`, `server/auth.test.ts`.

## API

`/graphql` only, via Yoga. Limits in `server/graphql/limits.ts`: depth 8, query text 4000 chars, page size clamped to
1..100, unexpected errors masked, GraphiQL outside production only. Plain HTTP: `/health`, `/ready`, static files.

Accounts: `@wefaber/accounts` (argon2id, recovery codes, no email). Session cookie `md_session` (HttpOnly, SameSite=Lax,
Path=/, Secure in production); only a sha256 of the token is stored. Auth, team, identity, invite, member and material
mutations live in `server/graphql/schema.ts`, rate limited.

GitHub login (ADR 0004): `GET /auth/github/start` and `/auth/github/callback` in `server/github-login.ts`, OAuth through
`arctic`, scope `read:org`. The membership result is stored with `checked_at` and the OAuth token is never stored.
`createTeam` needs a member of the configured org checked within 24 h. Nginx forwards `/auth/github/*` to the app.

Upload: `POST /api/teams/:slug/materials` (multipart `file`). Extension → mime allowlist, magic-byte check, 10 MB, 50 per
team. No download endpoint yet (F4 reads files server side).

Indexed sources (ADR 0005): `POST /api/teams/:slug/materials/import` (JSON `{repo, path?, ref?}`) syncs a repo folder of the
GitHub org into `sources` / `chunks` (`server/knowledge.ts`, `server/repo-import.ts`, queries in `server/db/knowledge.ts`).
GraphQL: `Team.sources`, `searchSources(teamId, query)`, `deleteSource`.

Roles from the material: the mutation `proposeIdentities(teamId)` (director only, rate limited, needs the LLM and a source)
searches the chunks for who is on the team, asks the model for `{name, role, sectors, source, evidence}` and keeps only the
people whose `evidence` quote really appears in the passage they cite (`server/ai/roles.ts`). It creates nothing: the
director picks which ones become identities through `addIdentity`.

Defense draft (F4): `generateDefense(teamId)` (director only, 3 per hour, needs the LLM and a source, only for a team with
no points) opens a row in `generation_runs` and returns at once; the work goes on in the process
(`server/authoring.ts`). Stage 1 asks the model for an outline (sections, points, files and owner) from the file heads;
stage 2 prepares each point on its own call, 3 in parallel, from the point's files plus the index search by its title
(`server/ai/author.ts`). Codes, paths and owners are rebuilt server side, and a question survives only with a literal
`evidence` quote found in the passage it cites. A point the model fails on stays empty and marked `fill`; if every point
fails the run is `failed`. The client polls `Team.generation` (directors only) for `status`, `phase`, `done / total`.
The draft lives in `generation_runs.draft` and nothing is public until `approveDraft(teamId, runId, skip, owners)`, which
in one transaction writes sections, points and `approved` questions (`group = point`, the quote in `validatorNotes`).
`skip` holds point codes and `code#n` question ids; `owners` maps a point code to an identity key. `discardDraft` drops
it. `failStale()` at boot marks runs killed by a restart as `failed`. Real run on `eternum-docs`: 238 files, 37 points,
105 questions, about 4.5 min.

CSRF: non-GET requests need `Origin` equal to `Host` / `x-forwarded-host`, else 403 `CROSS_SITE`; `cors: false`.
**Nginx must send `proxy_set_header Host $host;`** or every write is rejected.

Answering (`server/ai/`): the student types or records an answer and `gradeAnswer(teamSlug, questionId, answer, spokenMs)`
grades it against the stored reference with any OpenAI-compatible model (`llm.ts`; DeepSeek by default). The reply is
JSON (`grading.ts`): verdict Completa / Parcial / Insuficiente, content / terminology / structure 0..4 (the official
"Aspectos a evaluar"), covered / missing / unsupported, feedback. The answer is fenced as data and cannot close its
fence; the reference is the only truth, so claims it does not back land in `unsupported`. Spoken answers also get pace
(words per minute) and filler words, computed from the transcript. An unusable model reply is an error, never a guess.
Limits: 30 per 10 min per client, 2000 per day overall. `capabilities { grading voice }` tells the SPA what to show.

Evidence: grading also checks the answer against the project's own documents, not only the stored reference. MyDefense
asks the Board's API (`server/ai/evidence.ts`, contract in `docs/adr/0002`), never its files: two searches (question
plus stored answer, and the student's claims), up to 6 passages, numbered and fenced as data with today's date. The
grader may cite only those numbers (others are dropped) and can say the stored answer is contradicted or short
(`referenceIssue`), accept a claim a source backs, or, when the evidence does not settle it, answer with
`confidence: low` and an `argument` with both sides. Without sources confidence never exceeds medium. If the Board is
unreachable grading falls back to the stored answer and the UI says so.

Simulacro (`src/lib/simulacro.ts`, `SimulacroView`): a mock defense built client-side from the practice payload: one
question per own point in presentation order, then cross questions, 5 / 8 / 12 questions, 60 / 90 / 120 s each. At zero
the answer box submits what it holds (stopping a recording first). Model answers wait for the summary. Verdicts also
feed the local quiz tally; nothing is stored server-side.

Voice: Cartesia Ink runs in the browser (`src/lib/voice/`). `voiceToken` mints a 120 s token that only grants `stt`;
the key stays on the server and the audio goes browser to Cartesia, never through or into our storage. Protocol tests
are in `server/client-voice.test.ts` (fake socket). Checked once against the real service with Sonic-generated Spanish
speech through the same `SttSession`; the microphone glue (`recorder.ts`) still needs a manual check in a browser.
Ink can garble technical terms ("argon2id" heard as "Argond osid"), so for spoken answers the grader is told the text is
a transcript and must not count a phonetically close term as a mistake.

Local secrets go in `.env` at the repo root (ignored by git; Bun loads it): `CARTESIA_API_KEY`, `DEEPSEEK_API_KEY`.

Practice itself stays anonymous: the browser keeps progress in `localStorage`; nothing about an answer is stored.

## Privacy

Practice stores nothing server-side. Progress (ratings, quiz tallies, last identity) lives in `localStorage` under
`mydefense-v1:<team>`. The UI says so.

## Delivery

Per house: GitOps on the WeFaber runner, blue/green (`mydefense@blue` / `@green`, ports 5191 / 5192), `/ready` on the
slot then on the real domain, `https://defense.eternum.lat`. The GitHub OAuth callback is `https://defense.eternum.lat/auth/github/callback` (`server/app.ts`).
Workflow: `.github/workflows/deploy.yml`; script, systemd unit, Nginx vhost and the one-time VPS setup are in
[`deploy/`](deploy/README.md).
