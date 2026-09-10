import { beforeEach, describe, expect, it } from 'vitest'
import { createHome, run, setup } from './helpers.js'

beforeEach(async () => {
  await setup()
})

async function sendMessage(from = 'claude', to = 'codex', subject = '요청', body = '본문'): Promise<void> {
  const r = await run(['send', '--from', from, '--to', to, '--subject', subject, '--body', body, '--json'])
  expect(r.code).toBe(0)
}

describe('send', () => {
  it('보낸 메시지가 수신자 인박스에 읽지 않음으로 표시된다', async () => {
    await sendMessage()
    const inbox = await run(['inbox', '--as', 'codex', '--json'])
    expect(inbox.code).toBe(0)
    const messages = inbox.json?.data?.messages as Record<string, unknown>[]
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: 'M-001',
      thread_id: 'M-001',
      reply_to_id: null,
      sender: 'claude',
      recipient: 'codex',
      subject: '요청',
      read: false,
      archived: false,
    })
    expect(messages[0]).not.toHaveProperty('body')
  })

  it('제목은 앞뒤 공백을 제거하고 본문은 그대로 저장한다', async () => {
    await run(['send', '--from', 'claude', '--to', 'codex', '--subject', '  제목  ', '--body', '  본문 앞뒤 공백 유지  ', '--json'])
    const read = await run(['read', 'M-001', '--as', 'codex', '--json'])
    const message = (read.json?.data?.messages as Record<string, unknown>[])[0]
    expect(message.subject).toBe('제목')
    expect(message.body).toBe('  본문 앞뒤 공백 유지  ')
  })

  it('--body-file로 저장한 본문은 원본이 바뀌어도 전송 시점 내용을 유지한다', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const file = join(mkdtempSync(join(tmpdir(), 'twit-body-')), 'body.md')
    writeFileSync(file, '# 원본 명세\n이 내용으로 저장되어야 한다', 'utf8')

    const sent = await run(['send', '--from', 'claude', '--to', 'codex', '--subject', '명세', '--body-file', file, '--json'])
    expect(sent.code).toBe(0)
    writeFileSync(file, '# 바뀐 내용\n', 'utf8')

    const read = await run(['read', 'M-001', '--as', 'codex', '--json'])
    expect(read.code).toBe(0)
    expect((read.json?.data?.messages as Record<string, unknown>[])[0].body).toBe(
      '# 원본 명세\n이 내용으로 저장되어야 한다',
    )
  })

  it('본문 입력 규칙을 지킨다', async () => {
    const both = await run([
      'send', '--from', 'claude', '--to', 'codex', '--subject', 's', '--body', 'b', '--body-file', '-', '--json',
    ])
    expect(both.code).toBe(2)
    expect(both.json?.error?.code).toBe('VALIDATION_ERROR')

    const none = await run(['send', '--from', 'claude', '--to', 'codex', '--subject', 's', '--json'])
    expect(none.code).toBe(2)

    const blankBody = await run(['send', '--from', 'claude', '--to', 'codex', '--subject', 's', '--body', '   \n  ', '--json'])
    expect(blankBody.code).toBe(2)

    const blankSubject = await run(['send', '--from', 'claude', '--to', 'codex', '--subject', '   ', '--body', 'b', '--json'])
    expect(blankSubject.code).toBe(2)
  })

  it('자기 자신에게 보낼 수 있다', async () => {
    await sendMessage('dane', 'dane', '메모', '내게 쓰기')
    const inbox = await run(['inbox', '--as', 'dane', '--json'])
    const sent = await run(['sent', '--as', 'dane', '--json'])
    expect((inbox.json?.data?.messages as unknown[]).length).toBe(1)
    expect((sent.json?.data?.messages as unknown[]).length).toBe(1)
  })

  it('텍스트 모드 오류는 stderr로 나오고 종료 코드 3이다', async () => {
    const r = await run(['send', '--from', 'claude', '--to', 'ghost', '--subject', 's', '--body', 'b'])
    expect(r.code).toBe(3)
    expect(r.stderr).toMatch(/^error: NOT_FOUND: .+\n$/)
    expect(r.stdout).toBe('')
  })
})
