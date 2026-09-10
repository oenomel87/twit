import { beforeEach, describe, expect, it } from 'vitest'
import { createHome, run, setup } from './helpers.js'

beforeEach(async () => {
  await setup()
})

async function seed(): Promise<void> {
  expect(
    (await run(['send', '--from', 'claude', '--to', 'codex', '--subject', '재시도 로직 구현 요청', '--body', '본문1', '--json'])).code,
  ).toBe(0)
}

describe('reply', () => {
  it('받은 메시지에 답장하면 원래 발신자에게 간다', async () => {
    await seed()
    const r = await run(['reply', 'M-001', '--as', 'codex', '--body', '확인했습니다', '--json'])
    expect(r.code).toBe(0)
    const message = r.json?.data?.message as Record<string, unknown>
    expect(message).toMatchObject({
      id: 'M-002',
      thread_id: 'M-001',
      reply_to_id: 'M-001',
      sender: 'codex',
      recipient: 'claude',
      subject: '재시도 로직 구현 요청',
      body: '확인했습니다',
    })
  })

  it('보낸 메시지에 답장하면 원래 수신자에게 후속 메시지가 간다', async () => {
    await seed()
    const r = await run(['reply', 'M-001', '--as', 'claude', '--body', '추가 안내입니다', '--json'])
    expect(r.code).toBe(0)
    const message = r.json?.data?.message as Record<string, unknown>
    expect(message.sender).toBe('claude')
    expect(message.recipient).toBe('codex')
    expect(message.reply_to_id).toBe('M-001')
    expect(message.thread_id).toBe('M-001')
  })

  it('자기에게 보낸 메시지에 답장하면 자신에게 온다', async () => {
    await seed()
    await run(['send', '--from', 'claude', '--to', 'claude', '--subject', '메모', '--body', '내게 쓰기', '--json'])
    const r = await run(['reply', 'M-002', '--as', 'claude', '--body', '내게 답장', '--json'])
    expect(r.code).toBe(0)
    const message = r.json?.data?.message as Record<string, unknown>
    expect(message.recipient).toBe('claude')
  })

  it('여러 답장이 같은 대화에 연결되고 직접 답장 대상이 구분된다', async () => {
    await seed()
    await run(['reply', 'M-001', '--as', 'codex', '--body', '질문이 있습니다', '--json'])
    // claude는 M-002(질문)에 직접 답장
    await run(['reply', 'M-002', '--as', 'claude', '--body', '답변입니다', '--json'])
    const r = await run(['thread', 'M-001', '--as', 'codex', '--json'])
    expect(r.code).toBe(0)
    expect(r.json?.data?.thread_id).toBe('M-001')
    expect(r.json?.data?.participants).toEqual(['claude', 'codex'])
    const messages = r.json?.data?.messages as Record<string, unknown>[]
    expect(messages.map((m) => m.id)).toEqual(['M-001', 'M-002', 'M-003'])
    expect(messages.map((m) => m.reply_to_id)).toEqual([null, 'M-001', 'M-002'])
  })

  it('답장은 원문의 읽음·보관 상태를 바꾸지 않고, 새 답장은 상대에게 읽지 않음으로 온다', async () => {
    await seed()
    await run(['read', 'M-001', '--as', 'codex'])
    await run(['archive', 'M-001', '--as', 'codex'])
    await run(['reply', 'M-001', '--as', 'codex', '--body', '보관해도 답장 가능', '--json'])

    // 원문 상태 유지
    const all = await run(['inbox', '--as', 'codex', '--all', '--json'])
    const originals = (all.json?.data?.messages as Record<string, unknown>[]).filter(
      (m) => m.id === 'M-001',
    )
    expect(originals[0]).toMatchObject({ read: true, archived: true })

    // claude의 인박스에 새 답장은 읽지 않음으로
    const inbox = await run(['inbox', '--as', 'claude', '--json'])
    const reply = (inbox.json?.data?.messages as Record<string, unknown>[]).find(
      (m) => m.id === 'M-002',
    )
    expect(reply).toMatchObject({ read: false, archived: false })
  })

  it('없는 메시지는 NOT_FOUND, 제삼자는 FORBIDDEN이다', async () => {
    await seed()
    const missing = await run(['reply', 'M-999', '--as', 'codex', '--body', 'x', '--json'])
    expect(missing.code).toBe(3)
    const forbidden = await run(['reply', 'M-001', '--as', 'opencode', '--body', 'x', '--json'])
    expect(forbidden.code).toBe(4)
    expect(forbidden.json?.error?.code).toBe('FORBIDDEN')
  })
})
