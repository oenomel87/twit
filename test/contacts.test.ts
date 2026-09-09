import { existsSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { createHome, run, setup, testHome } from './helpers.js'

beforeEach(() => {
  createHome()
})

describe('contacts add', () => {
  it('참여자가 하나도 없으면 호출자 없이 등록한다', async () => {
    const r = await run(null, ['contacts', 'add', 'dane', '--name', 'Dane', '--json'])
    expect(r.code).toBe(0)
    expect(r.json).toEqual({
      schema_version: 1,
      ok: true,
      data: { id: 'dane', display_name: 'Dane' },
      error: null,
    })
  })

  it('첫 등록 이후에는 호출자를 요구한다', async () => {
    await run(null, ['contacts', 'add', 'dane', '--name', 'Dane'])
    const r = await run(null, ['contacts', 'add', 'codex-1', '--name', 'Codex 1', '--json'])
    expect(r.code).toBe(8)
    expect(r.json?.ok).toBe(false)
    expect(r.json?.data).toBeNull()
    expect(r.json?.error?.code).toBe('ACTOR_NOT_CONFIGURED')
  })

  it('등록된 호출자로 참여자를 추가 등록한다', async () => {
    await setup()
    const r = await run('dane', ['contacts', 'add', 'agent-x', '--name', 'Agent X', '--json'])
    expect(r.code).toBe(0)
    expect(r.json?.data).toEqual({ id: 'agent-x', display_name: 'Agent X' })
  })

  it('--actor 옵션은 서브커맨드 앞뒤 어디에 와도 동작한다', async () => {
    await run(null, ['contacts', 'add', 'dane', '--name', 'Dane'])
    const before = await run(null, ['--actor', 'dane', 'contacts', 'add', 'codex-1', '--name', 'Codex 1'])
    expect(before.code).toBe(0)
    const after = await run(null, ['contacts', 'add', 'opencode-1', '--name', 'OpenCode 1', '--actor', 'dane'])
    expect(after.code).toBe(0)
  })

  it('중복 등록은 VALIDATION_ERROR다', async () => {
    await setup()
    const r = await run('dane', ['contacts', 'add', 'dane', '--name', 'Dane 2', '--json'])
    expect(r.code).toBe(2)
    expect(r.json?.error?.code).toBe('VALIDATION_ERROR')
  })

  it('참여자 ID 형식을 검사한다', async () => {
    for (const bad of ['Dane', 'da ne', '한글', '-dane', 'a'.repeat(65)]) {
      const r = await run(null, ['contacts', 'add', bad, '--name', 'X', '--json'])
      expect(r.code).toBe(2)
      expect(r.json?.error?.code).toBe('VALIDATION_ERROR')
    }
    const ok64 = await run(null, ['contacts', 'add', 'a'.repeat(64), '--name', 'X', '--json'])
    expect(ok64.code).toBe(0)
  })

  it('공백만 있는 이름은 거절한다', async () => {
    const r = await run(null, ['contacts', 'add', 'dane', '--name', '   ', '--json'])
    expect(r.code).toBe(2)
    expect(r.json?.error?.code).toBe('VALIDATION_ERROR')
  })

  it('DB 파일과 마이그레이션을 남긴다', async () => {
    await run(null, ['contacts', 'add', 'dane', '--name', 'Dane'])
    const dbPath = path.join(testHome(), 'twit.db')
    expect(existsSync(dbPath)).toBe(true)
    const db = new Database(dbPath, { readonly: true })
    try {
      const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
      expect(versions).toEqual([{ version: 1 }])
      const contacts = db.prepare('SELECT id, display_name FROM contacts').all()
      expect(contacts).toEqual([{ id: 'dane', display_name: 'Dane' }])
    } finally {
      db.close()
    }
  })
})

describe('contacts 목록', () => {
  it('호출자를 요구한다', async () => {
    await run(null, ['contacts', 'add', 'dane', '--name', 'Dane'])
    const r = await run(null, ['contacts', '--json'])
    expect(r.code).toBe(8)
  })

  it('등록 순서대로 참여자를 돌려준다', async () => {
    await setup()
    const r = await run('dane', ['contacts', '--json'])
    expect(r.code).toBe(0)
    expect(r.json?.data).toEqual({
      contacts: [
        { id: 'dane', display_name: 'Dane' },
        { id: 'codex-1', display_name: 'Codex 1' },
        { id: 'opencode-1', display_name: 'OpenCode 1' },
      ],
    })
  })
})

describe('whoami', () => {
  it('TWIT_ACTOR로 호출자를 확인한다', async () => {
    await setup()
    const r = await run('dane', ['whoami', '--json'])
    expect(r.code).toBe(0)
    expect(r.json?.data).toEqual({ id: 'dane', display_name: 'Dane' })
  })

  it('--actor 옵션을 TWIT_ACTOR보다 먼저 사용한다', async () => {
    await setup()
    const r = await run('codex-1', ['whoami', '--actor', 'opencode-1', '--json'])
    expect(r.code).toBe(0)
    expect(r.json?.data).toEqual({ id: 'opencode-1', display_name: 'OpenCode 1' })
  })

  it('호출자가 없거나 미등록이면 ACTOR_NOT_CONFIGURED다', async () => {
    await setup()
    const missing = await run(null, ['whoami', '--json'])
    expect(missing.code).toBe(8)
    const unknown = await run('ghost', ['whoami', '--json'])
    expect(unknown.code).toBe(8)
    expect(unknown.json?.error?.code).toBe('ACTOR_NOT_CONFIGURED')
  })

  it('참여자가 하나도 없으면 오류 메시지가 첫 등록 방법을 안내한다', async () => {
    const r = await run(null, ['whoami', '--json'])
    expect(r.code).toBe(8)
    expect(r.json?.error?.message).toContain('twit contacts add')
    expect(r.json?.error?.message).not.toContain('TWIT_ACTOR 환경변수로 호출자를 지정하고')
  })

  it('참여자가 있으면 오류 메시지가 호출자 설정 방법을 안내한다', async () => {
    await setup()
    const r = await run('ghost', ['whoami', '--json'])
    expect(r.code).toBe(8)
    expect(r.json?.error?.message).toContain('--actor <id>')
    expect(r.json?.error?.message).toContain('TWIT_ACTOR')
    expect(r.json?.error?.message).not.toContain('호출자 없이')
  })
})

describe('출력 규약', () => {
  it('텍스트 모드 오류는 stderr 한 줄이다', async () => {
    const r = await run(null, ['whoami'])
    expect(r.code).toBe(8)
    expect(r.stderr).toMatch(/^error: ACTOR_NOT_CONFIGURED: .+\n$/)
    expect(r.stdout).toBe('')
  })

  it('--json이면 오류도 stdout 봉투로 출력한다', async () => {
    const r = await run(null, ['--json', 'whoami'])
    expect(r.code).toBe(8)
    expect(r.stderr).toBe('')
    expect(r.json?.ok).toBe(false)
    expect(r.json?.error?.code).toBe('ACTOR_NOT_CONFIGURED')
  })

  it('텍스트 모드 성공은 사람이 읽는 한 줄이다', async () => {
    const r = await run(null, ['contacts', 'add', 'dane', '--name', 'Dane'])
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('dane (Dane)\n')
  })
})
