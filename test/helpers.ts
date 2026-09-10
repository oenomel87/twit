import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runCli } from '../src/main.js'

export const CONTACTS = 'dane,claude,codex,opencode,grok'

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
  contacts?: string | null
}

export async function run(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const out: string[] = []
  const err: string[] = []
  const env: Record<string, string | undefined> = {
    TWIT_HOME: currentHome,
    ...(opts.contacts === null ? {} : { TWIT_CONTACTS: opts.contacts ?? CONTACTS }),
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

/** 임시 홈을 만든다. 참여자 등록은 환경변수 주소록으로 대체됐다. */
export async function setup(): Promise<string> {
  createHome()
  return currentHome
}
