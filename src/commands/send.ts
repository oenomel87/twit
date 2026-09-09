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
import { renderMessageDetail } from '../output/text.js'
import { readMessage, replyMessage, sendMessage } from '../core/mailbox.js'
import { toMessage } from '../core/queries.js'

export function registerSendReadCommands(program: Command, io: CliIo): void {
  const globals = (opts: GlobalOptions): GlobalOptions =>
    mergeGlobalOptions(program.opts() as GlobalOptions, opts)

  program
    .command('send')
    .description('메시지를 전송합니다')
    .requiredOption('--to <id>', '수신자 참여자 ID')
    .requiredOption('--subject <subject>', '제목')
    .option('--body <body>', '본문')
    .option('--body-file <path>', '본문 파일. - 이면 표준 입력')
    .option('--request-id <id>', '전송 중복 방지 요청 키')
    .action(
      async (
        opts: GlobalOptions & {
          to: string
          subject: string
          body?: string
          bodyFile?: string
          requestId?: string
        },
      ) => {
        const g = globals(opts)
        return runAction(io, g, () =>
          withDb(io, async (db) => {
            const actor = requireActor({ db }, g, io.env)
            const { message, replayed } = await sendMessage(db, actor, {
              to: opts.to,
              subject: opts.subject,
              body: opts.body,
              bodyFile: opts.bodyFile,
              requestId: opts.requestId,
            })
          emitSuccess(
            io,
            g,
            { message: toMessage(message, actor.id), replayed },
            () => `sent ${message.id} -> ${message.recipient_id}  ${message.subject}`,
          )
        }),
      )
    })

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
            const actor = requireActor({ db }, g, io.env)
            const { message, replayed } = await replyMessage(db, actor, {
              id,
              body: opts.body,
              bodyFile: opts.bodyFile,
              requestId: opts.requestId,
            })
          emitSuccess(
            io,
            g,
            { message: toMessage(message, actor.id), replayed },
            () => `sent ${message.id} -> ${message.recipient_id}  ${message.subject}`,
          )
        }),
      )
    })

  program
    .command('read')
    .description('메시지를 읽고 수신자라면 읽음으로 표시합니다')
    .argument('<id>', '메시지 ID')
    .action((id: string, opts: GlobalOptions) => {
      const g = globals(opts)
      return runAction(io, g, () =>
        withDb(io, (db) => {
          const actor = requireActor({ db }, g, io.env)
          const { message, marked_read } = readMessage(db, actor, id)
          emitSuccess(io, g, { message: toMessage(message, actor.id), marked_read }, () =>
            renderMessageDetail(message),
          )
        }),
      )
    })
}
