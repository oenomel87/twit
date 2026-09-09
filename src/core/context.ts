import os from 'node:os'
import path from 'node:path'
import type { Database } from 'better-sqlite3'
import { openDatabase } from '../store/db.js'
import { TwitError } from './errors.js'
import type { CliIo } from './io.js'

export type Env = Record<string, string | undefined>

export interface ContactRow {
  id: string
  display_name: string
  created_at: string
}

export interface Context {
  db: Database
}

export interface GlobalOptions {
  json?: boolean
  actor?: string
  name?: string
}

export function mergeGlobalOptions(programOpts: GlobalOptions, cmdOpts: GlobalOptions): GlobalOptions {
  return {
    json: cmdOpts.json ?? programOpts.json ?? false,
    actor: cmdOpts.actor ?? programOpts.actor,
    name: (cmdOpts as { name?: string }).name ?? programOpts.name,
  }
}

export function resolveHome(env: Env): string {
  const raw = env.TWIT_HOME?.trim()
  return raw ? raw : path.join(os.homedir(), '.twit')
}

export function resolveDbPath(env: Env): string {
  return path.join(resolveHome(env), 'twit.db')
}

export function loadContext(env: Env): Context {
  return { db: openDatabase(resolveDbPath(env)) }
}

export function closeContext(ctx: Context): void {
  ctx.db.close()
}

export async function withDb<T>(
  io: CliIo,
  handler: (db: Database) => T | Promise<T>,
): Promise<T> {
  const ctx = loadContext(io.env)
  try {
    return await handler(ctx.db)
  } finally {
    closeContext(ctx)
  }
}

export function resolveActor(
  ctx: Context,
  options: GlobalOptions,
  env: Env,
): { actor: ContactRow | null; requestedId: string | null } {
  const requestedId = options.actor?.trim() || env.TWIT_ACTOR?.trim() || null
  if (!requestedId) return { actor: null, requestedId: null }
  const actor =
    (ctx.db
      .prepare('SELECT id, display_name, created_at FROM contacts WHERE id = ?')
      .get(requestedId) as ContactRow | undefined) ?? null
  return { actor, requestedId }
}

export function requireActor(ctx: Context, options: GlobalOptions, env: Env): ContactRow {
  const { actor, requestedId } = resolveActor(ctx, options, env)
  if (!actor) {
    throw new TwitError(
      'ACTOR_NOT_CONFIGURED',
      '호출자가 설정되어 있지 않거나 등록된 참여자가 아닙니다. --actor <id> 옵션 또는 TWIT_ACTOR 환경변수로 호출자를 지정하고, twit contacts로 등록된 참여자를 확인할 수 있습니다.',
      { actor: requestedId },
    )
  }
  return actor
}

export function countContacts(ctx: Context): number {
  return (ctx.db.prepare('SELECT COUNT(*) AS n FROM contacts').get() as { n: number }).n
}

export function listContacts(ctx: Context): ContactRow[] {
  return ctx.db
    .prepare('SELECT id, display_name, created_at FROM contacts ORDER BY created_at, rowid')
    .all() as ContactRow[]
}
