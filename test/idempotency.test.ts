import { beforeEach, describe, expect, it } from 'vitest'
import { createHome, run, setup } from './helpers.js'

beforeEach(() => {
  createHome()
})

async function seed(): Promise<void> {
  await setup()
  expect(
    (await run('dane', ['send', '--to', 'codex-1', '--subject', '요청', '--body', '본문', '--json'])).code,
  ).toBe(0)
}

describe('send의 --request-id', () => {
  it('같은 키와 같은 내용 재전송은 같은 메시지를 replayed: true로 돌려준다', async () => {
    await setup()
    const first = await run('dane', [
      'send', '--to', 'codex-1', '--subject', '요청', '--body', '본문', '--request-id', 'req-1', '--json',
    ])
    expect(first.code).toBe(0)
    expect(first.json?.data?.replayed).toBe(false)
    const second = await run('dane', [
      'send', '--to', 'codex-1', '--subject', '요청', '--body', '본문', '--request-id', 'req-1', '--json',
    ])
    expect(second.code).toBe(0)
    expect(second.json?.data?.replayed).toBe(true)
    expect(second.json?.data?.message?.id).toBe(first.json?.data?.message?.id)

    const inbox = await run('codex-1', ['inbox', '--json'])
    expect((inbox.json?.data?.messages as unknown[]).length).toBe(1)
  })

  it('같은 키에 다른 내용이면 REQUEST_ID_CONFLICT다', async () => {
    await setup()
    await run('dane', ['send', '--to', 'codex-1', '--subject', '요청', '--body', '본문', '--request-id', 'req-1', '--json'])
    const r = await run('dane', [
      'send', '--to', 'codex-1', '--subject', '요청', '--body', '다른 본문', '--request-id', 'req-1', '--json',
    ])
    expect(r.code).toBe(5)
    expect(r.json?.error?.code).toBe('REQUEST_ID_CONFLICT')
  })

  it('다른 키는 새 메시지다', async () => {
    await setup()
    await run('dane', ['send', '--to', 'codex-1', '--subject', 's', '--body', 'b', '--request-id', 'a', '--json'])
    const r = await run('dane', ['send', '--to', 'codex-1', '--subject', 's', '--body', 'b', '--request-id', 'b', '--json'])
    expect(r.code).toBe(0)
    expect(r.json?.data?.replayed).toBe(false)
    expect(r.json?.data?.message?.id).toBe('M-002')
  })

  it('요청 키는 발신자별로 구분된다', async () => {
    await setup()
    await run('dane', ['send', '--to', 'codex-1', '--subject', 's', '--body', 'b', '--json'])
    await run('dane', ['send', '--to', 'codex-1', '--subject', 's', '--body', 'b', '--request-id', 'shared', '--json'])
    const r = await run('codex-1', [
      'reply', 'M-001', '--body', '답장', '--request-id', 'shared', '--json',
    ])
    expect(r.code).toBe(0)
    expect(r.json?.data?.replayed).toBe(false)
  })

  it('요청 키 없는 재호출은 매번 새 메시지다', async () => {
    await setup()
    await run('dane', ['send', '--to', 'codex-1', '--subject', 's', '--body', 'b', '--json'])
    const r = await run('dane', ['send', '--to', 'codex-1', '--subject', 's', '--body', 'b', '--json'])
    expect(r.json?.data?.replayed).toBe(false)
    expect(r.json?.data?.message?.id).toBe('M-002')
  })
})

describe('reply의 --request-id', () => {
  it('같은 키 재답장은 중복 없이 기존 메시지를 돌려준다', async () => {
    await seed()
    const first = await run('codex-1', ['reply', 'M-001', '--body', '답장', '--request-id', 'r1', '--json'])
    expect(first.code).toBe(0)
    const second = await run('codex-1', ['reply', 'M-001', '--body', '답장', '--request-id', 'r1', '--json'])
    expect(second.code).toBe(0)
    expect(second.json?.data?.replayed).toBe(true)
    expect(second.json?.data?.message?.id).toBe(first.json?.data?.message?.id)
  })

  it('같은 키로 다른 메시지에 답장하면 충돌이다', async () => {
    await seed()
    await run('dane', ['send', '--to', 'codex-1', '--subject', '두번째', '--body', 'b2', '--json'])
    await run('codex-1', ['reply', 'M-001', '--body', '답장', '--request-id', 'r1', '--json'])
    const r = await run('codex-1', ['reply', 'M-002', '--body', '답장', '--request-id', 'r1', '--json'])
    expect(r.code).toBe(5)
    expect(r.json?.error?.code).toBe('REQUEST_ID_CONFLICT')
  })

  it('같은 키에 다른 본문이면 거절된다', async () => {
    await seed()
    await run('codex-1', ['reply', 'M-001', '--body', '답장', '--request-id', 'r1', '--json'])
    const r = await run('codex-1', ['reply', 'M-001', '--body', '다른 답장', '--request-id', 'r1', '--json'])
    expect(r.code).toBe(5)
  })
})
