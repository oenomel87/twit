#!/usr/bin/env node
import { runCli } from '../dist/main.js'

// 파이프로 내보낼 때 process.exit()가 대기 중인 쓰기를 버리지 않도록 exitCode로 마친다.
// 상대가 먼저 닫힌 파이프(EPIPE)는 정상 종료로 처리한다.
process.stdout.on('error', (err) => {
  if (err && err.code === 'EPIPE') process.exit(0)
  throw err
})

runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
}).then(
  (code) => {
    process.exitCode = code
  },
  (err) => {
    process.stderr.write(`error: INTERNAL: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  },
)
