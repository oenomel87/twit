import type { Command } from 'commander'
import type { CliIo } from '../core/io.js'
import {
  mergeGlobalOptions,
  requireActor,
  withDb,
  type GlobalOptions,
} from '../core/context.js'
import { runAction } from '../core/report.js'
import { emitSuccess } from '../output/json.js'
import { renderMessageList } from '../output/text.js'
import { inboxMessages, sentMessages, toSummary, type InboxFilter } from '../core/queries.js'
import { TwitError } from '../core/errors.js'

export function registerListCommands(program: Command, io: CliIo): void {
  const globals = (opts: GlobalOptions): GlobalOptions =>
    mergeGlobalOptions(program.opts() as GlobalOptions, opts)

  program
    .command('inbox')
    .description('자신이 받은 메시지를 조회합니다')
    .option('--unread', '읽지 않은 메시지만 조회한다', false)
    .option('--archived', '보관한 메시지만 조회한다', false)
    .option('--all', '보관 여부와 관계없이 받은 메시지 전체를 조회한다', false)
    .action((opts: GlobalOptions & { unread: boolean; archived: boolean; all: boolean }) => {
      const g = globals(opts)
      return runAction(io, g, () =>
        withDb(io, (db) => {
          const actor = requireActor({ db }, g, io.env)
          const flags = [opts.unread && 'unread', opts.archived && 'archived', opts.all && 'all'].filter(
            Boolean,
          ) as string[]
          if (flags.length > 1) {
            throw new TwitError(
              'VALIDATION_ERROR',
              '--unread, --archived, --all 중 최대 하나만 지정할 수 있습니다.',
            )
          }
          const filter: InboxFilter = (flags[0] as InboxFilter | undefined) ?? 'default'
          const rows = inboxMessages(db, actor.id, filter)
          emitSuccess(
            io,
            g,
            { messages: rows.map((row) => toSummary(row, actor.id)) },
            () => renderMessageList(rows, actor.id, { showArchived: filter === 'all' }),
          )
        }),
      )
    })

  program
    .command('sent')
    .description('자신이 보낸 메시지를 조회합니다')
    .action((opts: GlobalOptions) => {
      const g = globals(opts)
      return runAction(io, g, () =>
        withDb(io, (db) => {
          const actor = requireActor({ db }, g, io.env)
          const rows = sentMessages(db, actor.id)
          emitSuccess(io, g, { messages: rows.map((row) => toSummary(row, actor.id)) }, () =>
            renderMessageList(rows, actor.id),
          )
        }),
      )
    })
}
