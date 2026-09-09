import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { createHome, run, setup, testHome } from './helpers.js'

const CLI_PATH = fileURLToPath(new URL('../bin/twit.js', import.meta.url))

interface CliResult {
  code: number
  stdout: string
  stderr: string
}

function spawnCli(args: string[], actor: string | null, home: string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, TWIT_HOME: home }
    if (actor !== null) env.TWIT_ACTOR = actor
    const child = spawn(process.execPath, [CLI_PATH, ...args], { env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

beforeEach(() => {
  createHome()
})

describe('두 프로세스의 동시 실행', () => {
  it('동시 전송은 메시지 두 개와 서로 다른 ID를 만든다', async () => {
    await setup()
    const home = testHome()
    const [a, b] = await Promise.all([
      spawnCli(['send', '--to', 'codex-1', '--subject', '동시1', '--body', 'a', '--json'], 'dane', home),
      spawnCli(['send', '--to', 'codex-1', '--subject', '동시2', '--body', 'b', '--json'], 'dane', home),
    ])
    expect(a.code).toBe(0)
    expect(b.code).toBe(0)
    const idA = JSON.parse(a.stdout).data.message.id
    const idB = JSON.parse(b.stdout).data.message.id
    expect(new Set([idA, idB])).toEqual(new Set(['M-001', 'M-002']))

    const inbox = await run('codex-1', ['inbox', '--json'])
    expect((inbox.json?.data?.messages as unknown[]).length).toBe(2)
  })

  it('동일 요청 키의 동시 전송은 메시지 한 개와 replayed 한 번이다', async () => {
    await setup()
    const home = testHome()
    const args = [
      'send', '--to', 'codex-1', '--subject', '동일', '--body', '같은 본문', '--request-id', 'same', '--json',
    ]
    const [a, b] = await Promise.all([
      spawnCli(args, 'dane', home),
      spawnCli(args, 'dane', home),
    ])
    expect(a.code).toBe(0)
    expect(b.code).toBe(0)
    const replayedFlags = [JSON.parse(a.stdout).data.replayed, JSON.parse(b.stdout).data.replayed]
    expect(replayedFlags.sort()).toEqual([false, true])
    const ids = [JSON.parse(a.stdout).data.message.id, JSON.parse(b.stdout).data.message.id]
    expect(ids[0]).toBe(ids[1])

    const inbox = await run('codex-1', ['inbox', '--json'])
    expect((inbox.json?.data?.messages as unknown[]).length).toBe(1)
  })

  it('동시 읽기는 marked_read: true를 정확히 한 번 돌려준다', async () => {
    await setup()
    await run('dane', ['send', '--to', 'codex-1', '--subject', '읽기 경쟁', '--body', 'b', '--json'])
    const home = testHome()
    const [a, b] = await Promise.all([
      spawnCli(['read', 'M-001', '--json'], 'codex-1', home),
      spawnCli(['read', 'M-001', '--json'], 'codex-1', home),
    ])
    expect(a.code).toBe(0)
    expect(b.code).toBe(0)
    const marked = [JSON.parse(a.stdout).data.marked_read, JSON.parse(b.stdout).data.marked_read]
    expect(marked.sort().reverse()).toEqual([true, false])

    // 첫 번째 시각이 유지된다
    const again = await run('codex-1', ['read', 'M-001', '--json'])
    expect(again.json?.data?.marked_read).toBe(false)
  })
})
