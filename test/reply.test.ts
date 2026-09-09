import { beforeEach, describe, expect, it } from 'vitest'
import { createHome, run, setup } from './helpers.js'

beforeEach(() => {
  createHome()
})

async function seed(): Promise<void> {
  await setup()
  expect(
    (await run('dane', ['send', '--to', 'codex-1', '--subject', '재시도 로직 구현 요청', '--body', '본문1', '--json'])).code,
  ).toBe(0)
}

describe('reply', () => {
  it('받은 메시지에 답장하면 원래 발신자에게 간다', async () => {
    await seed()
    const r = await run('codex-1', ['reply', 'M-001', '--body', '확인했습니다', '--json'])
    expect(r.code).toBe(0)
    const message = r.json?.data?.message as Record<string, unknown>
    expect(message).toMatchObject({
      id: 'M-002',
      thread_id: 'M-001',
      reply_to_id: 'M-001',
      sender: 'codex-1',
      recipient: 'dane',
      subject: '재시도 로직 구현 요청',
      body: '확인했습니다',
    })
  })

  it('보낸 메시지에 답장하면 원래 수신자에게 후속 메시지가 간다', async () => {
    await seed()
    const r = await run('dane', ['reply', 'M-001', '--body', '추가 안내입니다', '--json'])
    expect(r.code).toBe(0)
    const message = r.json?.data?.message as Record<string, unknown>
    expect(message.sender).toBe('dane')
    expect(message.recipient).toBe('codex-1')
    expect(message.reply_to_id).toBe('M-001')
    expect(message.thread_id).toBe('M-001')
  })

  it('자기에게 보낸 메시지에 답장하면 자신에게 온다', async () => {
    await seed()
    await run('dane', ['send', '--to', 'dane', '--subject', '메모', '--body', '내게 쓰기', '--json'])
    const r = await run('dane', ['reply', 'M-002', '--body', '내게 답장', '--json'])
    expect(r.code).toBe(0)
    const message = r.json?.data?.message as Record<string, unknown>
    expect(message.recipient).toBe('dane')
  })

  it('여러 답장이 같은 대화에 연결되고 직접 답장 대상이 구분된다', async () => {
    await seed()
    await run('codex-1', ['reply', 'M-001', '--body', '질문이 있습니다', '--json'])
    // dane은 M-002(질문)에 직접 답장
    await run('dane', ['reply', 'M-002', '--body', '답변입니다', '--json'])
    const r = await run('codex-1', ['thread', 'M-001', '--json'])
    expect(r.code).toBe(0)
    expect(r.json?.data?.thread_id).toBe('M-001')
    expect(r.json?.data?.participants).toEqual(['dane', 'codex-1'])
    const messages = r.json?.data?.messages as Record<string, unknown>[]
    expect(messages.map((m) => m.id)).toEqual(['M-001', 'M-002', 'M-003'])
    expect(messages.map((m) => m.reply_to_id)).toEqual([null, 'M-001', 'M-002'])
  })

  it('답장은 원문의 읽음·보관 상태를 바꾸지 않고, 새 답장은 상대에게 읽지 않음으로 온다', async () => {
    await seed()
    await run('codex-1', ['read', 'M-001'])
    await run('codex-1', ['archive', 'M-001'])
    await run('codex-1', ['reply', 'M-001', '--body', '보관해도 답장 가능', '--json'])

    // 원문 상태 유지
    const all = await run('codex-1', ['inbox', '--all', '--json'])
    const originals = (all.json?.data?.messages as Record<string, unknown>[]).filter(
      (m) => m.id === 'M-001',
    )
    expect(originals[0]).toMatchObject({ read: true, archived: true })

    // dane의 인박스에 새 답장은 읽지 않음으로
    const inbox = await run('dane', ['inbox', '--json'])
    const reply = (inbox.json?.data?.messages as Record<string, unknown>[]).find(
      (m) => m.id === 'M-002',
    )
    expect(reply).toMatchObject({ read: false, archived: false })
  })

  it('없는 메시지는 NOT_FOUND, 제삼자는 FORBIDDEN이다', async () => {
    await seed()
    const missing = await run('codex-1', ['reply', 'M-999', '--body', 'x', '--json'])
    expect(missing.code).toBe(3)
    const forbidden = await run('opencode-1', ['reply', 'M-001', '--body', 'x', '--json'])
    expect(forbidden.code).toBe(4)
    expect(forbidden.json?.error?.code).toBe('FORBIDDEN')
  })
})
