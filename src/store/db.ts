import { mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import { TwitError } from '../core/errors.js'
import { MIGRATIONS } from './schema.js'

export type { SqliteDatabase }

export function openDatabase(filePath: string): SqliteDatabase {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    const db = new Database(filePath)
    db.pragma('journal_mode = WAL')
    db.pragma('busy_timeout = 5000')
    db.pragma('foreign_keys = ON')
    db.pragma('synchronous = NORMAL')
    migrate(db)
    return db
  } catch (err) {
    if (err instanceof TwitError) throw err
    throw new TwitError(
      'STORAGE_ERROR',
      `데이터베이스를 열거나 준비하지 못했습니다: ${filePath}`,
      { cause: String(err) },
    )
  }
}

function migrate(db: SqliteDatabase): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
)`)
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
      (row) => row.version,
    ),
  )
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue
    const apply = db.transaction(() => {
      for (const statement of migration.statements) db.exec(statement)
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        migration.version,
        new Date().toISOString(),
      )
    })
    apply.immediate()
  }
}
