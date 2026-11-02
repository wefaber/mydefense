# 0003 · LLM access per team: platform quota, bring-your-own-key, admin

Status: **accepted** for the decisions under "Decided 2026-11-01"; the quota number and admins are still open (see
"Open questions"). Not built.

## Context

Grading (`server/ai/`) calls one global model from `DEEPSEEK_API_KEY`. Limits are global (2000 calls/day, 30 per
10 min per client). Any team that creates an account can spend the operator's credits, and nothing shows who spent
them. Teams that have their own provider key have no way to use it.

Goals: the operator decides which teams use the platform key and how much; a team can bring its own key from an
OpenAI-compatible provider; the operator's credits cannot run out silently.

## Decision

### 1. Per-team LLM mode

`teams.llm_mode`: `off` · `platform` · `byok`.

- `off`: no grading for the team. Practice still works.
- `platform`: uses the operator's key, subject to the calling user's daily quota (unless the team is exempt).
- `byok`: uses the team's own key. No platform quota; the team pays its provider.

Resolution happens per call: `resolveLlm(team)` returns the `Llm` for that team, or `null` (grading off). The global
`llmFromEnv` stays as the platform client.

### 2. Quotas

- Quota is **per user**, across all teams. `users.llm_daily_calls` (default: see Cost per call). Admin can change it per
  user. Calls made under an exempt team (Eternum) are not counted against it.
- `llm_usage(user_id, day, calls, prompt_tokens, completion_tokens)`, one row per user per UTC day. Incremented after a
  successful call; the response's `usage` field is recorded when present.
- Global circuit breaker: `MYDEFENSE_LLM_DAILY_CALLS` (env) caps platform calls across all teams. When it is hit,
  `platform` teams get a clear "sin cupo hoy" error and `byok` teams are not affected.
- The per-client rate limit stays as is (abuse, not money).

### 3. Bring your own key

- Directors only (same rule as other workspace writes).
- Provider is chosen from a **preset list** (DeepSeek, OpenAI, OpenRouter with ZDR). No free-form base URL in v1,
  because the server would otherwise make outbound requests to any address the team types (SSRF).
- Key stored in `team_llm_keys`, encrypted with the existing `createSecretBox` (`MYDEFENSE_KEY_FILE`). Without the
  key file, saving a BYOK key fails closed, same as 2FA in `@wefaber/accounts`.
- Saving validates the key with one minimal call before storing it.
- The key is never returned by GraphQL. The UI shows "configurada" and the provider, nothing else.

### 4. Admin

- Admins are GitHub logins listed in `MYDEFENSE_ADMINS` (env). The flag is evaluated on each request, not stored, so
  removing a login from the env revokes it.
- Admin panel (`/admin`): list teams with mode, today's calls, month's calls, quota; edit mode and quota; see the
  platform total for the day against `MYDEFENSE_LLM_DAILY_CALLS`.
- Admin can see a team's mode and usage counts. Admin cannot see a team's BYOK key or its answers.

### 5. Voice

Cartesia sessions cost money too. Count each `voiceToken` mint as one call against the same quota, in v1. Revisit if
it blocks real use.

## Consequences

- Teams that never configure anything get whatever the default mode is (see Open questions). No surprise bills.
- Operators can see spend per user and per team; they can cut either off without touching the code.
- BYOK adds one secret per team and one encryption dependency on the key file. Production must set
  `MYDEFENSE_KEY_FILE` before BYOK is enabled.
- Quotas are counted in calls, not dollars. Tokens are recorded so a dollar cap can come later without a migration.

## Out of scope (v1)

- Dollar budgets and invoices.
- Per-member quotas. Quotas are per team.
- Free-form provider URLs.
- The Board's evidence calls (they cost the Board, not us).

## Cost per call (measured prompt sizes, 2026-11-01)

Measured with `buildGradePrompt` / `graderSystem` on a sample: 6 Board passages at the 900-char cap, a 800-char
answer, a 300-char question, a 400-char reference and a 300-char "expected".

| Call                          | System      | User        | Input tokens (≈, Spanish ~3.5 chars/token) | Output (≈, JSON) |
| ----------------------------- | ----------- | ----------- | ------------------------------------------ | ---------------- |
| Grounded (with Board sources) | 3,800 chars | 8,000 chars | ≈ 3,100                                    | ≈ 300–500        |
| Reference only (no sources)   | 2,900 chars | 2,000 chars | ≈ 1,300                                    | ≈ 200–400        |

Not counted: the system prompt is an identical prefix, so DeepSeek's cached-input price applies to most of it.
Revisions (student comment) add up to 600 chars and count as one call. Board evidence searches cost the Board, not us.
Voice (Cartesia) is not priced here; measure it before setting a voice quota.

Price, `deepseek-flash` (DeepSeek's model details table, checked 2026-11-01), per 1M tokens:

| Tier     | Input, cache hit | Input, cache miss | Output |
| -------- | ---------------- | ----------------- | ------ |
| Off-peak | 0.003            | 0.15              | 0.60   |
| Peak     | 0.006            | 0.30              | 1.20   |

A grounded call (≈ 1,000 system tokens cached, ≈ 2,100 user tokens uncached, ≈ 400 output):
≈ 0.0011 USD at peak, ≈ 0.0006 USD off-peak. Without the cache, ≈ 0.0014 USD at peak.

Worst case, every user spending the full quota every day, at peak: 100 users × quota × 0.0011 USD per day. Example:
40 calls per user per day → ≈ 4.4 USD/day for 100 users (≈ 130 USD/month).

**Thinking is on, at `high`, for every grading call (decided 2026-11-01).** Requests send
`thinking: {type: "enabled"}` and `reasoning_effort: "high"`. The API reports reasoning tokens inside
`completion_tokens`, so they count as output. On one question with no sources, 2 runs per case: `low` and `high`
cost about the same (average completion ~316 vs ~264 tokens) and `high` was slightly more consistent. The sample is
small, and the output figures above were measured without thinking, so they understate it. Re-measure with the
`usage` field before fixing the quota. Only DeepSeek's pricing page can confirm the billing rule; it has not loaded yet.

The code uses `deepseek-flash` (`DEEPSEEK_MODEL`, set 2026-11-01). DeepSeek's quick start page names `deepseek-flash`
as the model. Whether the old `deepseek-chat` id is retired is not confirmed.

## Seeded policy (decided 2026-11-01)

| Team       | Mode       | Quota                                                   |
| ---------- | ---------- | ------------------------------------------------------- |
| Eternum    | `platform` | none, per user (still under the global circuit breaker) |
| Dataminers | `platform` | per-user quota, value pending (see Cost per call)       |
| Nexus      | `platform` | per-user quota, value pending (see Cost per call)       |
| Any other  | `off`      | n/a until an admin enables it                           |

Dataminers and Nexus are not created yet; they are added with this policy when they exist.

## Decided 2026-11-01

- Corrections and the end-of-session recap run with thinking at `high`.
- Model: `deepseek-flash`.
- Who can create teams: members of the configured GitHub org (see [0004](0004-github-login-and-org-gated-teams.md)).
- Quota is per user, across teams. Eternum calls are not counted against it.

## Open questions

1. Per-user daily quota, for Dataminers and Nexus and for everyone else on `platform`: 40 calls per day is the working
   value from the cost table (≈ 0.05 USD per user per day at peak, before thinking is re-measured). Confirm or change.
2. Does Eternum also skip the global breaker `MYDEFENSE_LLM_DAILY_CALLS`? Proposed: no. A bug should not be able to
   empty the credits.
3. `MYDEFENSE_ADMINS`: the GitHub logins of the admins.

## Links

- [[0002-evidence-from-the-board-api]] for the Board side of the same cost question.
- `server/ai/llm.ts` (platform client), `server/config.ts` (`keyFile`), `server/db/workspace.ts` (director rule).
