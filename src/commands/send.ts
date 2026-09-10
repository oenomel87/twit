import type { Command } from 'commander'
import type { CliIo } from '../core/io.js'
import {
  loadContacts,
  mergeGlobalOptions,
  requireAs,
  requireName,
  withDb,
  type GlobalOptions,
} from '../core/context.js'
import { TwitError } from '../core/errors.js'
import { runAction } from '../core/report.js'
import { emitSuccess } from '../output/json.js'
import { replyMessage, sendMessage } from '../core/mailbox.js'
import { toMessage } from '../core/queries.js'

export function registerSendReplyCommands(program: Command, io: CliIo): void {
  const globals = (opts: GlobalOptions): GlobalOptions =>
    mergeGlobalOptions(program.opts() as GlobalOptions, opts)

  program
    .command('send')
    .description('메시지를 전송합니다')
    .requiredOption('--from <이름>', '발신자 이름')
    .requiredOption('--to <이름>', '수신자 이름')
    .requiredOption('--subject <subject>', '제목')
    .option('--body <body>', '본문')
    .option('--body-file <path>', '본문 파일. - 이면 표준 입력')
    .option('--request-id <id>', '전송 중복 방지 요청 키')
    .action(
      async (
        opts: GlobalOptions & {
          from: string
          to: string
          subject: string
          body?: string
          bodyFile?: string
          requestId?: string
        },
      ) => {
        const g = globals(opts)
        return runAction(io, g, () => {
          if (g.as !== undefined) {
            throw new TwitError(
              'VALIDATION_ERROR',
              'send에는 --as를 쓸 수 없습니다. 발신자는 --from, 수신자는 --to로 지정하세요.',
            )
          }
          const contacts = loadContacts(io.env)
          const from = requireName(opts.from, contacts, '--from')
          const to = requireName(opts.to, contacts, '--to')
          return withDb(io, async (db) => {
            const { message, replayed } = await sendMessage(db, {
              from,
              to,
              subject: opts.subject,
              body: opts.body,
              bodyFile: opts.bodyFile,
              requestId: opts.requestId,
            })
            emitSuccess(
              io,
              g,
              { message: toMessage(message, from), replayed },
              () => `sent ${message.id} -> ${message.recipient_id}  ${message.subject}`,
            )
          })
        })
      },
    )

  program
    .command('reply')
    .description('기존 메시지에 답장합니다')
    .argument('<id>', '답장할 메시지 ID')
    .option('--body <body>', '본문')
    .option('--body-file <path>', '본문 파일. - 이면 표준 입력')
    .option('--request-id <id>', '전송 중복 방지 요청 키')
    .action(
      async (
        id: string,
        opts: GlobalOptions & { body?: string; bodyFile?: string; requestId?: string },
      ) => {
        const g = globals(opts)
        return runAction(io, g, () =>
          withDb(io, async (db) => {
            const { as } = requireAs(io.env, g)
            const { message, replayed } = await replyMessage(db, {
              as,
              id,
              body: opts.body,
              bodyFile: opts.bodyFile,
              requestId: opts.requestId,
            })
            emitSuccess(
              io,
              g,
              { message: toMessage(message, as), replayed },
              () => `sent ${message.id} -> ${message.recipient_id}  ${message.subject}`,
            )
          }),
        )
      },
    )
}

