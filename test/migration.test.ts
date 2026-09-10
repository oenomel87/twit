import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createHome, run, setup, testHome } from './helpers.js'
import { hashInput } from '../src/core/idempotency.js'
import { openDatabase } from '../src/store/db.js'
import { MIGRATIONS } from '../src/store/schema.js'

beforeEach(async () => {
  await setup()
})

/** 마이그레이션 1(1차 구현) 스키마의 DB를 만들고 샘플 데이터를 넣는다. */
function createLegacyDb(dbPath: string): void {
  const db = new DatabaseSync(dbPath)
  try {
    db.exec('PRAGMA foreign_keys = OFF')
    // 마이그레이션 1은 schema_migrations 생성을 포함하지 않는다(도구가 담당). 여기서 직접 만든다.
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
)`)
    const migration1 = MIGRATIONS[0] as { statements: string[] }
    db.exec('BEGIN IMMEDIATE')
    for (const statement of migration1.statements) db.exec(statement)
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
      1,
      new Date().toISOString(),
    )
    db.exec('COMMIT')

    db.prepare('INSERT INTO contacts (id, display_name, created_at) VALUES (?, ?, ?)').run(
      'claude-1',
      'Claude Code',
      new Date().toISOString(),
    )
    db.prepare('INSERT INTO contacts (id, display_name, created_at) VALUES (?, ?, ?)').run(
      'codex-1',
      'Codex 1',
      new Date().toISOString(),
    )
    db.prepare(
      `INSERT INTO messages (seq, id, thread_id, reply_to_id, sender_id, recipient_id, subject, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(1, 'M-001', 'M-001', null, 'claude-1', 'codex-1', '이전 버전의 요청', '1차 구현 본문', new Date().toISOString())
    db.prepare('INSERT INTO receipts (message_id, read_at, archived) VALUES (?, ?, ?)').run(
      'M-001',
      '2026-09-09T15:00:00.000Z',
      1,
    )
    db.prepare(
      'INSERT INTO requests (sender_id, request_id, input_hash, message_id, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(
      'claude-1',
      'legacy-key',
      hashInput({ command: 'send', to: 'codex-1', subject: '이전 버전의 요청', body: '1차 구현 본문' }),
      'M-001',
      new Date().toISOString(),
    )
  } finally {
    db.close()
  }
}

describe('마이그레이션 2: 외래키 제거와 contacts 삭제', () => {
  it('1차 구현의 DB를 열면 전환되고 모든 데이터가 보존된다', async () => {
    createLegacyDb(path.join(testHome(), 'twit.db'))

    const db = openDatabase(path.join(testHome(), 'twit.db'))
    try {
      // 마이그레이션이 2까지 적용됐다
      const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
      expect(versions).toEqual([{ version: 1 }, { version: 2 }])

      // contacts 테이블은 사라지고, messages는 외래키 없이 이름 문자열을 유지한다
      const tables = (
        db
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
          .all() as { name: string }[]
      ).map((row) => row.name)
      expect(tables).toEqual(['messages', 'receipts', 'requests', 'schema_migrations'])
      // contacts를 가리키던 외래키는 사라지고, reply_to_id의 자기 참조만 남는다
      const foreignKeys = db.prepare('PRAGMA foreign_key_list(messages)').all() as unknown as { table: string }[]
      expect(foreignKeys.map((fk) => fk.table)).toEqual(['messages'])

      // 메시지·수신 상태·요청 키가 모두 보존된다
      const message = db.prepare('SELECT * FROM messages WHERE id = ?').get('M-001') as Record<string, unknown>
      expect(message).toMatchObject({
        seq: 1,
        thread_id: 'M-001',
        reply_to_id: null,
        sender_id: 'claude-1',
        recipient_id: 'codex-1',
        subject: '이전 버전의 요청',
        body: '1차 구현 본문',
      })
      const receipt = db.prepare('SELECT * FROM receipts WHERE message_id = ?').get('M-001') as Record<string, unknown>
      expect(receipt).toMatchObject({ read_at: '2026-09-09T15:00:00.000Z', archived: 1 })
      const request = db.prepare('SELECT * FROM requests WHERE sender_id = ? AND request_id = ?').get('claude-1', 'legacy-key') as Record<string, unknown>
      expect(request).toMatchObject({ message_id: 'M-001' })
    } finally {
      db.close()
    }

    // 전환 후에도 기존 메시지가 조회된다. 레거시 receipt는 보관 상태이므로 --all로 확인한다
    const inbox = await run(['inbox', '--as', 'codex-1', '--all', '--json'], { contacts: 'dane,claude-1,codex-1,claude,codex,opencode,grok' })
    expect(inbox.code).toBe(0)
    const messages = inbox.json?.data?.messages as Record<string, unknown>[]
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: 'M-001',
      sender: 'claude-1',
      recipient: 'codex-1',
      subject: '이전 버전의 요청',
      read: true,
      archived: true,
    })
  })

  it('전환 후에도 요청 키 재전송은 replayed로 유지된다', async () => {
    createLegacyDb(path.join(testHome(), 'twit.db'))

    // 1차 구현 때 쓰던 내용과 같은 본문으로 같은 키를 재전송한다
    const r = await run([
      'send', '--from', 'claude-1', '--to', 'codex-1', '--subject', '이전 버전의 요청',
      '--body', '1차 구현 본문', '--request-id', 'legacy-key', '--json',
    ], { contacts: 'dane,claude-1,codex-1,claude,codex,opencode,grok' })
    expect(r.code).toBe(0)
    expect(r.json?.data?.replayed).toBe(true)
    expect(r.json?.data?.message?.id).toBe('M-001')

    const inbox = await run(['inbox', '--as', 'codex-1', '--all', '--json'], { contacts: 'dane,claude-1,codex-1,claude,codex,opencode,grok' })
    expect((inbox.json?.data?.messages as unknown[]).length).toBe(1)
  })

  it('중간에 실패하면 원래 스키마와 데이터가 남고, 장애물을 치우면 다시 전환된다', async () => {
    createLegacyDb(path.join(testHome(), 'twit.db'))
    const dbPath = path.join(testHome(), 'twit.db')

    // 마이그레이션 2의 CREATE TABLE messages_new가 실패하도록 같은 이름의 테이블을 미리 만든다
    const obstacle = new DatabaseSync(dbPath)
    try {
      obstacle.exec('CREATE TABLE messages_new (x)')
    } finally {
      obstacle.close()
    }

    expect(() => openDatabase(dbPath)).toThrow()

    // 원래 스키마와 데이터가 남아 있다
    const before = new DatabaseSync(dbPath)
    try {
      const tables = (
        before
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
          .all() as { name: string }[]
      ).map((row) => row.name)
      expect(tables).toContain('contacts')
      const versions = before.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
      expect(versions).toEqual([{ version: 1 }])
      const messages = before.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }
      expect(messages.n).toBe(1)
    } finally {
      before.close()
    }

    // 장애물을 치우면 다시 실행에서 정상 전환된다
    const cleanup = new DatabaseSync(dbPath)
    try {
      cleanup.exec('DROP TABLE messages_new')
    } finally {
      cleanup.close()
    }
    const db = openDatabase(dbPath)
    try {
      const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
      expect(versions).toEqual([{ version: 1 }, { version: 2 }])
      const message = db.prepare('SELECT * FROM messages WHERE id = ?').get('M-001') as Record<string, unknown>
      expect(message.body).toBe('1차 구현 본문')
    } finally {
      db.close()
    }
  })
})
