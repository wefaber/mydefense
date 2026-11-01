import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { hashToken, mintToken } from '@wefaber/accounts'
import { ulid } from 'ulid'
import {
  MATERIAL_MAX_BYTES,
  RESERVED_SLUGS,
  VISIBILITIES,
  type Role,
  type Visibility,
} from '../../shared/types.ts'
import type { Db } from './connection.ts'
import * as t from './schema.ts'

export type AccessCode = 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID' | 'CONFLICT'

/** Expected failure. Mapped to a GraphQLError with `extensions.code` at the API edge. */
export class AccessError extends Error {
  readonly code: AccessCode

  constructor(code: AccessCode, message: string) {
    super(message)
    this.name = 'AccessError'
    this.code = code
  }
}

/** Where uploaded bytes live. The default writes under the files directory; tests use memory. */
export interface FileStore {
  write(path: string, bytes: Uint8Array): Promise<void>
  remove(path: string): Promise<void>
}

export const INVITE_DAYS = 7
export const MAX_MATERIALS_PER_TEAM = 50
const MAX_TEAMS_PER_USER = 20

const EXTENSIONS: Record<string, string> = {
  pdf: 'application/pdf',
  md: 'text/markdown',
  txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

const clean = (raw: string, max: number) =>
  [...raw]
    .filter((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127)
    .join('')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max)

export const slugify = (raw: string) =>
  raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/

/** Does the content look like what its extension claims? Keeps a renamed executable out of the files directory. */
function looksLike(ext: string, bytes: Uint8Array): boolean {
  const head = (n: number) => String.fromCharCode(...bytes.subarray(0, n))
  if (ext === 'pdf') return head(5) === '%PDF-'
  if (ext === 'docx') return head(2) === 'PK'
  return !bytes.subarray(0, 4096).includes(0)
}

/**
 * Everything that needs a signed-in user. Each method takes the acting user first and checks their role in the
 * team before touching its rows, so a handler can never skip the check. Non-members get NOT_FOUND, never a hint
 * that a private team exists.
 */
export class Workspace {
  private readonly db: Db
  private readonly files: FileStore
  private readonly now: () => Date

  constructor(db: Db, files: FileStore, now: () => Date = () => new Date()) {
    this.db = db
    this.files = files
    this.now = now
  }

  /* --- Reads ---------------------------------------------------------------------------------------------- */

  roleOf(teamId: string, userId: string): Role | null {
    return (
      this.db
        .select({ role: t.members.role })
        .from(t.members)
        .where(and(eq(t.members.teamId, teamId), eq(t.members.userId, userId)))
        .get()?.role ?? null
    )
  }

  /** A public team, or a team the user belongs to. */
  visibleTeamBySlug(slug: string, userId: string | null) {
    const team = this.db
      .select()
      .from(t.teams)
      .where(eq(t.teams.slug, slug))
      .get()
    if (!team) return undefined
    if (team.visibility === 'public') return team
    return userId && this.roleOf(team.id, userId) ? team : undefined
  }

  myTeams(userId: string) {
    return this.db
      .select({ team: t.teams, role: t.members.role })
      .from(t.members)
      .innerJoin(t.teams, eq(t.teams.id, t.members.teamId))
      .where(eq(t.members.userId, userId))
      .orderBy(asc(t.teams.name))
      .all()
  }

  private requireMember(teamId: string, userId: string): Role {
    const role = this.roleOf(teamId, userId)
    if (!role) throw new AccessError('NOT_FOUND', 'No encontramos ese equipo.')
    return role
  }

  private requireDirector(teamId: string, userId: string): void {
    if (this.requireMember(teamId, userId) !== 'director') {
      throw new AccessError(
        'FORBIDDEN',
        'Solo la dirección del equipo puede hacer esto.',
      )
    }
  }

  members(userId: string, teamId: string) {
    this.requireMember(teamId, userId)
    return this.db
      .select({
        id: t.members.id,
        userId: t.members.userId,
        role: t.members.role,
        handle: t.users.handle,
        displayName: t.users.displayName,
        createdAt: t.members.createdAt,
      })
      .from(t.members)
      .innerJoin(t.users, eq(t.users.id, t.members.userId))
      .where(eq(t.members.teamId, teamId))
      .orderBy(asc(t.members.createdAt))
      .all()
  }

  invites(userId: string, teamId: string) {
    this.requireDirector(teamId, userId)
    return this.db
      .select()
      .from(t.invites)
      .where(and(eq(t.invites.teamId, teamId), isNull(t.invites.usedAt)))
      .orderBy(desc(t.invites.createdAt))
      .all()
      .filter((i) => i.expiresAt > this.now().toISOString())
  }

  materials(userId: string, teamId: string) {
    this.requireMember(teamId, userId)
    return this.db
      .select({
        id: t.materials.id,
        name: t.materials.name,
        mime: t.materials.mime,
        size: t.materials.size,
        createdAt: t.materials.createdAt,
      })
      .from(t.materials)
      .where(eq(t.materials.teamId, teamId))
      .orderBy(desc(t.materials.createdAt))
      .all()
  }

  /* --- Teams ---------------------------------------------------------------------------------------------- */

  createTeam(
    userId: string,
    input: { name: string; slug?: string | null; visibility: Visibility },
  ) {
    const name = clean(input.name, 60)
    if (name.length < 2)
      throw new AccessError(
        'INVALID',
        'El nombre del equipo necesita al menos 2 letras.',
      )
    if (!VISIBILITIES.includes(input.visibility))
      throw new AccessError('INVALID', 'Visibilidad inválida.')
    if (this.myTeams(userId).length >= MAX_TEAMS_PER_USER) {
      throw new AccessError(
        'INVALID',
        `Cada cuenta puede tener hasta ${MAX_TEAMS_PER_USER} equipos.`,
      )
    }

    const explicit = input.slug ? slugify(input.slug) : null
    const base = explicit ?? slugify(name)
    if (!SLUG.test(base) || RESERVED_SLUGS.includes(base)) {
      throw new AccessError(
        'INVALID',
        'La dirección del equipo no es válida o está reservada.',
      )
    }
    const taken = (slug: string) =>
      !!this.db.select().from(t.teams).where(eq(t.teams.slug, slug)).get()
    let slug = base
    if (taken(slug)) {
      if (explicit)
        throw new AccessError('CONFLICT', 'Esa dirección ya está tomada.')
      for (let n = 2; taken(slug); n++) slug = `${base.slice(0, 36)}-${n}`
    }

    const stamp = this.now().toISOString()
    const teamId = ulid()
    this.db.transaction((tx) => {
      tx.insert(t.teams)
        .values({
          id: teamId,
          slug,
          name,
          visibility: input.visibility,
          createdAt: stamp,
        })
        .run()
      tx.insert(t.members)
        .values({
          id: ulid(),
          teamId,
          userId,
          role: 'director',
          createdAt: stamp,
        })
        .run()
      tx.insert(t.defenses)
        .values({
          id: ulid(),
          teamId,
          title: 'Defensa',
          date: '',
          criteria: [],
        })
        .run()
    })
    return this.db.select().from(t.teams).where(eq(t.teams.id, teamId)).get()!
  }

  updateTeam(
    userId: string,
    teamId: string,
    patch: { name?: string | null; visibility?: Visibility | null },
  ) {
    this.requireDirector(teamId, userId)
    const set: Partial<typeof t.teams.$inferInsert> = {}
    if (patch.name != null) {
      const name = clean(patch.name, 60)
      if (name.length < 2)
        throw new AccessError(
          'INVALID',
          'El nombre del equipo necesita al menos 2 letras.',
        )
      set.name = name
    }
    if (patch.visibility != null) {
      if (!VISIBILITIES.includes(patch.visibility))
        throw new AccessError('INVALID', 'Visibilidad inválida.')
      set.visibility = patch.visibility
    }
    if (Object.keys(set).length)
      this.db.update(t.teams).set(set).where(eq(t.teams.id, teamId)).run()
    return this.db.select().from(t.teams).where(eq(t.teams.id, teamId)).get()!
  }

  /* --- Identities ----------------------------------------------------------------------------------------- */

  addIdentity(
    userId: string,
    teamId: string,
    input: { name: string; role: string; sectors: string },
  ) {
    this.requireDirector(teamId, userId)
    const name = clean(input.name, 40)
    if (!name)
      throw new AccessError('INVALID', 'La identidad necesita un nombre.')
    const existing = this.db
      .select()
      .from(t.identities)
      .where(eq(t.identities.teamId, teamId))
      .all()
    const base = slugify(name) || 'identidad'
    let key = base
    for (let n = 2; existing.some((i) => i.key === key); n++)
      key = `${base}-${n}`
    const row = {
      id: ulid(),
      teamId,
      key,
      name,
      role: clean(input.role, 60),
      sectors: clean(input.sectors, 200),
      position: existing.length,
    }
    this.db.insert(t.identities).values(row).run()
    return row
  }

  updateIdentity(
    userId: string,
    teamId: string,
    identityId: string,
    patch: {
      name?: string | null
      role?: string | null
      sectors?: string | null
    },
  ) {
    this.requireDirector(teamId, userId)
    const current = this.identityOf(teamId, identityId)
    const set: Partial<typeof t.identities.$inferInsert> = {}
    if (patch.name != null) {
      const name = clean(patch.name, 40)
      if (!name)
        throw new AccessError('INVALID', 'La identidad necesita un nombre.')
      set.name = name
    }
    if (patch.role != null) set.role = clean(patch.role, 60)
    if (patch.sectors != null) set.sectors = clean(patch.sectors, 200)
    if (Object.keys(set).length) {
      this.db
        .update(t.identities)
        .set(set)
        .where(eq(t.identities.id, current.id))
        .run()
    }
    return this.identityOf(teamId, identityId)
  }

  removeIdentity(userId: string, teamId: string, identityId: string): void {
    this.requireDirector(teamId, userId)
    const current = this.identityOf(teamId, identityId)
    this.db.transaction((tx) => {
      // Points keep existing; they just lose their presenter.
      tx.update(t.points)
        .set({ ownerId: null })
        .where(eq(t.points.ownerId, current.id))
        .run()
      tx.delete(t.identities).where(eq(t.identities.id, current.id)).run()
    })
  }

  private identityOf(teamId: string, identityId: string) {
    const row = this.db
      .select()
      .from(t.identities)
      .where(
        and(eq(t.identities.teamId, teamId), eq(t.identities.id, identityId)),
      )
      .get()
    if (!row)
      throw new AccessError('NOT_FOUND', 'No encontramos esa identidad.')
    return row
  }

  /* --- Members and invites -------------------------------------------------------------------------------- */

  private directorsLeft(teamId: string, excludingMemberId: string): number {
    return this.db
      .select({ id: t.members.id })
      .from(t.members)
      .where(and(eq(t.members.teamId, teamId), eq(t.members.role, 'director')))
      .all()
      .filter((m) => m.id !== excludingMemberId).length
  }

  setMemberRole(
    userId: string,
    teamId: string,
    memberId: string,
    role: Role,
  ): void {
    this.requireDirector(teamId, userId)
    const member = this.memberOf(teamId, memberId)
    if (
      member.role === 'director' &&
      role !== 'director' &&
      this.directorsLeft(teamId, member.id) === 0
    ) {
      throw new AccessError(
        'INVALID',
        'El equipo necesita al menos una dirección.',
      )
    }
    this.db
      .update(t.members)
      .set({ role })
      .where(eq(t.members.id, member.id))
      .run()
  }

  /** A director removes anyone; a member can only leave. The last director cannot go. */
  removeMember(userId: string, teamId: string, memberId: string): void {
    const myRole = this.requireMember(teamId, userId)
    const member = this.memberOf(teamId, memberId)
    if (myRole !== 'director' && member.userId !== userId) {
      throw new AccessError(
        'FORBIDDEN',
        'Solo la dirección puede sacar a otras personas.',
      )
    }
    if (
      member.role === 'director' &&
      this.directorsLeft(teamId, member.id) === 0
    ) {
      throw new AccessError(
        'INVALID',
        'El equipo necesita al menos una dirección.',
      )
    }
    this.db.delete(t.members).where(eq(t.members.id, member.id)).run()
  }

  private memberOf(teamId: string, memberId: string) {
    const row = this.db
      .select()
      .from(t.members)
      .where(and(eq(t.members.teamId, teamId), eq(t.members.id, memberId)))
      .get()
    if (!row)
      throw new AccessError('NOT_FOUND', 'No encontramos a esa persona.')
    return row
  }

  /** The token is returned once; only its hash is stored. */
  createInvite(userId: string, teamId: string, role: Role) {
    this.requireDirector(teamId, userId)
    const token = mintToken()
    const now = this.now()
    const expiresAt = new Date(
      now.getTime() + INVITE_DAYS * 86_400_000,
    ).toISOString()
    this.db
      .insert(t.invites)
      .values({
        id: ulid(),
        teamId,
        tokenHash: hashToken(token),
        role,
        createdBy: userId,
        createdAt: now.toISOString(),
        expiresAt,
      })
      .run()
    return { token, expiresAt }
  }

  revokeInvite(userId: string, teamId: string, inviteId: string): void {
    this.requireDirector(teamId, userId)
    this.db
      .delete(t.invites)
      .where(and(eq(t.invites.teamId, teamId), eq(t.invites.id, inviteId)))
      .run()
  }

  acceptInvite(userId: string, token: string) {
    const invite = this.db
      .select()
      .from(t.invites)
      .where(eq(t.invites.tokenHash, hashToken(token)))
      .get()
    const stamp = this.now().toISOString()
    if (!invite || invite.usedAt || invite.expiresAt <= stamp) {
      throw new AccessError(
        'NOT_FOUND',
        'La invitación no existe, ya se usó o venció.',
      )
    }
    const team = this.db
      .select()
      .from(t.teams)
      .where(eq(t.teams.id, invite.teamId))
      .get()!
    if (this.roleOf(team.id, userId)) return team // already inside: keep the invite for someone else
    this.db.transaction((tx) => {
      tx.insert(t.members)
        .values({
          id: ulid(),
          teamId: team.id,
          userId,
          role: invite.role,
          createdAt: stamp,
        })
        .run()
      tx.update(t.invites)
        .set({ usedAt: stamp })
        .where(eq(t.invites.id, invite.id))
        .run()
    })
    return team
  }

  /* --- Materials ------------------------------------------------------------------------------------------ */

  async addMaterial(
    userId: string,
    teamId: string,
    upload: { name: string; bytes: Uint8Array },
  ) {
    this.requireMember(teamId, userId)
    const name = clean(upload.name.split(/[\\/]/).pop() ?? '', 120)
    const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
    const mime = EXTENSIONS[ext]
    if (!name || !mime)
      throw new AccessError(
        'INVALID',
        'Subí un PDF, DOCX, Markdown o texto plano.',
      )
    if (upload.bytes.length === 0)
      throw new AccessError('INVALID', 'El archivo está vacío.')
    if (upload.bytes.length > MATERIAL_MAX_BYTES) {
      throw new AccessError('INVALID', 'El archivo pesa más de 10 MB.')
    }
    if (!looksLike(ext, upload.bytes))
      throw new AccessError(
        'INVALID',
        'El contenido no coincide con el tipo de archivo.',
      )
    if (
      this.db
        .select({ id: t.materials.id })
        .from(t.materials)
        .where(eq(t.materials.teamId, teamId))
        .all().length >= MAX_MATERIALS_PER_TEAM
    ) {
      throw new AccessError(
        'INVALID',
        `Cada equipo puede tener hasta ${MAX_MATERIALS_PER_TEAM} materiales.`,
      )
    }

    const id = ulid()
    const storagePath = `${teamId}/${id}`
    await this.files.write(storagePath, upload.bytes)
    this.db
      .insert(t.materials)
      .values({
        id,
        teamId,
        name,
        mime,
        size: upload.bytes.length,
        storagePath,
        extractedText: null,
        uploadedBy: userId,
        createdAt: this.now().toISOString(),
      })
      .run()
    return { id, name, mime, size: upload.bytes.length }
  }

  async deleteMaterial(
    userId: string,
    teamId: string,
    materialId: string,
  ): Promise<void> {
    this.requireMember(teamId, userId)
    const row = this.db
      .select()
      .from(t.materials)
      .where(
        and(eq(t.materials.teamId, teamId), eq(t.materials.id, materialId)),
      )
      .get()
    if (!row) throw new AccessError('NOT_FOUND', 'No encontramos ese material.')
    if (
      this.roleOf(teamId, userId) !== 'director' &&
      row.uploadedBy !== userId
    ) {
      throw new AccessError(
        'FORBIDDEN',
        'Solo quien lo subió o la dirección puede borrarlo.',
      )
    }
    this.db.delete(t.materials).where(eq(t.materials.id, row.id)).run()
    await this.files.remove(row.storagePath)
  }
}
