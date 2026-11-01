# Roadmap

MyDefense is a public WeFaber product where any team practices a project defense. It starts as the port of the Eternum
study tool (`lux/docs/defensa`) and grows into a generic authoring + practice platform.

Two flows:

- **Practice:** pick team → pick identity → practice. No account; progress lives in the browser.
- **Author:** create team → upload material → process → generate questions → validate with a second model pass →
  director reviews the draft → approve → members and others practice.

Each phase is one PR (`dev` → `main`) with its own version bump. Long-term items become issues in the WeFaber ROADMAP
project.

## Decisions

| Concern       | Choice                                                                                                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kind          | Product: public, privacy-first. Practice without account; accounts only to author or direct a team                                                                                                                                                |
| Shape         | One Bun process: Elysia shell + GraphQL (Yoga + Pothos) at `/graphql` + static SPA + in-process jobs. `src/` stays the SPA root; `server/` and `shared/` are added                                                                                |
| Data          | SQLite (`bun:sqlite`, WAL) + Drizzle, ULIDs. Uploaded files under the app data dir                                                                                                                                                                |
| Accounts      | `@wefaber/accounts` with a SQLite `AccountStore`                                                                                                                                                                                                  |
| UI            | `@wefaber/tokens` theme **teal** + `@wefaber/ui`, lucide-react, motion                                                                                                                                                                            |
| LLM           | `server/llm/` behind an interface, task profiles `fast` / `standard` / `deep` over OpenRouter with zero data retention. LLM output is a draft until a director accepts it                                                                         |
| Generative UI | OpenUI (`@openuidev/react-ui`, `react-lang`, `lang-core`, MIT) on the direct OpenAI-compatible path, own component library styled with tokens. Spike first; eternum-board's fenced-block gen UI (`genui.ts`) is the fallback                      |
| Grading       | LearnIt `GradingSpec` / `GradeResult` shapes (rubric `{criteria, modelAnswer, passScore}`) + LLM rubric scoring. Scale: Completa / Parcial / Insuficiente                                                                                         |
| Voice         | Cartesia (Ink STT, Sonic TTS), lifted from eternum-board: server mints a short-lived token, the key never reaches the browser                                                                                                                     |
| Ask Ether     | Ether is WeFaber's AI-assistance layer, not the Hermes agent. Lifted from eternum-board: SSE `/api/ask`, embeddings + cosine retrieval with lexical fallback, `[n]` citations, cache, injection screen, rate limit + daily quota. Scoped per team |
| Code Mode     | `@wefaber/codemode`: MCP `search` + `execute`, ops call the same domain services                                                                                                                                                                  |

## Domain model

- `Team` · `Member` (director | member) · `Invite` (hashed token, role, expiry)
- `Identity`: who presents. Practice picks one; no account needed
- `Defense` (title, date, criteria) · `Section` · `Point` (owner identity, title, script, talking points, refs, status
  ok | fill | pend, what is missing)
- `Question` (point?, group point | bank | topic | custom (own/cross is derived from the point owner), prompt, model answer, grading spec, refs, status
  draft | validated | approved, validator notes)
- `Resource` (exercise | fact | pending | lesson)
- `Material` (file, extracted text, chunks) · `Attempt` (question, identity, answer or transcript, grade, feedback)
- `Share` (opaque id, result snapshot, no personal data beyond the identity's display name)

Eternum is the first team, seeded from a copy of `lux/docs/defensa/data.js`: 4 identities, 14 sections, 69 points,
103 practice questions (76 from points, 15 ASO bank, 12 topics), all approved.

## Phases

### F0 · UI in Penpot

Desktop 1440 + mobile 390, teal tokens. Screens: elegí equipo · elegí identidad · mis puntos · quiz (respuesta, nota,
explicación) · modo voz · resultados + compartir · crear equipo + subir material · revisión del borrador · miembros +
invitar · Ask Ether (dock). Approved by Faku before code.

- [~] Skipped by Faku (2026-10-31): F1 goes straight to code; the UI is designed in the browser against `DESIGN.md`

### F1 · Base + Eternum parity · v0.1.0

- [x] `CLAUDE.md`, `ARCHITECTURE.md`, `DESIGN.md`, `docs/adr/0001-*`
- [x] Scripts `dev` / `check` / `build` / `start` / `test` / `lint`
- [x] Server shell: `/health`, `/ready`, `/graphql`, static hosting
- [x] SQLite schema, migrations, Eternum seed + count test
- [x] SPA: team → identity → Mis puntos / Quiz / Banco / Temas / Ejercicios / Pendientes / Datos, self-grading,
      progress in `localStorage`
- [ ] Deploy workflow (blue/green, systemd, Nginx); domain to confirm

### F2 · Accounts + CRUD · v0.2.0

- [x] Register / login (`@wefaber/accounts`)
- [x] Teams, identities, members, invites
- [x] Material upload (plain HTTP endpoint)
- [x] Scoped access module + isolation tests
- [x] GitHub login (OAuth, `read:org`); team creation only for members of the configured org, re-checked every 24 h
      at sign-in ([ADR 0004](adr/0004-github-login-and-org-gated-teams.md))
- [ ] Link GitHub to an existing password account while signed in (not automatic: see ADR 0004)

### F3 · Answer and grade (text + voice) · v0.3.0

The point of the product: the student defends the answer instead of reading it. ITI teams only for now (Eternum, Nexus,
Dataminers); the rubric comes from the official "Aspectos a evaluar en defensa".

- [x] Written answer graded by an LLM against the stored reference (verdict + content / terminology / structure 0..4,
      covered / missing / unsupported); the answer is fenced as data
- [x] Oral answer: Cartesia Ink in the browser, short-lived token from the server, audio never stored; pace and filler
      words from the transcript
- [x] Rate limits per client and per day; grading and voice switch themselves off without keys
- [x] Grading checks answers against Board evidence (cited, flags a flawed stored answer, argues when in doubt); client
      for the Board API, contract in ADR 0002
- [ ] Board side of the contract in eternum-board: `/api/v1/evidence/search`, app tokens, document dates, Code Mode ops
- [x] Simulacro: own points in presentation order, then the tribunal's cross questions, a clock per question that
      auto-submits at zero, summary with verdicts, criteria averages, pace and fillers
- [~] Voice: with a real key, Cartesia's token, Sonic speech through our STT session and Ink verified (the transcript
  came back right except a garbled technical term, which the grader now tolerates for spoken answers). Still to
  check by hand: the browser microphone path (`src/lib/voice/recorder.ts`)
- [ ] Load the ITI sources (`eternum-docs/fuentes/defensa`, the 20-block guide, the role split) so references and cross questions come from them
- [ ] Recap at the end of a quiz or simulacro: a reasoned analysis of every answer (verdicts, criteria, covered and
      missing, pace, fillers) with data and a valid conclusion; `deepseek-flash` with thinking at high
- [ ] Nexus and Dataminers teams

### F4 · Authoring pipeline · v0.4.0

- [ ] Text extraction (PDF, MD, DOCX, TXT) and chunking
- [ ] Generate points and questions (`deep` profile)
- [ ] Validator pass (`standard`, separate prompt): checks each answer against its cited chunks, flags unsupported ones
- [ ] Draft review screen; director approves
- [ ] Material is treated as data, never as instructions

### F5 · Explanations, gen UI, sharing · v0.5.0

- [ ] OpenUI spike on Vite + Tailwind v4 (fallback: fenced-block gen UI)
- [ ] "Explicar error" rendered as generative UI
- [ ] Share links for results

### F6 · Voice mode · v0.6.0

- [x] Cartesia token endpoint and Ink dictation (done in F3)
- [ ] Sonic reads the question aloud
- [x] Mock defense with timer (done in F3 as the Simulacro tab)

### F7 · Ask Ether + Code Mode · v0.7.0

- [ ] Ask Ether lifted from eternum-board, retrieval scoped to the team's approved material and questions
- [ ] Validate a question or answer; "¿la documentación cubre X?"
- [ ] Quota per role per day; read-only, proposals become drafts
- [ ] Code Mode MCP ops (`mydefense.team.list`, `mydefense.question.generate`, …)

## Long term

- [ ] Extract `@wefaber/ask-server`, `ask-ui`, `ask-voice` to the kit and migrate eternum-board
- [ ] Extract grading and voice for LearnIt reuse
- [ ] Export a defense as a LearnIt learning path (LearnIt has no import endpoint yet)
