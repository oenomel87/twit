import { beforeEach, describe, expect, it } from 'vitest'
import { createHome, run, setup } from './helpers.js'

beforeEach(() => {
  createHome()
})

describe('send', () => {
  it('보낸 메시지가 수신자 인박스에 읽지 않음으로 표시된다', async () => {
    await setup()
    const sent = await run('dane', [
      'send', '--to', 'codex-1', '--subject', '요청', '--body', '작업 부탁드립니다', '--json',
    ])
    expect(sent.code).toBe(0)
    const message = sent.json?.data?.message as Record<string, unknown>
    expect(message).toMatchObject({
      id: 'M-001',
      thread_id: 'M-001',
      reply_to_id: null,
      sender: 'dane',
      recipient: 'codex-1',
      subject: '요청',
      body: '작업 부탁드립니다',
      read: null,
      archived: null,
      body_length: '작업 부탁드립니다'.length,
    })
    expect(typeof message.created_at).toBe('string')
    expect(message.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)

    const inbox = await run('codex-1', ['inbox', '--json'])
    expect(inbox.code).toBe(0)
    const messages = inbox.json?.data?.messages as Record<string, unknown>[]
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: 'M-001',
      sender: 'dane',
      subject: '요청',
      read: false,
      archived: false,
    })
    expect(messages[0]).not.toHaveProperty('body')
  })

  it('제목은 앞뒤 공백을 제거하고 본문은 그대로 저장한다', async () => {
    await setup()
    const r = await run('dane', [
      'send', '--to', 'codex-1', '--subject', '  제목  ', '--body', '  본문 앞뒤 공백 유지  ', '--json',
    ])
    expect(r.code).toBe(0)
    const message = r.json?.data?.message as Record<string, unknown>
    expect(message.subject).toBe('제목')
    expect(message.body).toBe('  본문 앞뒤 공백 유지  ')
  })

  it('--body-file로 저장한 본문은 원본이 바뀌어도 전송 시점 내용을 유지한다', async () => {
    await setup()
    const { writeFileSync, mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const file = join(mkdtempSync(join(tmpdir(), 'twit-body-')), 'body.md')
    writeFileSync(file, '# 원본 명세\n이 내용으로 저장되어야 한다', 'utf8')

    const sent = await run('dane', [
      'send', '--to', 'codex-1', '--subject', '명세', '--body-file', file, '--json',
    ])
    expect(sent.code).toBe(0)
    writeFileSync(file, '# 바뀐 내용\n', 'utf8')

    const read = await run('codex-1', ['read', 'M-001', '--json'])
    expect(read.code).toBe(0)
    expect((read.json?.data?.message as Record<string, unknown>).body).toBe(
      '# 원본 명세\n이 내용으로 저장되어야 한다',
    )
  })

  it('본문 입력 규칙을 지킨다', async () => {
    await setup()
    const both = await run('dane', [
      'send', '--to', 'codex-1', '--subject', 's', '--body', 'b', '--body-file', '-', '--json',
    ])
    expect(both.code).toBe(2)
    expect(both.json?.error?.code).toBe('VALIDATION_ERROR')

    const none = await run('dane', ['send', '--to', 'codex-1', '--subject', 's', '--json'])
    expect(none.code).toBe(2)

    const blankBody = await run('dane', ['send', '--to', 'codex-1', '--subject', 's', '--body', '   \n  ', '--json'])
    expect(blankBody.code).toBe(2)

    const blankSubject = await run('dane', ['send', '--to', 'codex-1', '--subject', '   ', '--body', 'b', '--json'])
    expect(blankSubject.code).toBe(2)
  })

  it('미등록 수신자는 NOT_FOUND다', async () => {
    await setup()
    const r = await run('dane', ['send', '--to', 'ghost', '--subject', 's', '--body', 'b', '--json'])
    expect(r.code).toBe(3)
    expect(r.json?.error?.code).toBe('NOT_FOUND')
  })

  it('자기 자신에게 보낼 수 있다', async () => {
    await setup()
    const r = await run('dane', ['send', '--to', 'dane', '--subject', '메모', '--body', '내게 쓰기', '--json'])
    expect(r.code).toBe(0)
    const message = r.json?.data?.message as Record<string, unknown>
    expect(message.sender).toBe('dane')
    expect(message.recipient).toBe('dane')

    const inbox = await run('dane', ['inbox', '--json'])
    const sent = await run('dane', ['sent', '--json'])
    expect((inbox.json?.data?.messages as unknown[]).length).toBe(1)
    expect((sent.json?.data?.messages as unknown[]).length).toBe(1)
  })

  it('텍스트 모드 오류는 stderr로 나오고 종료 코드 3이다', async () => {
    await setup()
    const r = await run('dane', ['send', '--to', 'ghost', '--subject', 's', '--body', 'b'])
    expect(r.code).toBe(3)
    expect(r.stderr).toMatch(/^error: NOT_FOUND: .+\n$/)
    expect(r.stdout).toBe('')
  })
})
