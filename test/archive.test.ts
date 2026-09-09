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

describe('archive와 unarchive', () => {
  it('보관하면 기본 인박스에서 숨고 --archived에서 보인다', async () => {
    await seed()
    const r = await run('codex-1', ['archive', 'M-001', '--json'])
    expect(r.code).toBe(0)
    expect(r.json?.data).toEqual({ id: 'M-001', archived: true })

    const inbox = await run('codex-1', ['inbox', '--json'])
    expect(inbox.json?.data).toEqual({ messages: [] })

    const archived = await run('codex-1', ['inbox', '--archived', '--json'])
    expect((archived.json?.data?.messages as Record<string, unknown>[]).map((m) => m.id)).toEqual([
      'M-001',
    ])
  })

  it('복원하면 기본 인박스에 다시 나타난다', async () => {
    await seed()
    await run('codex-1', ['archive', 'M-001'])
    const r = await run('codex-1', ['unarchive', 'M-001', '--json'])
    expect(r.code).toBe(0)
    expect(r.json?.data).toEqual({ id: 'M-001', archived: false })
    const inbox = await run('codex-1', ['inbox', '--json'])
    expect((inbox.json?.data?.messages as unknown[]).length).toBe(1)
  })

  it('반복해도 같은 최종 상태로 성공한다', async () => {
    await seed()
    for (let i = 0; i < 2; i++) {
      expect((await run('codex-1', ['archive', 'M-001', '--json'])).code).toBe(0)
    }
    for (let i = 0; i < 2; i++) {
      expect((await run('codex-1', ['unarchive', 'M-001', '--json'])).code).toBe(0)
    }
  })

  it('읽음 상태와 원문을 바꾸지 않는다', async () => {
    await seed()
    await run('codex-1', ['read', 'M-001'])
    await run('codex-1', ['archive', 'M-001'])
    const all = await run('codex-1', ['inbox', '--all', '--json'])
    const row = (all.json?.data?.messages as Record<string, unknown>[])[0]
    expect(row).toMatchObject({ read: true, archived: true, subject: '요청', body_length: '본문'.length })

    // 읽지 않은 메시지를 보관해도 읽음으로 변하지 않는다
    await run('dane', ['send', '--to', 'codex-1', '--subject', '둘째', '--body', 'b2', '--json'])
    await run('codex-1', ['archive', 'M-002'])
    const all2 = await run('codex-1', ['inbox', '--archived', '--json'])
    const row2 = (all2.json?.data?.messages as Record<string, unknown>[]).find((m) => m.id === 'M-002')
    expect(row2).toMatchObject({ read: false, archived: true })
  })

  it('보관한 대화의 새 답장은 기본 인박스에 나타난다', async () => {
    await seed()
    await run('codex-1', ['archive', 'M-001'])
    await run('codex-1', ['reply', 'M-001', '--body', '보관했지만 답장', '--json'])
    const inbox = await run('dane', ['inbox', '--json'])
    const messages = inbox.json?.data?.messages as Record<string, unknown>[]
    expect(messages.map((m) => m.id)).toEqual(['M-002'])
    expect(messages[0]).toMatchObject({ read: false, archived: false })
  })

  it('수신자만 보관할 수 있다', async () => {
    await seed()
    const sender = await run('dane', ['archive', 'M-001', '--json'])
    expect(sender.code).toBe(4)
    expect(sender.json?.error?.code).toBe('FORBIDDEN')
    const third = await run('opencode-1', ['archive', 'M-001', '--json'])
    expect(third.code).toBe(4)
    const missing = await run('codex-1', ['archive', 'M-999', '--json'])
    expect(missing.code).toBe(3)
  })

  it('텍스트 모드 --all은 보관 표시를 붙인다', async () => {
    await seed()
    await run('codex-1', ['archive', 'M-001'])
    const r = await run('codex-1', ['inbox', '--all'])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('[A]')
  })
})
