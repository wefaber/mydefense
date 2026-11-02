# 0007 · Reading and practicing a team needs a GitHub sign-in

Status: accepted · 2026-11-01 · Faku: a team's content and its practice are not open to any account, so both need GitHub

## Context

ADR 0004 kept practice anonymous and gated only team creation. Public teams (Eternum) could be read and practiced by
anyone, including picking any person of the team. ADR 0006 gated joining by invite; the same reasoning applies to
reading and practicing.

## Decision

1. **Reading a team and practicing it need a session with a GitHub link.** That covers `team`, `teams`, `gradeAnswer`,
   `recapSession` and `voiceToken`. The answers are:
   - no session: `UNAUTHENTICATED`;
   - a session without a GitHub link (a password account): `FORBIDDEN`, with a pointer to sign-in with GitHub;
   - GitHub not configured: `UNAVAILABLE`, fail closed.
2. **Joining by invite** keeps the same link requirement (ADR 0006).
3. **Stays open:** `capabilities`, `me`, `register`, `login`, `logout`, the GitHub start and callback routes.
4. **Password accounts** keep their profile (`me`, `myTeams`). They cannot read or practice a team until they sign in
   with GitHub, which creates a separate account (ADR 0004 decision 2: no linking).
5. **Supersedes** ADR 0004 on "practice stays anonymous" and its decision 6 ("password accounts keep practicing"), and
   the first line of `CLAUDE.md` ("Practice needs no account"). ADR 0004 itself is not edited.
6. **Not changed here:** the management mutations (update team, identities, members, invites, materials) still check
   only the role. A password account that is already a director keeps that access. Gating them is the next step if Faku
   wants it.

## Consequences

- Practicing needs `MYDEFENSE_GITHUB_*` configured. Without it no one can practice, which is the fail-closed choice.
- A student with only a password account must create a GitHub account to practice.
- The practice pages show the server's message on error. A link to sign-in in those pages is not in this change.
- Tests use `server/github-test-session.ts`, which writes a GitHub link directly. The real sign-in flow is still tested in
  `server/auth.test.ts`.
