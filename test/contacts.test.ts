import { beforeEach, describe, expect, it } from 'vitest'
import { createHome, run } from './helpers.js'

beforeEach(() => {
  createHome()
})

describe('contacts', () => {
  it('주소록을 설정한 순서대로 돌려준다', async () => {
    const r = await run(['contacts', '--json'])
    expect(r.code).toBe(0)
    expect(r.json).toEqual({
      schema_version: 2,
      ok: true,
      data: { contacts: ['dane', 'claude', 'codex', 'opencode', 'grok'] },
      error: null,
    })
  })

  it('주소록 항목의 앞뒤 공백을 제거하고 빈 항목은 버린다', async () => {
    const r = await run(['contacts', '--json'], { contacts: ' dane , claude ,, codex' })
    expect(r.code).toBe(0)
    expect(r.json?.data).toEqual({ contacts: ['dane', 'claude', 'codex'] })
  })

  it('주소록이 없으면 ACTOR_NOT_CONFIGURED와 설정 방법을 안내한다', async () => {
    const missing = await run(['contacts', '--json'], { contacts: null })
    expect(missing.code).toBe(8)
    expect(missing.json?.error?.code).toBe('ACTOR_NOT_CONFIGURED')
    expect(missing.json?.error?.message).toContain('TWIT_CONTACTS')

    const blank = await run(['contacts', '--json'], { contacts: '  ,  ' })
    expect(blank.code).toBe(8)
    expect(blank.json?.error?.code).toBe('ACTOR_NOT_CONFIGURED')
  })

  it('주소록 항목의 형식 오류와 중복은 VALIDATION_ERROR다', async () => {
    const badFormat = await run(['contacts', '--json'], { contacts: 'dane,Claude' })
    expect(badFormat.code).toBe(2)
    expect(badFormat.json?.error?.code).toBe('VALIDATION_ERROR')
    expect(badFormat.json?.error?.message).toContain('Claude')

    const duplicate = await run(['contacts', '--json'], { contacts: 'dane,claude,dane' })
    expect(duplicate.code).toBe(2)
    expect(duplicate.json?.error?.code).toBe('VALIDATION_ERROR')
    expect(duplicate.json?.error?.message).toContain('dane')
  })
})

describe('이름 지정', () => {
  it('--as, --from, --to에 주소록에 없는 이름은 NOT_FOUND와 현재 목록으로 거절된다', async () => {
    const as = await run(['inbox', '--as', 'ghost', '--json'])
    expect(as.code).toBe(3)
    expect(as.json?.error?.code).toBe('NOT_FOUND')
    expect(as.json?.error?.details).toMatchObject({ contacts: ['dane', 'claude', 'codex', 'opencode', 'grok'] })

    const from = await run([
      'send', '--from', 'ghost', '--to', 'claude', '--subject', 's', '--body', 'b', '--json',
    ])
    expect(from.code).toBe(3)
    expect(from.json?.error?.code).toBe('NOT_FOUND')

    const to = await run([
      'send', '--from', 'claude', '--to', 'ghost', '--subject', 's', '--body', 'b', '--json',
    ])
    expect(to.code).toBe(3)
    expect(to.json?.error?.code).toBe('NOT_FOUND')
  })

  it('--as가 없으면 ACTOR_NOT_CONFIGURED에 주소록이 담긴다', async () => {
    const r = await run(['inbox', '--json'])
    expect(r.code).toBe(8)
    expect(r.json?.error?.code).toBe('ACTOR_NOT_CONFIGURED')
    expect(r.json?.error?.message).toContain('--as')
    expect(r.json?.error?.details).toMatchObject({ contacts: ['dane', 'claude', 'codex', 'opencode', 'grok'] })
  })

  it('send에는 --as를 쓸 수 없다', async () => {
    const r = await run(['--as', 'claude', 'send', '--from', 'claude', '--to', 'codex', '--subject', 's', '--body', 'b', '--json'])
    expect(r.code).toBe(2)
    expect(r.json?.error?.code).toBe('VALIDATION_ERROR')
  })
})

describe('출력 규약', () => {
  it('텍스트 모드 오류는 stderr 한 줄이다', async () => {
    const r = await run(['inbox'], { contacts: null })
    expect(r.code).toBe(8)
    expect(r.stderr).toMatch(/^error: ACTOR_NOT_CONFIGURED: .+\n$/)
    expect(r.stdout).toBe('')
  })

  it('텍스트 모드 성공은 사람이 읻는 이름 목록이다', async () => {
    const r = await run(['contacts'])
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('dane\nclaude\ncodex\nopencode\ngrok\n')
  })
})
