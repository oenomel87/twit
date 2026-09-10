import { beforeEach, describe, expect, it } from 'vitest'
import { createHome, run, setup } from './helpers.js'

beforeEach(async () => {
  await setup()
})

describe('권한', () => {
  it('제삼자는 다른 사람 사이의 메시지를 읽을 수 없다', async () => {
    expect(
      (await run(['send', '--from', 'claude', '--to', 'codex', '--subject', '요청', '--body', 'b', '--json'])).code,
    ).toBe(0)
    const r = await run(['read', 'M-001', '--as', 'opencode', '--json'])
    expect(r.code).toBe(4)
    expect(r.json?.error?.code).toBe('FORBIDDEN')
  })

  it('제삼자의 인박스와 보낸함에는 메시지가 없다', async () => {
    await run(['send', '--from', 'claude', '--to', 'codex', '--subject', '요청', '--body', 'b', '--json'])
    const inbox = await run(['inbox', '--as', 'opencode', '--json'])
    expect(inbox.json?.data).toEqual({ messages: [] })
    const sent = await run(['sent', '--as', 'opencode', '--json'])
    expect(sent.json?.data).toEqual({ messages: [] })
  })

  it('수신자와 발신자는 읽을 수 있다', async () => {
    await run(['send', '--from', 'claude', '--to', 'codex', '--subject', '요청', '--body', 'b', '--json'])
    expect((await run(['read', 'M-001', '--as', 'codex', '--json'])).code).toBe(0)
    expect((await run(['read', 'M-001', '--as', 'claude', '--json'])).code).toBe(0)
  })
})
