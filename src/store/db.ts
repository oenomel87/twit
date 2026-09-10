import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { TwitError } from '../core/errors.js'
import { MIGRATIONS } from './schema.js'

export type Db = DatabaseSync

export function isSqliteError(err: unknown): err is Error {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'ERR_SQLITE_ERROR'
}

/** BEGIN IMMEDIATE로 트랜잭션을 열어 fn을 실행하고 커밋한다. 예외 시 롤백한다. */
export function immediate<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // 이미 롤백된 트랜잭션이다
    }
    throw err
  }
}

export function openDatabase(filePath: string): Db {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    const db = new DatabaseSync(filePath)
    // busy_timeout을 가장 먼저 둔다. 동시에 열 때 이후의 모든 잠금 대기가 이 값을 따른다.
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA synchronous = NORMAL')
    migrate(db)
    return db
  } catch (err) {
    if (err instanceof TwitError) throw err
    throw new TwitError(
      'STORAGE_ERROR',
      `데이터베이스를 열거나 준비하지 못했습니다: ${filePath}`,
      { cause: err instanceof Error ? err.message : String(err) },
    )
  }
}

function readVersions(db: Db): Set<number> {
  return new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as unknown as { version: number }[]).map(
      (row) => row.version,
    ),
  )
}

function migrate(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
)`)
  const applied = readVersions(db)
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue
    // 적용 여부를 트랜잭션 안에서 다시 확인한다. 두 프로세스가 동시에 열어도 한쪽만 적용한다.
    try {
      for (const statement of migration.before ?? []) db.exec(statement)
    } catch (err) {
      throw new TwitError('STORAGE_ERROR', `마이그레이션 ${migration.version} 준비에 실패했습니다`, {
        cause: err instanceof Error ? err.message : String(err),
      })
    }
    try {
      immediate(db, () => {
        if (readVersions(db).has(migration.version)) return
        for (const statement of migration.statements) db.exec(statement)
        if (migration.foreignKeyCheck) {
          const violations = db.prepare('PRAGMA foreign_key_check').all()
          if (violations.length > 0) {
            throw new TwitError(
              'STORAGE_ERROR',
              `마이그레이션 ${migration.version}: 외래키 검사가 실패했습니다`,
              { violations: violations.length },
            )
          }
        }
        db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
          migration.version,
          new Date().toISOString(),
        )
      })
    } catch (err) {
      if (err instanceof TwitError) throw err
      throw new TwitError('STORAGE_ERROR', `마이그레이션 ${migration.version}에 실패했습니다`, {
        cause: err instanceof Error ? err.message : String(err),
      })
    } finally {
      for (const statement of migration.after ?? []) db.exec(statement)
    }
  }
}
