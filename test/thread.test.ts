import { beforeEach, describe, expect, it } from 'vitest'
import { createHome, run, setup } from './helpers.js'

beforeEach(async () => {
  await setup()
})

async function seedThread(): Promise<void> {
  expect(
    (await run(['send', '--from', 'claude', '--to', 'codex', '--subject', '요청', '--body', '첫 본문', '--json'])).code,
  ).toBe(0)
  expect((await run(['reply', 'M-001', '--as', 'codex', '--body', '둘째 본문', '--json'])).code).toBe(0)
  expect((await run(['reply', 'M-002', '--as', 'claude', '--body', '셋째 본문', '--json'])).code).toBe(0)
}

describe('thread', () => {
  it('대화 전체를 오래된 순으로 돌려준다', async () => {
    await seedThread()
    const r = await run(['thread', 'M-002', '--as', 'codex', '--json'])
    expect(r.code).toBe(0)
    expect(r.json?.data?.thread_id).toBe('M-001')
    const messages = r.json?.data?.messages as Record<string, unknown>[]
    expect(messages.map((m) => m.id)).toEqual(['M-001', 'M-002', 'M-003'])
    expect((messages[0] as Record<string, unknown>).body).toBe('첫 본문')
  })

  it('--no-body는 본문 없이 길이만 담는다', async () => {
    await seedThread()
    const r = await run(['thread', 'M-001', '--as', 'codex', '--no-body', '--json'])
    expect(r.code).toBe(0)
    const messages = r.json?.data?.messages as Record<string, unknown>[]
    expect(messages.map((m) => m.id)).toEqual(['M-001', 'M-002', 'M-003'])
    for (const m of messages) {
      expect(m).not.toHaveProperty('body')
      expect(typeof m.body_length).toBe('number')
    }
    expect(messages[0].body_length).toBe('첫 본문'.length)
  })

  it('--no-body의 body_length는 문자 수(코드 포인트)다', async () => {
    await setup()
    expect(
      (await run(['send', '--from', 'claude', '--to', 'codex', '--subject', '이모지', '--body', '👍👍', '--json'])).code,
    ).toBe(0)
    const r = await run(['thread', 'M-001', '--as', 'codex', '--no-body', '--json'])
    const messages = r.json?.data?.messages as Record<string, unknown>[]
    expect(messages[0].body_length).toBe(2) // UTF-16 코드 단위라면 4다
  })

  it('participants는 조회에 쓴 메시지가 아니라 대화의 최초 메시지를 따른다', async () => {
    await seedThread()
    // M-002(codex → claude)로 조회해도 순서는 최초 메시지(M-001: claude → codex) 기준이다
    const viaReply = await run(['thread', 'M-002', '--as', 'claude', '--json'])
    expect(viaReply.code).toBe(0)
    expect(viaReply.json?.data?.participants).toEqual(['claude', 'codex'])
    const viaOrigin = await run(['thread', 'M-001', '--as', 'codex', '--json'])
    expect(viaOrigin.json?.data?.participants).toEqual(['claude', 'codex'])
  })

  it('조회가 읽음 상태를 바꾸지 않는다', async () => {
    await seedThread()
    await run(['read', 'M-001', '--as', 'codex'])
    await run(['thread', 'M-001', '--as', 'codex', '--json'])
    await run(['thread', 'M-001', '--as', 'codex', '--no-body'])
    const inbox = await run(['inbox', '--as', 'codex', '--json'])
    const states = Object.fromEntries(
      (inbox.json?.data?.messages as Record<string, unknown>[]).map((m) => [m.id, m.read]),
    )
    expect(states['M-001']).toBe(true)
    expect(states['M-003']).toBe(false)
  })

  it('다른 대화의 메시지는 섞이지 않는다', async () => {
    await seedThread()
    await run(['send', '--from', 'claude', '--to', 'codex', '--subject', '별개 대화', '--body', 'x', '--json'])
    const r = await run(['thread', 'M-001', '--as', 'codex', '--no-body', '--json'])
    const messages = r.json?.data?.messages as Record<string, unknown>[]
    expect(messages.map((m) => m.id)).toEqual(['M-001', 'M-002', 'M-003'])
  })

  it('없는 메시지는 NOT_FOUND, 제삼자는 FORBIDDEN이다', async () => {
    await seedThread()
    const missing = await run(['thread', 'M-999', '--as', 'codex', '--json'])
    expect(missing.code).toBe(3)
    const forbidden = await run(['thread', 'M-001', '--as', 'opencode', '--json'])
    expect(forbidden.code).toBe(4)
    expect(forbidden.json?.error?.code).toBe('FORBIDDEN')
  })

  it('텍스트 모드 --no-body는 방향과 길이를 한 줄에 표시한다', async () => {
    await seedThread()
    const r = await run(['thread', 'M-001', '--as', 'codex', '--no-body'])
    expect(r.code).toBe(0)
    const lines = r.stdout.trimEnd().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('M-001')
    expect(lines[0]).toContain('→')
    expect(lines[0]).toContain('첫 본문'.length.toString())
  })
})
