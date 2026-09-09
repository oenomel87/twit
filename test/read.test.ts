import { beforeEach, describe, expect, it } from 'vitest'
import { createHome, run, setup } from './helpers.js'

beforeEach(() => {
  createHome()
})

describe('read', () => {
  async function sendMessage(): Promise<void> {
    await setup()
    const r = await run('dane', ['send', '--to', 'codex-1', '--subject', '요청', '--body', '본문', '--json'])
    expect(r.code).toBe(0)
  }

  it('수신자가 읽으면 읽음으로 표시된다', async () => {
    await sendMessage()
    const r = await run('codex-1', ['read', 'M-001', '--json'])
    expect(r.code).toBe(0)
    expect(r.json?.data?.marked_read).toBe(true)
    const message = r.json?.data?.message as Record<string, unknown>
    expect(message.read).toBe(true)
    expect(typeof message.read_at).toBe('undefined')
    expect(message).toMatchObject({ id: 'M-001', body: '본문' })
  })

  it('다시 읽으면 marked_read는 false다', async () => {
    await sendMessage()
    await run('codex-1', ['read', 'M-001'])
    const r = await run('codex-1', ['read', 'M-001', '--json'])
    expect(r.code).toBe(0)
    expect(r.json?.data?.marked_read).toBe(false)
    expect((r.json?.data?.message as Record<string, unknown>).read).toBe(true)
  })

  it('발신자가 읽으면 수신자의 읽음 상태가 바뀌지 않는다', async () => {
    await sendMessage()
    const r = await run('dane', ['read', 'M-001', '--json'])
    expect(r.code).toBe(0)
    expect(r.json?.data?.marked_read).toBe(false)
    // 발신자 관점에서 read는 값이 없다
    expect((r.json?.data?.message as Record<string, unknown>).read).toBeNull()

    const inbox = await run('codex-1', ['inbox', '--json'])
    expect((inbox.json?.data?.messages as Record<string, unknown>[])[0].read).toBe(false)
  })

  it('해당 메시지만 읽음 처리한다', async () => {
    await sendMessage()
    await run('dane', ['send', '--to', 'codex-1', '--subject', '두번째', '--body', '본문2', '--json'])
    await run('codex-1', ['read', 'M-001', '--json'])

    const inbox = await run('codex-1', ['inbox', '--json'])
    const messages = inbox.json?.data?.messages as Record<string, unknown>[]
    const first = messages.find((m) => m.id === 'M-001')
    const second = messages.find((m) => m.id === 'M-002')
    expect(first?.read).toBe(true)
    expect(second?.read).toBe(false)
  })

  it('읽기 전후로 inbox와 thread 조회가 상태를 바꾸지 않는다', async () => {
    await sendMessage()
    await run('codex-1', ['inbox'])
    await run('codex-1', ['inbox', '--unread'])
    await run('codex-1', ['sent'])
    const before = await run('codex-1', ['inbox', '--json'])
    expect((before.json?.data?.messages as Record<string, unknown>[])[0].read).toBe(false)
  })

  it('없는 메시지는 NOT_FOUND다', async () => {
    await setup()
    const r = await run('codex-1', ['read', 'M-999', '--json'])
    expect(r.code).toBe(3)
    expect(r.json?.error?.code).toBe('NOT_FOUND')
  })
})
