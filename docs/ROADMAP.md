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

### F3 · Authoring pipeline · v0.3.0

- [ ] Text extraction (PDF, MD, DOCX, TXT) and chunking
- [ ] Generate points and questions (`deep` profile)
- [ ] Validator pass (`standard`, separate prompt): checks each answer against its cited chunks, flags unsupported ones
- [ ] Draft review screen; director approves
- [ ] Material is treated as data, never as instructions

### F4 · Grading, explanations, gen UI, sharing · v0.4.0

- [ ] OpenUI spike on Vite + Tailwind v4 (fallback: fenced-block gen UI)
- [ ] LLM rubric grading of written answers
- [ ] "Explicar error" rendered as generative UI
- [ ] Share links for results

### F5 · Voice mode · v0.5.0

- [ ] Cartesia token endpoint and voice session (lifted from eternum-board)
- [ ] Sonic reads the question, Ink transcribes the oral answer, same grading path
- [ ] Mock defense with timer

### F6 · Ask Ether + Code Mode · v0.6.0

- [ ] Ask Ether lifted from eternum-board, retrieval scoped to the team's approved material and questions
- [ ] Validate a question or answer; "¿la documentación cubre X?"
- [ ] Quota per role per day; read-only, proposals become drafts
- [ ] Code Mode MCP ops (`mydefense.team.list`, `mydefense.question.generate`, …)

## Long term

- [ ] Extract `@wefaber/ask-server`, `ask-ui`, `ask-voice` to the kit and migrate eternum-board
- [ ] Extract grading and voice for LearnIt reuse
- [ ] Export a defense as a LearnIt learning path (LearnIt has no import endpoint yet)
