import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { createHome, setup, testHome } from './helpers.js'

const CLI_PATH = fileURLToPath(new URL('../bin/twit.js', import.meta.url))
const NODE_FLAGS = ['--disable-warning=ExperimentalWarning']

function cli(args: string[], as: string | null): { code: number; stdout: string } {
  const home = testHome()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TWIT_HOME: home,
    TWIT_CONTACTS: 'dane,claude,codex,opencode,grok',
  }
  const result = spawnSync(process.execPath, [...NODE_FLAGS, CLI_PATH, ...args], { env, encoding: 'utf8' })
  return { code: result.status ?? -1, stdout: result.stdout ?? '' }
}

beforeEach(async () => {
  await setup()
})

describe('프로세스 종료 후 영속성', () => {
  it('첫 프로세스가 저장한 메시지를 다음 프로세스가 조회한다', async () => {
    const sent = cli(['send', '--from', 'claude', '--to', 'codex', '--subject', '영속성', '--body', '종료 후에도 남는다', '--json'], null)
    expect(sent.code).toBe(0)

    const inbox = cli(['inbox', '--as', 'codex', '--json'], null)
    expect(inbox.code).toBe(0)
    const messages = JSON.parse(inbox.stdout).data.messages
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: 'M-001',
      subject: '영속성',
      read: false,
      archived: false,
    })

    const read = cli(['read', 'M-001', '--as', 'codex', '--json'], null)
    expect(read.code).toBe(0)
    expect(JSON.parse(read.stdout).data.messages[0].marked_read).toBe(true)

    const inboxAfter = cli(['inbox', '--as', 'codex', '--json'], null)
    expect(JSON.parse(inboxAfter.stdout).data.messages[0].read).toBe(true)
  })

  it('읽음·보관 상태도 남는다', async () => {
    cli(['send', '--from', 'claude', '--to', 'codex', '--subject', 's', '--body', 'b', '--json'], null)
    cli(['read', 'M-001', '--as', 'codex', '--json'], null)
    const archived = cli(['archive', 'M-001', '--as', 'codex', '--json'], null)
    expect(archived.code).toBe(0)

    const archivedList = cli(['inbox', '--as', 'codex', '--archived', '--json'], null)
    const messages = JSON.parse(archivedList.stdout).data.messages
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ read: true, archived: true })
  })
})

describe('프로세스 출력 경계', () => {
  it('64KB를 넘는 출력도 파이프에서 온전히 나간다', async () => {
    const largeBody = '가'.repeat(100_000) // UTF-8로 약 300KB
    const sent = cli(['send', '--from', 'claude', '--to', 'codex', '--subject', '큰 본문', '--body', largeBody, '--json'], null)
    expect(sent.code).toBe(0)
    cli(['send', '--from', 'claude', '--to', 'codex', '--subject', '둘째 본문', '--body', 'b2', '--json'], null)

    // 실제 파이프(`| wc -c`)로 자식 프로세스 stdout을 받아 본다. 여러 건의 본문이 한 번에 나간다
    const piped = spawnSync(
      'sh',
      ['-c', `"${process.execPath}" ${NODE_FLAGS.join(' ')} "${CLI_PATH}" read M-002 M-001 --as codex --json | wc -c`],
      { env: { ...process.env, TWIT_HOME: testHome(), TWIT_CONTACTS: 'dane,claude,codex,opencode,grok' }, encoding: 'utf8' },
    )
    expect(piped.status).toBe(0)
    // 큰 본문 한 건이 300KB를 넘는다. 잘리면 이보다 작다.
    expect(Number(piped.stdout.trim())).toBeGreaterThan(300_000)

    // 파이프로 받은 JSON은 여러 건 전체를 담고 있다
    const json = spawnSync(
      'sh',
      ['-c', `"${process.execPath}" ${NODE_FLAGS.join(' ')} "${CLI_PATH}" read M-001 --as codex --json`],
      { env: { ...process.env, TWIT_HOME: testHome(), TWIT_CONTACTS: 'dane,claude,codex,opencode,grok' }, encoding: 'utf8' },
    )
    const parsed = JSON.parse(json.stdout)
    expect(parsed.data.messages).toHaveLength(1)
    expect(parsed.data.messages[0].body).toHaveLength(100_000)
  })

  it('표준 입력 본문도 공백 검사를 거친다', async () => {
    const env = { ...process.env, TWIT_HOME: testHome(), TWIT_CONTACTS: 'dane,claude,codex,opencode,grok' }
    const blank = spawnSync(
      process.execPath,
      [...NODE_FLAGS, CLI_PATH, 'send', '--from', 'claude', '--to', 'codex', '--subject', 's', '--body-file', '-', '--json'],
      { env, input: '   \n  ', encoding: 'utf8' },
    )
    expect(blank.status).toBe(2)
    expect(blank.stdout).toContain('VALIDATION_ERROR')

    const ok = spawnSync(
      process.execPath,
      [...NODE_FLAGS, CLI_PATH, 'send', '--from', 'claude', '--to', 'codex', '--subject', 's', '--body-file', '-', '--json'],
      { env, input: 'stdin 본문', encoding: 'utf8' },
    )
    expect(ok.status).toBe(0)
    const read = cli(['read', 'M-001', '--as', 'codex', '--json'], null)
    expect(JSON.parse(read.stdout).data.messages[0].body).toBe('stdin 본문')
  })
})

describe('파일 접근 경계', () => {
  it('src 코드에서 fs 접근은 body.ts와 db.ts뿐이다', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const srcDir = fileURLToPath(new URL('../src', import.meta.url))
    const offenders: string[] = []

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry)
        if (statSync(full).isDirectory()) walk(full)
        else if (full.endsWith('.ts')) offenders.push(full)
      }
    }
    walk(srcDir)

    const fsUsers = offenders.filter((file) => {
      const source = readFileSync(file, 'utf8')
      return /from\s+['"]node:fs['"]|from\s+['"]fs['"]|require\(['"]node:fs['"]\)/.test(source)
    })
    expect(fsUsers.map((f) => path.relative(srcDir, f)).sort()).toEqual([
      'core/body.ts',
      'store/db.ts',
    ])
  })

  it('src 코드에서 child_process를 쓰는 파일은 ui/open.ts 뿐이다', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const srcDir = fileURLToPath(new URL('../src', import.meta.url))
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry)
        if (statSync(full).isDirectory()) walk(full)
        else if (full.endsWith('.ts')) files.push(full)
      }
    }
    walk(srcDir)

    const users = files
      .filter((file) => readFileSync(file, 'utf8').includes('child_process'))
      .map((file) => path.relative(srcDir, file))
      .sort()
    expect(users).toEqual(['ui/open.ts'])
  })
})
