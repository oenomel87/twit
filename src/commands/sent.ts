import type { Command } from 'commander'
import type { CliIo } from '../core/io.js'
import {
  mergeGlobalOptions,
  requireAs,
  withDb,
  type GlobalOptions,
} from '../core/context.js'
import { runAction } from '../core/report.js'
import { emitSuccess } from '../output/json.js'
import { renderMessageList } from '../output/text.js'
import { sentMessages, toSummary } from '../core/queries.js'

export function registerSentCommand(program: Command, io: CliIo): void {
  const globals = (opts: GlobalOptions): GlobalOptions =>
    mergeGlobalOptions(program.opts() as GlobalOptions, opts)

  program
    .command('sent')
    .description('자신이 보낸 메시지를 조회합니다')
    .action((opts: GlobalOptions) => {
      const g = globals(opts)
      return runAction(io, g, () =>
        withDb(io, (db) => {
          const { as } = requireAs(io.env, g)
          const rows = sentMessages(db, as)
          emitSuccess(io, g, { messages: rows.map((row) => toSummary(row, as)) }, () =>
            renderMessageList(rows, as),
          )
        }),
      )
    })
}
