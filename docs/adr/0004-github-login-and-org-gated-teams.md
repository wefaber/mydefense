# 0004 · GitHub login, and team creation only for members of a GitHub org

Status: accepted · 2026-11-01 · Faku chose the org gate over manual approval

## Context

Students reach the public site without Tailscale, so the site needs a real login. Practice stays anonymous; only
creating and directing a team needs an account. Creating a team must be limited to people who belong to a GitHub
organization. The house rules (`~/.claude/standards/ARCHITECTURE.md`, "Privacy and identity") ask for: no mandatory
email, session tokens stored only as sha256, separate identities, rate-limited login, and living verifications over
one-shot marks. The accounts layer (`@wefaber/accounts`) already covers the password side.

## Decision

1. **Sign-in with GitHub is a second way into the same `users` table.** A GitHub sign-in creates an account with no
   password (`passwordHash` null, so password login cannot match it) or finds the account already linked to that
   GitHub id. The handle is the GitHub login when it is free and valid, otherwise the login plus a random suffix.
2. **No automatic linking to password accounts.** A password account and a GitHub account with the same name stay two
   accounts. Matching by name would let whoever registers a name take over a person's team. Linking an existing account
   while signed in is a follow-up.
3. **OAuth App, scope `read:org`, no email.** Client through `arctic` (MIT, no runtime deps of its own beyond
   `@oslojs`). Flow: `GET /auth/github/start` sets `md_oauth` (HttpOnly, Lax, `Path=/auth/github`, 10 min) with a random
   state and redirects to GitHub; `GET /auth/github/callback` checks the state in constant time, exchanges the code,
   reads `/user` and `/user/memberships/orgs/<org>` (`state: active` is a member; 404 is not), sets `md_session` and
   clears `md_oauth`. Any failure redirects to `/cuenta/entrar?error=github` and sets no session.
4. **The OAuth token is never stored.** It lives inside one callback and is dropped. What is stored is
   `github_links`: the user id, the numeric GitHub id, the org name checked, the membership boolean and `checked_at`.
   No login, no email, no token. A test scans every table for the token.
5. **Re-check: 24 h, at each GitHub sign-in.** Without the token there is no server-side re-check, so membership is
   re-read at every sign-in. `createTeam` allows a team only when the stored result is a member of the configured org
   and was checked within 24 h. A stale result returns `REVERIFY` ("volvé a entrar con GitHub"), a non-member gets
   `FORBIDDEN`, and an account with no GitHub link gets `FORBIDDEN` with a pointer to GitHub sign-in.
6. **Only team creation is gated.** Directing an existing team (members, invites, material) stays as it was: it
   depends on the team's roles, not on the org. Password accounts keep logging in and practicing.
7. **Config from env, fail closed.** `MYDEFENSE_GITHUB_ORG`, `MYDEFENSE_GITHUB_CLIENT_ID`,
   `MYDEFENSE_GITHUB_CLIENT_SECRET`, `MYDEFENSE_PUBLIC_URL` come together or not at all (a partial set stops the boot).
   Without them: no GitHub button, the start route answers 404, and nobody can create a team. The org name is never in
   the repo.
8. **Rate limit** `github:ip` 30 per 10 min on both legs, through the house limiter.

## Alternatives considered

- **GitHub App.** Finer permissions and expiring tokens, but more setup on the org for one membership read. Revisit when
  a second org needs it.
- **Server token that reads membership for anyone.** Works without the user's token, but stores a standing credential
  that can read the org for everyone. Rejected: the user's own token, used once, is enough.
- **Better Auth.** Rejected by JobIt before (mandatory email, unhashed tokens, unencrypted TOTP).
- **Auto-link by handle or email.** Rejected: takeover by name (decision 2).

## Consequences

- A creator who is a member loses team creation when GitHub revokes the membership, at the next sign-in or after 24 h.
- Existing password accounts cannot create teams until they sign in with GitHub, which creates a new account. Linking
  would fix that without a takeover risk; it is the next step if Faku wants it.
- The OAuth grant is not revoked on logout. Dropping the token is enough for the house rule; revoking is one API call if
  Faku wants it.
- Nginx must send `/auth/github/*` to the app like everything else; the callback host must match
  `MYDEFENSE_PUBLIC_URL`.
- Accounts created by GitHub get recovery codes that nobody sees (`register` mints them). They are stored hashed; without
  the codes they are unusable, so this is harmless but untidy. Tidying it means a `createUser` port in `@wefaber/accounts`.
