import type { Command } from 'commander'
import type { CliIo } from '../core/io.js'
import {
  mergeGlobalOptions,
  requireAs,
  withDb,
  type GlobalOptions,
} from '../core/context.js'
import { TwitError } from '../core/errors.js'
import { runAction } from '../core/report.js'
import { emitSuccess } from '../output/json.js'
import { renderMessageDetail, SEPARATOR } from '../output/text.js'
import { readMessages, unreadIds } from '../core/mailbox.js'
import { toMessage } from '../core/queries.js'

export function registerReadCommand(program: Command, io: CliIo): void {
  const globals = (opts: GlobalOptions): GlobalOptions =>
    mergeGlobalOptions(program.opts() as GlobalOptions, opts)

  program
    .command('read')
    .description('메시지를 읽고 수신자라면 읽음으로 표시합니다')
    .argument('[ids...]', '메시지 ID 목록')
    .option('--unread', '기본 인박스의 읽지 않은 메시지를 모두 읽는다. ID와 함께 쓸 수 없다')
    .action((ids: string[], opts: GlobalOptions & { unread?: boolean }) => {
      const g = globals(opts)
      return runAction(io, g, () =>
        withDb(io, (db) => {
          const { as } = requireAs(io.env, g)
          const targetIds = ids.map((id) => id.trim())
          if (opts.unread && targetIds.length > 0) {
            throw new TwitError('VALIDATION_ERROR', '--unread는 ID와 함께 쓸 수 없습니다.')
          }
          if (!opts.unread && targetIds.length === 0) {
            throw new TwitError('VALIDATION_ERROR', '읽을 메시지 ID가 필요합니다. ID를 지정하거나 --unread를 쓰세요.')
          }
          const seen = new Set<string>()
          for (const id of targetIds) {
            if (seen.has(id)) {
              throw new TwitError('VALIDATION_ERROR', `같은 ID를 두 번 지정했습니다: ${id}`, { id })
            }
            seen.add(id)
          }
          const targets = opts.unread ? unreadIds(db, as) : targetIds
          const results = readMessages(db, as, targets)
          emitSuccess(
            io,
            g,
            {
              messages: results.map(({ message, marked_read }) => ({
                ...toMessage(message, as),
                marked_read,
              })),
            },
            () =>
              results.length === 0
                ? '(no messages)'
                : results.map(({ message }) => renderMessageDetail(message)).join(`\n${SEPARATOR}\n`),
          )
        }),
      )
    })
}
