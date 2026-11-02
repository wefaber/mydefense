# 0006 · Joining a team by invite needs a GitHub sign-in

Status: accepted · 2026-11-01 · Faku: an invite link alone must not be enough to enter a team

## Context

`acceptInvite` only checked that the invite token was valid and unused. Any account could register with a password and
join with a link. ADR 0004 gated only team creation (decision 6), so joining stayed open.

## Decision

1. **`acceptInvite` needs a GitHub link on the viewer.** Any GitHub account counts; the sign-in is the identity check.
   Without a link the mutation answers `FORBIDDEN` with a pointer to sign-in with GitHub. The check runs before the token
   is consumed, so a refused attempt leaves the invite usable.
2. **No org membership for joining.** The gate is identity only. Requiring the org would be a one-line change in
   `githubViewer` (`server/graphql/schema.ts`), if Faku wants it.
3. **Password accounts keep what they have.** They keep existing memberships. They cannot accept a new invite until they
   sign in with GitHub, which creates a separate account (ADR 0004 decision 2: no linking). ADR 0007 extends the same
   rule to reading and practicing.
4. **Fail closed.** Without GitHub configured, joining answers `UNAVAILABLE`, as team creation does.

## Consequences

- A student with only a password account must create a GitHub account to join a team by invite.
- Invite tokens are unchanged: single use, 7 days, hashed at rest.
