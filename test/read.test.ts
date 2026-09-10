import { beforeEach, describe, expect, it } from 'vitest'
import { createHome, run, setup } from './helpers.js'

beforeEach(async () => {
  await setup()
})

async function sendThree(): Promise<void> {
  for (const subject of ['첫째', '둘째', '셋째']) {
    expect(
      (await run(['send', '--from', 'claude', '--to', 'codex', '--subject', subject, '--body', `${subject} 본문`, '--json'])).code,
    ).toBe(0)
  }
}

describe('read', () => {
  it('수신자가 읽으면 읽음으로 표시된다', async () => {
    await sendThree()
    const r = await run(['read', 'M-001', '--as', 'codex', '--json'])
    expect(r.code).toBe(0)
    const messages = r.json?.data?.messages as Record<string, unknown>[]
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: 'M-001',
      body: '첫째 본문',
      read: true,
      marked_read: true,
    })
  })

  it('다시 읽으면 marked_read는 false다', async () => {
    await sendThree()
    await run(['read', 'M-001', '--as', 'codex'])
    const r = await run(['read', 'M-001', '--as', 'codex', '--json'])
    const messages = r.json?.data?.messages as Record<string, unknown>[]
    expect(messages[0].marked_read).toBe(false)
    expect(messages[0].read).toBe(true)
  })

  it('발신자가 읽으면 수신자의 읽음 상태가 바뀌지 않는다', async () => {
    await sendThree()
    const r = await run(['read', 'M-001', '--as', 'claude', '--json'])
    const messages = r.json?.data?.messages as Record<string, unknown>[]
    expect(messages[0].marked_read).toBe(false)
    // 발신자 관점에서 read는 값이 없다
    expect(messages[0].read).toBeNull()

    const inbox = await run(['inbox', '--as', 'codex', '--json'])
    expect((inbox.json?.data?.messages as Record<string, unknown>[])[0].read).toBe(false)
  })

  it('여러 ID는 지정한 순서대로 반환한다', async () => {
    await sendThree()
    const r = await run(['read', 'M-003', 'M-001', '--as', 'codex', '--json'])
    expect(r.code).toBe(0)
    const messages = r.json?.data?.messages as Record<string, unknown>[]
    expect(messages.map((m) => m.id)).toEqual(['M-003', 'M-001'])
    expect(messages.map((m) => m.marked_read)).toEqual([true, true])
  })

  it('지정하지 않은 메시지는 그대로다', async () => {
    await sendThree()
    await run(['read', 'M-001', '--as', 'codex', '--json'])
    const inbox = await run(['inbox', '--as', 'codex', '--json'])
    const states = Object.fromEntries(
      (inbox.json?.data?.messages as Record<string, unknown>[]).map((m) => [m.id, m.read]),
    )
    expect(states['M-001']).toBe(true)
    expect(states['M-002']).toBe(false)
    expect(states['M-003']).toBe(false)
  })

  it('--unread는 기본 인박스의 읽지 않은 메시지를 오래된 순서로 모두 읽는다', async () => {
    await sendThree()
    await run(['read', 'M-002', '--as', 'codex']) // 가운데 것만 미리 읽음
    const r = await run(['read', '--unread', '--as', 'codex', '--json'])
    expect(r.code).toBe(0)
    const messages = r.json?.data?.messages as Record<string, unknown>[]
    expect(messages.map((m) => m.id)).toEqual(['M-001', 'M-003'])
    expect(messages.map((m) => m.marked_read)).toEqual([true, true])

    // 다시 실행하면 빈 목록으로 정상 종료다
    const again = await run(['read', '--unread', '--as', 'codex', '--json'])
    expect(again.code).toBe(0)
    expect(again.json?.data?.messages).toEqual([])
    const textAgain = await run(['read', '--unread', '--as', 'codex'])
    expect(textAgain.stdout).toBe('(no messages)\n')
  })

  it('--unread는 보관된 미읽음 메시지를 건드리지 않는다', async () => {
    await sendThree()
    await run(['archive', 'M-002', '--as', 'codex']) // 미읽음인 채로 보관
    const r = await run(['read', '--unread', '--as', 'codex', '--json'])
    const messages = r.json?.data?.messages as Record<string, unknown>[]
    expect(messages.map((m) => m.id)).toEqual(['M-001', 'M-003'])

    const archived = await run(['inbox', '--as', 'codex', '--archived', '--json'])
    const kept = (archived.json?.data?.messages as Record<string, unknown>[]).find((m) => m.id === 'M-002')
    expect(kept).toMatchObject({ read: false, archived: true })
  })

  it('입력 오류는 VALIDATION_ERROR다', async () => {
    await sendThree()
    // ID와 --unread를 함께
    const both = await run(['read', 'M-001', '--unread', '--as', 'codex', '--json'])
    expect(both.code).toBe(2)
    // 둘 다 없음
    const neither = await run(['read', '--as', 'codex', '--json'])
    expect(neither.code).toBe(2)
    // 같은 ID를 두 번
    const duplicate = await run(['read', 'M-001', 'M-001', '--as', 'codex', '--json'])
    expect(duplicate.code).toBe(2)
    expect(duplicate.json?.error?.message).toContain('M-001')

    // 어느 경우도 읽음 처리가 남지 않는다
    const inbox = await run(['inbox', '--as', 'codex', '--json'])
    expect((inbox.json?.data?.messages as Record<string, unknown>[]).every((m) => m.read === false)).toBe(true)
  })

  it('없는 메시지는 NOT_FOUND다', async () => {
    const r = await run(['read', 'M-999', '--as', 'codex', '--json'])
    expect(r.code).toBe(3)
    expect(r.json?.error?.code).toBe('NOT_FOUND')
  })
})
