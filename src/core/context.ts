import os from 'node:os'
import path from 'node:path'
import { openDatabase } from '../store/db.js'
import type { Db } from '../store/db.js'
import { TwitError } from './errors.js'
import type { CliIo } from './io.js'

export type Env = Record<string, string | undefined>

export interface GlobalOptions {
  json?: boolean
  as?: string
}

export const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

export function mergeGlobalOptions(programOpts: GlobalOptions, cmdOpts: GlobalOptions): GlobalOptions {
  return {
    json: cmdOpts.json ?? programOpts.json ?? false,
    as: cmdOpts.as ?? programOpts.as,
  }
}

export function resolveHome(env: Env): string {
  const raw = env.TWIT_HOME?.trim()
  return raw ? raw : path.join(os.homedir(), '.twit')
}

export function resolveDbPath(env: Env): string {
  return path.join(resolveHome(env), 'twit.db')
}

export function loadContext(env: Env): { db: Db } {
  return { db: openDatabase(resolveDbPath(env)) }
}

export function closeContext(ctx: { db: Db }): void {
  ctx.db.close()
}

export async function withDb<T>(io: CliIo, handler: (db: Db) => T | Promise<T>): Promise<T> {
  const ctx = loadContext(io.env)
  try {
    return await handler(ctx.db)
  } catch (err) {
    // 04 문서 7장: SQLite 오류는 STORAGE_ERROR(종료 코드 6)로 나간다.
    if (err instanceof TwitError) throw err
    if (isSqliteError(err)) {
      throw new TwitError('STORAGE_ERROR', `데이터베이스 작업에 실패했습니다: ${err.message}`, {
        cause: err.message,
      })
    }
    throw err
  } finally {
    closeContext(ctx)
  }
}

import { isSqliteError } from '../store/db.js'

export function parseContacts(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

/** TWIT_CONTACTS를 해석하고 형식·중복을 검사한다. 설정이 없으면 ACTOR_NOT_CONFIGURED다. */
export function loadContacts(env: Env): string[] {
  const raw = env.TWIT_CONTACTS
  const names = parseContacts(raw)
  if (raw === undefined || raw.trim() === '' || names.length === 0) {
    throw new TwitError(
      'ACTOR_NOT_CONFIGURED',
      '주소록이 설정되어 있지 않습니다. 셸 설정에 예: TWIT_CONTACTS="dane,claude,codex,opencode" 와 같이 쉼표로 구분한 이름 목록을 넣으세요.',
    )
  }
  const seen = new Set<string>()
  for (const name of names) {
    if (!NAME_PATTERN.test(name)) {
      throw new TwitError('VALIDATION_ERROR', `주소록 항목 형식이 잘못되었습니다: ${name}`, { name })
    }
    if (seen.has(name)) {
      throw new TwitError('VALIDATION_ERROR', `주소록에 중복된 항목이 있습니다: ${name}`, { name })
    }
    seen.add(name)
  }
  return names
}

export function requireAs(env: Env, opts: GlobalOptions): { contacts: string[]; as: string } {
  const contacts = loadContacts(env)
  const as = opts.as?.trim()
  if (!as) {
    throw new TwitError(
      'ACTOR_NOT_CONFIGURED',
      `자기 이름을 --as <이름>으로 지정하세요. 현재 주소록: ${contacts.join(', ')}`,
      { contacts },
    )
  }
  if (!contacts.includes(as)) {
    throw new TwitError('NOT_FOUND', `주소록에 없는 이름입니다: ${as}`, { as, contacts })
  }
  return { contacts, as }
}

export function requireName(
  value: string | undefined,
  contacts: string[],
  kind: '--from' | '--to',
): string {
  const name = value?.trim()
  if (!name) {
    throw new TwitError('VALIDATION_ERROR', `${kind} 이름이 필요합니다. 현재 주소록: ${contacts.join(', ')}`)
  }
  if (!contacts.includes(name)) {
    throw new TwitError('NOT_FOUND', `주소록에 없는 이름입니다: ${name}`, { [kind]: name, contacts })
  }
  return name
}
