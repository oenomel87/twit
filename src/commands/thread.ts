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
import { renderThread, renderThreadList } from '../output/text.js'
import { getMessage } from '../core/mailbox.js'
import { threadMessages, toMessage, toSummary } from '../core/queries.js'
import { TwitError } from '../core/errors.js'

export function registerThreadCommand(program: Command, io: CliIo): void {
  const globals = (opts: GlobalOptions): GlobalOptions =>
    mergeGlobalOptions(program.opts() as GlobalOptions, opts)

  program
    .command('thread')
    .description('같은 대화에 속한 메시지 전체를 조회합니다')
    .argument('<id>', '대화에 속한 메시지 ID')
    .option('--no-body', '본문 대신 본문 길이만 표시한다')
    .action((id: string, opts: GlobalOptions & { body: boolean }) => {
      const g = globals(opts)
      return runAction(io, g, () =>
        withDb(io, (db) => {
          const actor = requireActor({ db }, g, io.env)
          const start = getMessage(db, id)
          if (!start) {
            throw new TwitError('NOT_FOUND', `메시지를 찾을 수 없습니다: ${id}`, { id })
          }
          if (start.sender_id !== actor.id && start.recipient_id !== actor.id) {
            throw new TwitError('FORBIDDEN', '발신자나 수신자만 대화를 조회할 수 있습니다.', {
              id,
              actor: actor.id,
            })
          }
          const rows = threadMessages(db, start.thread_id)
          const messages = opts.body
            ? rows.map((row) => toMessage(row, actor.id))
            : rows.map((row) => toSummary(row, actor.id))
          emitSuccess(
            io,
            g,
            { thread_id: start.thread_id, participants: [start.sender_id, start.recipient_id], messages },
            () => (opts.body ? renderThread(rows) : renderThreadList(rows, actor.id)),
          )
        }),
      )
    })
}
