import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { createHome, run, setup, testHome } from './helpers.js'

const CLI_PATH = fileURLToPath(new URL('../bin/twit.js', import.meta.url))
const NODE_FLAGS = ['--disable-warning=ExperimentalWarning']

interface CliResult {
  code: number
  stdout: string
  stderr: string
}

function spawnCli(args: string[], home: string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TWIT_HOME: home,
      TWIT_CONTACTS: 'dane,claude,codex,opencode,grok',
    }
    const child = spawn(process.execPath, [...NODE_FLAGS, CLI_PATH, ...args], { env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

beforeEach(async () => {
  await setup()
})

describe('두 프로세스의 동시 실행', () => {
  it('동시 전송은 메시지 두 개와 서로 다른 ID를 만든다', async () => {
    const home = testHome()
    const [a, b] = await Promise.all([
      spawnCli(['send', '--from', 'claude', '--to', 'codex', '--subject', '동시1', '--body', 'a', '--json'], home),
      spawnCli(['send', '--from', 'claude', '--to', 'codex', '--subject', '동시2', '--body', 'b', '--json'], home),
    ])
    expect(a.code).toBe(0)
    expect(b.code).toBe(0)
    const idA = JSON.parse(a.stdout).data.message.id
    const idB = JSON.parse(b.stdout).data.message.id
    expect(new Set([idA, idB])).toEqual(new Set(['M-001', 'M-002']))

    const inbox = await run(['inbox', '--as', 'codex', '--json'])
    expect((inbox.json?.data?.messages as unknown[]).length).toBe(2)
  })

  it('동일 요청 키의 동시 전송은 메시지 한 개와 replayed 한 번이다', async () => {
    const home = testHome()
    const args = [
      'send', '--from', 'claude', '--to', 'codex', '--subject', '동일', '--body', '같은 본문', '--request-id', 'same', '--json',
    ]
    const [a, b] = await Promise.all([spawnCli(args, home), spawnCli(args, home)])
    expect(a.code).toBe(0)
    expect(b.code).toBe(0)
    const replayedFlags = [JSON.parse(a.stdout).data.replayed, JSON.parse(b.stdout).data.replayed]
    expect(replayedFlags.sort()).toEqual([false, true])
    const ids = [JSON.parse(a.stdout).data.message.id, JSON.parse(b.stdout).data.message.id]
    expect(ids[0]).toBe(ids[1])

    const inbox = await run(['inbox', '--as', 'codex', '--json'])
    expect((inbox.json?.data?.messages as unknown[]).length).toBe(1)
  })

  it('동시 읽기는 marked_read: true를 정확히 한 번 돌려준다', async () => {
    await run(['send', '--from', 'claude', '--to', 'codex', '--subject', '읽기 경쟁', '--body', 'b', '--json'])
    const home = testHome()
    const [a, b] = await Promise.all([
      spawnCli(['read', 'M-001', '--as', 'codex', '--json'], home),
      spawnCli(['read', 'M-001', '--as', 'codex', '--json'], home),
    ])
    expect(a.code).toBe(0)
    expect(b.code).toBe(0)
    const marked = [
      (JSON.parse(a.stdout).data.messages as Record<string, unknown>[])[0].marked_read,
      (JSON.parse(b.stdout).data.messages as Record<string, unknown>[])[0].marked_read,
    ]
    expect(marked.sort().reverse()).toEqual([true, false])

    // 첫 번째 시각이 유지된다
    const again = await run(['read', 'M-001', '--as', 'codex', '--json'])
    expect((again.json?.data?.messages as Record<string, unknown>[])[0].marked_read).toBe(false)
  })

  it('겹치는 ID를 두 프로세스가 동시에 읽어도 메시지별 marked_read: true는 한 번이다', async () => {
    for (const subject of ['첫째', '둘째']) {
      expect(
        (await run(['send', '--from', 'claude', '--to', 'codex', '--subject', subject, '--body', 'b', '--json'])).code,
      ).toBe(0)
    }
    const home = testHome()
    const [a, b] = await Promise.all([
      spawnCli(['read', 'M-001', 'M-002', '--as', 'codex', '--json'], home),
      spawnCli(['read', 'M-002', 'M-001', '--as', 'codex', '--json'], home),
    ])
    expect(a.code).toBe(0)
    expect(b.code).toBe(0)
    const countTrue = (result: CliResult): number =>
      (JSON.parse(result.stdout).data.messages as Record<string, unknown>[]).filter(
        (m) => m.marked_read === true,
      ).length
    expect(countTrue(a)).toBe(2)
    expect(countTrue(b)).toBe(0)
  })
})
