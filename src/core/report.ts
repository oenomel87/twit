import { TwitError } from './errors.js'
import type { CliIo } from './io.js'
import { errorEnvelope } from '../output/json.js'
import type { GlobalOptions } from './context.js'

export class ReportedError extends Error {
  constructor(readonly exitCode: number) {
    super('오류를 이미 출력했습니다')
  }
}

export function reportError(err: unknown, opts: GlobalOptions | null, io: CliIo): number {
  const twit =
    err instanceof TwitError
      ? err
      : new TwitError(
          'INTERNAL',
          `예상치 못한 오류가 발생했습니다: ${err instanceof Error ? err.message : String(err)}`,
        )
  if (opts?.json) {
    io.stdout(errorEnvelope({ code: twit.code, message: twit.message, details: twit.details }))
  } else {
    io.stderr(`error: ${twit.code}: ${twit.message}\n`)
  }
  if (io.env.TWIT_DEBUG === '1' && err instanceof Error && err.stack) {
    io.stderr(err.stack + '\n')
  }
  return twit.exitCode
}

export function runAction(
  io: CliIo,
  opts: GlobalOptions,
  handler: () => void | Promise<void>,
): Promise<void> {
  return (async () => {
    try {
      await handler()
    } catch (err) {
      throw new ReportedError(reportError(err, opts, io))
    }
  })()
}
