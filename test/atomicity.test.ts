import Database from 'better-sqlite3'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createHome, run, setup, testHome } from './helpers.js'

beforeEach(() => {
  createHome()
})

describe('원자성', () => {
  it('requests 삽입이 실패하면 messages와 receipts도 남지 않는다', async () => {
    await setup()
    // 사전에 한 건을 성공시켜 기준 행 수를 만든다
    expect(
      (await run('dane', ['send', '--to', 'codex-1', '--subject', '기준', '--body', 'b', '--json'])).code,
    ).toBe(0)

    // 저장 실패 강제: requests INSERT를 ABORT하는 트리거를 심는다
    const db = new Database(path.join(testHome(), 'twit.db'))
    try {
      db.exec(`CREATE TRIGGER force_requests_failure BEFORE INSERT ON requests
        BEGIN SELECT RAISE(ABORT, 'forced failure'); END`)
    } finally {
      db.close()
    }

    const r = await run('dane', [
      'send', '--to', 'codex-1', '--subject', '실패할 전송', '--body', 'b', '--request-id', 'req-x', '--json',
    ])
    expect(r.code).toBe(6)
    expect(r.json?.error?.code).toBe('STORAGE_ERROR')

    const after = new Database(path.join(testHome(), 'twit.db'), { readonly: true })
    try {
      const counts = after
        .prepare(
          `SELECT (SELECT COUNT(*) FROM messages) AS messages,
                  (SELECT COUNT(*) FROM receipts) AS receipts,
                  (SELECT COUNT(*) FROM requests) AS requests`,
        )
        .get() as { messages: number; receipts: number; requests: number }
      expect(counts).toEqual({ messages: 1, receipts: 1, requests: 0 })
    } finally {
      after.close()
    }
  })

  it('read와 archive의 갱신 실패도 STORAGE_ERROR다', async () => {
    await setup()
    expect((await run('dane', ['send', '--to', 'codex-1', '--subject', '요청', '--body', 'b', '--json'])).code).toBe(0)

    // receipts 갱신을 모두 ABORT하는 트리거로 저장 실패를 강제한다
    const db = new Database(path.join(testHome(), 'twit.db'))
    try {
      db.exec(`CREATE TRIGGER force_receipt_update_failure BEFORE UPDATE ON receipts
        BEGIN SELECT RAISE(ABORT, 'forced failure'); END`)
    } finally {
      db.close()
    }

    for (const args of [['read', 'M-001'], ['archive', 'M-001'], ['unarchive', 'M-001']]) {
      const r = await run('codex-1', [...args, '--json'])
      expect(r.code).toBe(6)
      expect(r.json?.error?.code).toBe('STORAGE_ERROR')
    }
  })

  it('답장도 같은 트랜잭션으로 저장된다', async () => {
    await setup()
    expect((await run('dane', ['send', '--to', 'codex-1', '--subject', '요청', '--body', 'b', '--json'])).code).toBe(0)
    expect((await run('codex-1', ['reply', 'M-001', '--body', '답장', '--json'])).code).toBe(0)

    const after = new Database(path.join(testHome(), 'twit.db'), { readonly: true })
    try {
      const counts = after
        .prepare('SELECT (SELECT COUNT(*) FROM messages) AS messages, (SELECT COUNT(*) FROM receipts) AS receipts')
        .get() as { messages: number; receipts: number }
      expect(counts).toEqual({ messages: 2, receipts: 2 })
    } finally {
      after.close()
    }
  })
})
