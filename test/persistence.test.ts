import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { createHome, setup, testHome } from './helpers.js'

const CLI_PATH = fileURLToPath(new URL('../bin/twit.js', import.meta.url))

function cli(args: string[], actor: string | null): { code: number; stdout: string } {
  const home = testHome()
  const env: NodeJS.ProcessEnv = { ...process.env, TWIT_HOME: home }
  if (actor !== null) env.TWIT_ACTOR = actor
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], { env, encoding: 'utf8' })
  return { code: result.status ?? -1, stdout: result.stdout ?? '' }
}

beforeEach(() => {
  createHome()
})

describe('프로세스 종료 후 영속성', () => {
  it('첫 프로세스가 저장한 메시지를 다음 프로세스가 조회한다', async () => {
    await setup()
    const sent = cli(['send', '--to', 'codex-1', '--subject', '영속성', '--body', '종료 후에도 남는다', '--json'], 'dane')
    expect(sent.code).toBe(0)

    const inbox = cli(['inbox', '--json'], 'codex-1')
    expect(inbox.code).toBe(0)
    const messages = JSON.parse(inbox.stdout).data.messages
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      id: 'M-001',
      subject: '영속성',
      read: false,
      archived: false,
    })

    const read = cli(['read', 'M-001', '--json'], 'codex-1')
    expect(read.code).toBe(0)
    expect(JSON.parse(read.stdout).data.marked_read).toBe(true)

    const inboxAfter = cli(['inbox', '--json'], 'codex-1')
    expect(JSON.parse(inboxAfter.stdout).data.messages[0].read).toBe(true)
  })

  it('읽음·보관 상태도 남는다', async () => {
    await setup()
    cli(['send', '--to', 'codex-1', '--subject', 's', '--body', 'b', '--json'], 'dane')
    cli(['read', 'M-001', '--json'], 'codex-1')
    const archived = cli(['archive', 'M-001', '--json'], 'codex-1')
    expect(archived.code).toBe(0)

    const archivedList = cli(['inbox', '--archived', '--json'], 'codex-1')
    const messages = JSON.parse(archivedList.stdout).data.messages
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ read: true, archived: true })
  })
})

describe('프로세스 출력 경계', () => {
  it('64KB를 넘는 출력도 파이프에서 온전히 나간다', async () => {
    await setup()
    const largeBody = '가'.repeat(100_000) // UTF-8로 약 300KB
    const sent = cli(['send', '--to', 'codex-1', '--subject', '큰 본문', '--body', largeBody, '--json'], 'dane')
    expect(sent.code).toBe(0)

    // 실제 파이프(`| wc -c`)로 자식 프로세스 stdout을 받아 본다
    const home = testHome()
    const env = { ...process.env, TWIT_HOME: home, TWIT_ACTOR: 'codex-1' }
    const piped = spawnSync(
      'sh',
      ['-c', `"${process.execPath}" "${CLI_PATH}" read M-001 --json | wc -c`],
      { env, encoding: 'utf8', shell: false },
    )
    expect(piped.status).toBe(0)
    // 봉투·필드 전체를 담으려면 100KB 이상이어야 한다. 잘리면 이보다 작다.
    expect(Number(piped.stdout.trim())).toBeGreaterThan(300_000)
  })

  it('표준 입력 본문도 공백 검사를 거친다', async () => {
    await setup()
    const env = { ...process.env, TWIT_HOME: testHome(), TWIT_ACTOR: 'dane' }
    const blank = spawnSync(process.execPath, [CLI_PATH, 'send', '--to', 'codex-1', '--subject', 's', '--body-file', '-', '--json'], {
      env,
      input: '   \n  ',
      encoding: 'utf8',
    })
    expect(blank.status).toBe(2)
    expect(blank.stdout).toContain('VALIDATION_ERROR')

    const ok = spawnSync(process.execPath, [CLI_PATH, 'send', '--to', 'codex-1', '--subject', 's', '--body-file', '-', '--json'], {
      env,
      input: 'stdin 본문',
      encoding: 'utf8',
    })
    expect(ok.status).toBe(0)
    const read = cli(['read', 'M-001', '--json'], 'codex-1')
    expect(JSON.parse(read.stdout).data.message.body).toBe('stdin 본문')
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

  it('src 코드에서 child_process를 쓰지 않는다', async () => {
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

    const users = files.filter((file) => readFileSync(file, 'utf8').includes('child_process'))
    expect(users).toEqual([])
  })
})
