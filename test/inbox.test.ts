import { beforeEach, describe, expect, it } from 'vitest'
import { createHome, run, setup } from './helpers.js'

beforeEach(() => {
  createHome()
})

async function sendTwo(): Promise<void> {
  await setup()
  expect((await run('dane', ['send', '--to', 'codex-1', '--subject', '첫째', '--body', 'b1', '--json'])).code).toBe(0)
  expect((await run('dane', ['send', '--to', 'codex-1', '--subject', '둘째', '--body', 'b2', '--json'])).code).toBe(0)
}

describe('inbox', () => {
  it('최신순으로 정렬된다', async () => {
    await sendTwo()
    const r = await run('codex-1', ['inbox', '--json'])
    const messages = r.json?.data?.messages as Record<string, unknown>[]
    expect(messages.map((m) => m.id)).toEqual(['M-002', 'M-001'])
  })

  it('--unread는 읽지 않은 메시지만 담는다', async () => {
    await sendTwo()
    await run('codex-1', ['read', 'M-001'])
    const r = await run('codex-1', ['inbox', '--unread', '--json'])
    const messages = r.json?.data?.messages as Record<string, unknown>[]
    expect(messages.map((m) => m.id)).toEqual(['M-002'])
  })

  it('기본 인박스에 읽은 메시지도 포함된다', async () => {
    await sendTwo()
    await run('codex-1', ['read', 'M-001'])
    const r = await run('codex-1', ['inbox', '--json'])
    const messages = r.json?.data?.messages as Record<string, unknown>[]
    expect(messages.map((m) => m.id)).toEqual(['M-002', 'M-001'])
  })

  it('옵션 조합은 VALIDATION_ERROR다', async () => {
    await sendTwo()
    const r = await run('codex-1', ['inbox', '--unread', '--archived', '--json'])
    expect(r.code).toBe(2)
    expect(r.json?.error?.code).toBe('VALIDATION_ERROR')
  })

  it('빈 목록은 정상 결과다', async () => {
    await setup()
    const r = await run('codex-1', ['inbox', '--json'])
    expect(r.code).toBe(0)
    expect(r.json?.data).toEqual({ messages: [] })
    const text = await run('codex-1', ['inbox'])
    expect(text.stdout).toBe('(no messages)\n')
  })

  it('다른 사람이 보낸 메시지는 보이지 않는다', async () => {
    await sendTwo()
    const r = await run('opencode-1', ['inbox', '--json'])
    expect((r.json?.data?.messages as unknown[]).length).toBe(0)
  })

  it('텍스트 목록에 미읽음 표시와 제목이 나온다', async () => {
    await sendTwo()
    await run('codex-1', ['read', 'M-001'])
    const r = await run('codex-1', ['inbox'])
    expect(r.code).toBe(0)
    const lines = r.stdout.trimEnd().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('M-002')
    expect(lines[0]).toContain('*')
    expect(lines[0]).toContain('둘째')
    expect(lines[0]).toContain('dane')
    expect(lines[1]).toContain('M-001')
    expect(lines[1].split('*').length - 1).toBe(0)
  })
})

describe('sent', () => {
  it('자신이 보낸 메시지를 최신순으로 담는다', async () => {
    await sendTwo()
    const r = await run('dane', ['sent', '--json'])
    const messages = r.json?.data?.messages as Record<string, unknown>[]
    expect(messages.map((m) => m.id)).toEqual(['M-002', 'M-001'])
    // 상대의 읽음 상태를 노출하지 않는다
    expect(messages[0].read).toBeNull()
    expect(messages[0].archived).toBeNull()
    expect(messages[0]).not.toHaveProperty('body')
  })

  it('받지 않은 사람의 sent는 비어 있다', async () => {
    await sendTwo()
    const r = await run('opencode-1', ['sent', '--json'])
    expect(r.json?.data).toEqual({ messages: [] })
  })

  it('텍스트 목록에 수신자가 나온다', async () => {
    await sendTwo()
    const r = await run('dane', ['sent'])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('codex-1')
    expect(r.stdout).toContain('첫째')
  })
})
