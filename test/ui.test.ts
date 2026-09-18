import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { run, setup, testHome } from './helpers.js'
import { getThreadForUi, listThreads } from '../src/core/queries.js'
import { openDatabase } from '../src/store/db.js'
import { resolveDbPath } from '../src/core/context.js'
import { startUiServer, type UiServer } from '../src/ui/server.js'

beforeEach(async () => {
  await setup()
})

async function seedTwoThreads(): Promise<void> {
  expect(
    (await run(['send', '--from', 'claude', '--to', 'codex', '--subject', '첫번째', '--body', '알파 본문', '--json'])).code,
  ).toBe(0)
  expect((await run(['reply', 'M-001', '--as', 'codex', '--body', '알파 답장', '--json'])).code).toBe(0)
  expect(
    (await run(['send', '--from', 'dane', '--to', 'grok', '--subject', '두번째', '--body', '베타 본문', '--json'])).code,
  ).toBe(0)
  expect((await run(['reply', 'M-003', '--as', 'grok', '--body', '베타 답장', '--json'])).code).toBe(0)
}

function openTestDb(): DatabaseSync {
  return openDatabase(resolveDbPath({ TWIT_HOME: testHome() }))
}

async function withServer(
  fn: (server: UiServer, db: DatabaseSync) => Promise<void>,
): Promise<void> {
  const db = openTestDb()
  const server = await startUiServer(db)
  try {
    await fn(server, db)
  } finally {
    await server.close()
    db.close()
  }
}

describe('관찰자 조회', () => {
  it('대화를 마지막 seq 역순으로 나열하고 최초 제목·미리보기를 담는다', async () => {
    await seedTwoThreads()
    const db = openTestDb()
    try {
      const threads = listThreads(db)
      expect(threads.map((t) => t.thread_id)).toEqual(['M-003', 'M-001'])
      expect(threads[0]).toMatchObject({
        thread_id: 'M-003',
        subject: '두번째',
        participants: ['dane', 'grok'],
        message_count: 2,
        last_id: 'M-004',
        preview: '베타 답장',
      })
      expect(threads[0]).not.toHaveProperty('body')
      expect(threads[1]).toMatchObject({
        thread_id: 'M-001',
        subject: '첫번째',
        participants: ['claude', 'codex'],
        message_count: 2,
        last_id: 'M-002',
        preview: '알파 답장',
      })
      expect(typeof threads[0].last_at).toBe('string')
    } finally {
      db.close()
    }
  })

  it('대화 ID와 속한 메시지 ID로 같은 본문 목록을 오래된 순으로 돌려준다', async () => {
    await seedTwoThreads()
    const db = openTestDb()
    try {
      const viaOrigin = getThreadForUi(db, 'M-001')
      const viaReply = getThreadForUi(db, 'M-002')
      expect(viaOrigin?.thread_id).toBe('M-001')
      expect(viaReply?.thread_id).toBe('M-001')
      expect(viaOrigin?.subject).toBe('첫번째')
      expect(viaOrigin?.participants).toEqual(['claude', 'codex'])
      expect(viaOrigin?.messages.map((m) => m.id)).toEqual(['M-001', 'M-002'])
      expect(viaOrigin?.messages[0]).toMatchObject({
        sender: 'claude',
        recipient: 'codex',
        body: '알파 본문',
        read: false,
        archived: false,
      })
      // 발신자 행: as-scoped toMeta면 null이 된다. 관찰자는 항상 boolean.
      expect(viaOrigin?.messages[1]).toMatchObject({
        sender: 'codex',
        recipient: 'claude',
        body: '알파 답장',
        read: false,
        archived: false,
      })
      expect(viaOrigin?.messages[1]?.read).toBe(false)
      expect(viaOrigin?.messages[1]?.archived).toBe(false)
      expect(viaOrigin?.messages[0]).not.toHaveProperty('preview')
      expect(viaOrigin?.messages).toEqual(viaReply?.messages)
    } finally {
      db.close()
    }
  })

  it('없는 ID는 undefined다', async () => {
    await seedTwoThreads()
    const db = openTestDb()
    try {
      expect(getThreadForUi(db, 'M-999')).toBeUndefined()
    } finally {
      db.close()
    }
  })

  it('수신자 read 이후 표시는 바뀌고 조회만으로는 receipts가 불변이다', async () => {
    await seedTwoThreads()
    const snapshot = (db: DatabaseSync) =>
      db.prepare('SELECT message_id, read_at, archived FROM receipts ORDER BY message_id').all()

    const beforeDb = openTestDb()
    let before: unknown
    try {
      before = snapshot(beforeDb)
      expect(getThreadForUi(beforeDb, 'M-001')?.messages[0]?.read).toBe(false)
    } finally {
      beforeDb.close()
    }

    expect((await run(['read', 'M-001', '--as', 'codex', '--json'])).code).toBe(0)

    const afterRead = openTestDb()
    try {
      expect(getThreadForUi(afterRead, 'M-001')?.messages[0]?.read).toBe(true)
    } finally {
      afterRead.close()
    }

    const probe = openTestDb()
    let mid: unknown
    try {
      mid = snapshot(probe)
      getThreadForUi(probe, 'M-001')
      listThreads(probe)
      expect(snapshot(probe)).toEqual(mid)
    } finally {
      probe.close()
    }

    expect(mid).not.toEqual(before)
  })

  it('archive 이후에도 archived는 boolean true다', async () => {
    await seedTwoThreads()
    expect((await run(['archive', 'M-001', '--as', 'codex', '--json'])).code).toBe(0)
    const db = openTestDb()
    try {
      const msg = getThreadForUi(db, 'M-001')?.messages[0]
      expect(msg?.archived).toBe(true)
      expect(typeof msg?.archived).toBe('boolean')
    } finally {
      db.close()
    }
  })
})

describe('UI HTTP', () => {
  it('GET /api/threads가 마지막 seq 역순 목록을 돌려준다', async () => {
    await seedTwoThreads()
    await withServer(async (server) => {
      const res = await fetch(`${server.url}/api/threads`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/application\/json/)
      const body = (await res.json()) as { threads: { thread_id: string; body?: string }[] }
      expect(body.threads.map((t) => t.thread_id)).toEqual(['M-003', 'M-001'])
      expect(body.threads[0]).not.toHaveProperty('body')
    })
  })

  it('GET /api/threads/:id 는 대화 ID와 답장 ID가 같다', async () => {
    await seedTwoThreads()
    await withServer(async (server) => {
      const a = await fetch(`${server.url}/api/threads/M-001`)
      const b = await fetch(`${server.url}/api/threads/M-002`)
      expect(a.status).toBe(200)
      const da = (await a.json()) as { thread_id: string; messages: { id: string; body: string }[] }
      const detailB = (await b.json()) as { thread_id: string; messages: { id: string }[] }
      expect(da.thread_id).toBe('M-001')
      expect(da.messages.map((m) => m.id)).toEqual(['M-001', 'M-002'])
      expect(da.messages[0].body).toBe('알파 본문')
      expect(detailB.messages.map((m) => m.id)).toEqual(da.messages.map((m) => m.id))
    })
  })

  it('없는 대화는 404, POST는 405다', async () => {
    await seedTwoThreads()
    await withServer(async (server) => {
      const missing = await fetch(`${server.url}/api/threads/M-999`)
      expect(missing.status).toBe(404)
      expect(await missing.json()).toEqual({ error: 'NOT_FOUND' })

      const posted = await fetch(`${server.url}/api/threads`, { method: 'POST' })
      expect(posted.status).toBe(405)
      expect(await posted.json()).toEqual({ error: 'METHOD_NOT_ALLOWED' })
    })
  })

  it('GET만으로는 receipts가 바뀌지 않는다', async () => {
    await seedTwoThreads()
    await withServer(async (server, db) => {
      const snap = () =>
        db.prepare('SELECT message_id, read_at, archived FROM receipts ORDER BY message_id').all()
      const before = snap()
      await fetch(`${server.url}/api/threads`)
      await fetch(`${server.url}/api/threads/M-001`)
      expect(snap()).toEqual(before)
    })
  })

  it('127.0.0.1에만 붙는다', async () => {
    await withServer(async (server) => {
      expect(server.url.startsWith('http://127.0.0.1:')).toBe(true)
      expect(typeof server.port).toBe('number')
    })
  })
})
