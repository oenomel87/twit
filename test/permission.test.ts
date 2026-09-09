import { beforeEach, describe, expect, it } from 'vitest'
import { createHome, run, setup } from './helpers.js'

beforeEach(() => {
  createHome()
})

describe('권한', () => {
  it('제삼자는 다른 사람 사이의 메시지를 읽을 수 없다', async () => {
    await setup()
    expect(
      (await run('dane', ['send', '--to', 'codex-1', '--subject', '요청', '--body', 'b', '--json'])).code,
    ).toBe(0)
    const r = await run('opencode-1', ['read', 'M-001', '--json'])
    expect(r.code).toBe(4)
    expect(r.json?.error?.code).toBe('FORBIDDEN')
  })

  it('제삼자의 인박스와 보낸함에는 메시지가 없다', async () => {
    await setup()
    await run('dane', ['send', '--to', 'codex-1', '--subject', '요청', '--body', 'b', '--json'])
    const inbox = await run('opencode-1', ['inbox', '--json'])
    expect(inbox.json?.data).toEqual({ messages: [] })
    const sent = await run('opencode-1', ['sent', '--json'])
    expect(sent.json?.data).toEqual({ messages: [] })
  })

  it('수신자와 발신자는 읽을 수 있다', async () => {
    await setup()
    await run('dane', ['send', '--to', 'codex-1', '--subject', '요청', '--body', 'b', '--json'])
    expect((await run('codex-1', ['read', 'M-001', '--json'])).code).toBe(0)
    expect((await run('dane', ['read', 'M-001', '--json'])).code).toBe(0)
  })
})
