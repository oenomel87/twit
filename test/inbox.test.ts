import { beforeEach, describe, expect, it } from 'vitest'
import { createHome, run, setup } from './helpers.js'

beforeEach(async () => {
  await setup()
})

async function sendTwo(): Promise<void> {
  expect((await run(['send', '--from', 'claude', '--to', 'codex', '--subject', '첫째', '--body', 'b1', '--json'])).code).toBe(0)
  expect((await run(['send', '--from', 'claude', '--to', 'codex', '--subject', '둘째', '--body', 'b2', '--json'])).code).toBe(0)
}

describe('inbox', () => {
  it('최신순으로 정렬된다', async () => {
    await sendTwo()
    const r = await run(['inbox', '--as', 'codex', '--json'])
    const messages = r.json?.data?.messages as Record<string, unknown>[]
    expect(messages.map((m) => m.id)).toEqual(['M-002', 'M-001'])
  })

  it('--unread는 읽지 않은 메시지만 담는다', async () => {
    await sendTwo()
    await run(['read', 'M-001', '--as', 'codex'])
    const r = await run(['inbox', '--as', 'codex', '--unread', '--json'])
    const messages = r.json?.data?.messages as Record<string, unknown>[]
    expect(messages.map((m) => m.id)).toEqual(['M-002'])
  })

  it('기본 인박스에 읽은 메시지도 포함된다', async () => {
    await sendTwo()
    await run(['read', 'M-001', '--as', 'codex'])
    const r = await run(['inbox', '--as', 'codex', '--json'])
    const messages = r.json?.data?.messages as Record<string, unknown>[]
    expect(messages.map((m) => m.id)).toEqual(['M-002', 'M-001'])
  })

  it('옵션 조합은 VALIDATION_ERROR다', async () => {
    await sendTwo()
    const r = await run(['inbox', '--as', 'codex', '--unread', '--archived', '--json'])
    expect(r.code).toBe(2)
    expect(r.json?.error?.code).toBe('VALIDATION_ERROR')
  })

  it('빈 목록은 정상 결과다', async () => {
    const r = await run(['inbox', '--as', 'codex', '--json'])
    expect(r.code).toBe(0)
    expect(r.json?.data).toEqual({ messages: [] })
    const text = await run(['inbox', '--as', 'codex'])
    expect(text.stdout).toBe('(no messages)\n')
  })

  it('다른 사람이 받은 메시지는 보이지 않는다', async () => {
    await sendTwo()
    const r = await run(['inbox', '--as', 'opencode', '--json'])
    expect((r.json?.data?.messages as unknown[]).length).toBe(0)
  })

  it('텍스트 목록은 미리보기를 둘째 줄에 들여써서 표시한다', async () => {
    await sendTwo()
    await run(['read', 'M-001', '--as', 'codex'])
    const r = await run(['inbox', '--as', 'codex'])
    expect(r.code).toBe(0)
    const lines = r.stdout.trimEnd().split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[0]).toContain('M-002')
    expect(lines[0]).toContain('*')
    expect(lines[0]).toContain('둘째')
    expect(lines[0]).toContain('claude')
    expect(lines[1]).toBe('  b2')
    expect(lines[2]).toContain('M-001')
    expect(lines[2].split('*').length - 1).toBe(0)
    expect(lines[3]).toBe('  b1')
  })

  it('미리보기는 공백이 아닌 첫 줄이고 본문 응답에는 없다', async () => {
    await run(['send', '--from', 'claude', '--to', 'codex', '--subject', '미리보기', '--body', '\n\n   첫 유효 줄\n둘째', '--json'])
    const inbox = await run(['inbox', '--as', 'codex', '--json'])
    const summary = (inbox.json?.data?.messages as Record<string, unknown>[])[0]
    expect(summary.preview).toBe('첫 유효 줄')

    const read = await run(['read', 'M-001', '--as', 'codex', '--json'])
    const message = read.json?.data?.message as Record<string, unknown>
    expect(message.body).toBe('\n\n   첫 유효 줄\n둘째')
    expect(message).not.toHaveProperty('preview')
  })
})

describe('sent', () => {
  it('자신이 보낸 메시지를 최신순으로 담는다', async () => {
    await sendTwo()
    const r = await run(['sent', '--as', 'claude', '--json'])
    const messages = r.json?.data?.messages as Record<string, unknown>[]
    expect(messages.map((m) => m.id)).toEqual(['M-002', 'M-001'])
    // 상대의 읽음 상태를 노출하지 않는다
    expect(messages[0].read).toBeNull()
    expect(messages[0].archived).toBeNull()
    expect(messages[0]).not.toHaveProperty('body')
    expect(messages[0].preview).toBe('b2')
  })

  it('받지 않은 사람의 sent는 비어 있다', async () => {
    await sendTwo()
    const r = await run(['sent', '--as', 'opencode', '--json'])
    expect(r.json?.data).toEqual({ messages: [] })
  })

  it('텍스트 목록에 수신자가 나온다', async () => {
    await sendTwo()
    const r = await run(['sent', '--as', 'claude'])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('codex')
    expect(r.stdout).toContain('첫째')
  })
})
