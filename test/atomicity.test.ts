import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createHome, run, setup, testHome } from './helpers.js'

beforeEach(async () => {
  await setup()
})

describe('원자성', () => {
  it('requests 삽입이 실패하면 messages와 receipts도 남지 않는다', async () => {
    // 기준 행 수를 만든다
    expect(
      (await run(['send', '--from', 'claude', '--to', 'codex', '--subject', '기준', '--body', 'b', '--json'])).code,
    ).toBe(0)

    // 저장 실패 강제: requests INSERT를 ABORT하는 트리거를 심는다
    const db = new DatabaseSync(path.join(testHome(), 'twit.db'))
    try {
      db.exec(`CREATE TRIGGER force_requests_failure BEFORE INSERT ON requests
        BEGIN SELECT RAISE(ABORT, 'forced failure'); END`)
    } finally {
      db.close()
    }

    const r = await run([
      'send', '--from', 'claude', '--to', 'codex', '--subject', '실패할 전송', '--body', 'b', '--request-id', 'req-x', '--json',
    ])
    expect(r.code).toBe(6)
    expect(r.json?.error?.code).toBe('STORAGE_ERROR')

    const after = new DatabaseSync(path.join(testHome(), 'twit.db'))
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
    expect(
      (await run(['send', '--from', 'claude', '--to', 'codex', '--subject', '요청', '--body', 'b', '--json'])).code,
    ).toBe(0)

    // receipts 갱신을 모두 ABORT하는 트리거로 저장 실패를 강제한다
    const db = new DatabaseSync(path.join(testHome(), 'twit.db'))
    try {
      db.exec(`CREATE TRIGGER force_receipt_update_failure BEFORE UPDATE ON receipts
        BEGIN SELECT RAISE(ABORT, 'forced failure'); END`)
    } finally {
      db.close()
    }

    for (const args of [['read', 'M-001'], ['archive', 'M-001'], ['unarchive', 'M-001']]) {
      const r = await run([...args, '--as', 'codex', '--json'])
      expect(r.code).toBe(6)
      expect(r.json?.error?.code).toBe('STORAGE_ERROR')
    }
  })

  it('여러 건 읽기 중 하나라도 문제가 있으면 어느 것도 읽음 처리되지 않는다', async () => {
    for (const subject of ['첫째', '둘째', '셋째']) {
      expect(
        (await run(['send', '--from', 'claude', '--to', 'codex', '--subject', subject, '--body', 'b', '--json'])).code,
      ).toBe(0)
    }

    // 없는 ID가 섞인 경우
    const missing = await run(['read', 'M-001', 'M-999', '--as', 'codex', '--json'])
    expect(missing.code).toBe(3)

    // 권한 없는 ID가 섞인 경우(M-003은 opencode가 받은 메시지가 아니라 codex가 받았다. 권한 없는 건 opencode로 읽는다)
    await run(['send', '--from', 'claude', '--to', 'opencode', '--subject', '넷째', '--body', 'b', '--json'])
    const forbidden = await run(['read', 'M-001', 'M-004', '--as', 'codex', '--json'])
    expect(forbidden.code).toBe(4)

    // 두 경우 모두 아무것도 읽음 처리되지 않았다
    const inbox = await run(['inbox', '--as', 'codex', '--json'])
    expect(
      (inbox.json?.data?.messages as Record<string, unknown>[]).every((m) => m.read === false),
    ).toBe(true)
  })

  it('여러 건 읽기의 중간 UPDATE가 실패하면 전체가 롤백된다', async () => {
    for (const subject of ['첫째', '둘째']) {
      expect(
        (await run(['send', '--from', 'claude', '--to', 'codex', '--subject', subject, '--body', 'b', '--json'])).code,
      ).toBe(0)
    }

    // M-002(둘째)의 갱신만 실패시키는 트리거다. 날짜 조건으로 M-001의 갱신은 통과시킨다
    const db = new DatabaseSync(path.join(testHome(), 'twit.db'))
    try {
      db.exec(`CREATE TRIGGER fail_on_second_read AFTER UPDATE ON receipts
        WHEN NEW.message_id = 'M-002'
        BEGIN SELECT RAISE(ABORT, 'forced failure'); END`)
    } finally {
      db.close()
    }

    const r = await run(['read', 'M-001', 'M-002', '--as', 'codex', '--json'])
    expect(r.code).toBe(6)
    expect(r.json?.error?.code).toBe('STORAGE_ERROR')

    // 트리거를 치운 뒤 상태를 확인한다. M-001도 읽음 처리되어 있지 않아야 한다
    const cleanup = new DatabaseSync(path.join(testHome(), 'twit.db'))
    try {
      cleanup.exec('DROP TRIGGER fail_on_second_read')
    } finally {
      cleanup.close()
    }
    const inbox = await run(['inbox', '--as', 'codex', '--json'])
    expect(
      (inbox.json?.data?.messages as Record<string, unknown>[]).every((m) => m.read === false),
    ).toBe(true)
  })

  it('답장도 같은 트랜잭션으로 저장된다', async () => {
    expect(
      (await run(['send', '--from', 'claude', '--to', 'codex', '--subject', '요청', '--body', 'b', '--json'])).code,
    ).toBe(0)
    expect((await run(['reply', 'M-001', '--as', 'codex', '--body', '답장', '--json'])).code).toBe(0)

    const after = new DatabaseSync(path.join(testHome(), 'twit.db'))
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
