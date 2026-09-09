import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runCli } from '../src/main.js'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
  json: {
    schema_version: number
    ok: boolean
    data: unknown
    error: { code: string; message: string; details: unknown } | null
  } | null
}

let currentHome: string

export function createHome(): string {
  currentHome = mkdtempSync(path.join(tmpdir(), 'twit-test-'))
  return currentHome
}

export function testHome(): string {
  return currentHome
}

export interface RunOptions {
  env?: Record<string, string | undefined>
}

export async function run(
  actor: string | null,
  args: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  const out: string[] = []
  const err: string[] = []
  const env: Record<string, string | undefined> = {
    TWIT_HOME: currentHome,
    ...(actor !== null ? { TWIT_ACTOR: actor } : {}),
    ...opts.env,
  }
  const code = await runCli(args, {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    env,
  })
  const stdout = out.join('')
  let json: RunResult['json'] = null
  try {
    json = JSON.parse(stdout)
  } catch {
    // 텍스트 모드 출력은 JSON이 아니다
  }
  return { code, stdout, stderr: err.join(''), json }
}

export async function setup(): Promise<string> {
  createHome()
  await run(null, ['contacts', 'add', 'dane', '--name', 'Dane'])
  await run('dane', ['contacts', 'add', 'codex-1', '--name', 'Codex 1'])
  await run('dane', ['contacts', 'add', 'opencode-1', '--name', 'OpenCode 1'])
  return currentHome
}
