import type { Command } from 'commander'
import type { CliIo } from '../core/io.js'
import {
  closeContext,
  loadContext,
  mergeGlobalOptions,
  type GlobalOptions,
} from '../core/context.js'
import { TwitError } from '../core/errors.js'
import { runAction } from '../core/report.js'
import { emitSuccess } from '../output/json.js'
import { startUiServer } from '../ui/server.js'
import { openUrl as openUrlDefault } from '../ui/open.js'

function waitForSignal(): Promise<void> {
  return new Promise((resolve) => {
    const stop = () => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      resolve()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}

export interface UiHooks {
  openUrl?: (url: string) => void
  waitUntilDone?: () => Promise<void>
}

export async function runUi(io: CliIo, g: GlobalOptions, hooks: UiHooks = {}): Promise<void> {
  if (g.as !== undefined) {
    throw new TwitError(
      'VALIDATION_ERROR',
      'ui에는 --as를 쓸 수 없습니다. 관찰자 화면은 전체 대화를 보여 줍니다.',
    )
  }
  const ctx = loadContext(io.env)
  try {
    let server
    try {
      server = await startUiServer(ctx.db)
    } catch (err) {
      throw new TwitError('STORAGE_ERROR', 'UI 서버를 열지 못했습니다', {
        cause: err instanceof Error ? err.message : String(err),
      })
    }
    try {
      emitSuccess(io, g, { url: server.url, port: server.port }, () => server.url)
      try {
        (hooks.openUrl ?? openUrlDefault)(server.url)
      } catch (err) {
        io.stderr(
          `warning: 브라우저를 열지 못했습니다: ${err instanceof Error ? err.message : String(err)}\n`,
        )
      }
      await (hooks.waitUntilDone ?? waitForSignal)()
    } finally {
      await server.close()
    }
  } finally {
    closeContext(ctx)
  }
}

export function registerUiCommand(program: Command, io: CliIo): void {
  const globals = (opts: GlobalOptions): GlobalOptions =>
    mergeGlobalOptions(program.opts() as GlobalOptions, opts)

  program
    .command('ui')
    .description('전체 대화를 읽기 전용 브라우저 화면으로 연다')
    .action(async (opts: GlobalOptions) => {
      const g = globals(opts)
      return runAction(io, g, () => runUi(io, g))
    })
}
