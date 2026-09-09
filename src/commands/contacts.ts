import type { Command } from 'commander'
import { TwitError } from '../core/errors.js'
import type { CliIo } from '../core/io.js'
import {
  countContacts,
  listContacts,
  mergeGlobalOptions,
  requireActor,
  withDb,
  type ContactRow,
  type GlobalOptions,
} from '../core/context.js'
import { runAction } from '../core/report.js'
import { emitSuccess } from '../output/json.js'

export const CONTACT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

function renderContact(contact: ContactRow): string {
  return `${contact.id} (${contact.display_name})`
}

export function registerContactsCommands(program: Command, io: CliIo): void {
  const globals = (opts: GlobalOptions): GlobalOptions =>
    mergeGlobalOptions(program.opts() as GlobalOptions, opts)

  program
    .command('contacts')
    .description('등록된 참여자를 조회합니다')
    .action((opts: GlobalOptions) => {
      const g = globals(opts)
      return runAction(io, g, () =>
        withDb(io, (db) => {
          requireActor({ db }, g, io.env)
          const contacts = listContacts({ db }).map((contact) => ({
            id: contact.id,
            display_name: contact.display_name,
          }))
          emitSuccess(io, g, { contacts }, () =>
            contacts.length === 0
              ? '(no contacts)'
              : contacts.map((c) => `${c.id} (${c.display_name})`).join('\n'),
          )
        }),
      )
    })
    .command('add')
    .description('참여자를 등록합니다')
    .argument('<id>', '참여자 ID')
    .requiredOption('--name <name>', '표시 이름')
    .action((id: string, opts: GlobalOptions) => {
      const g = globals(opts)
      return runAction(io, g, () =>
        withDb(io, (db) => {
          const trimmedId = id.trim()
          if (!CONTACT_ID_PATTERN.test(trimmedId)) {
            throw new TwitError(
              'VALIDATION_ERROR',
              `참여자 ID 형식이 잘못되었습니다: ${trimmedId}`,
              { id: trimmedId },
            )
          }
          const name = (g.name ?? '').trim()
          if (name === '') {
            throw new TwitError('VALIDATION_ERROR', '표시 이름(--name)은 필수입니다.', {
              id: trimmedId,
            })
          }
          // 첫 참여자 등록에는 호출자가 필요 없다. 이미 참여자가 있으면 호출자를 요구한다.
          if (countContacts({ db }) > 0) requireActor({ db }, g, io.env)
          const existing = db.prepare('SELECT id FROM contacts WHERE id = ?').get(trimmedId)
          if (existing) {
            throw new TwitError('VALIDATION_ERROR', `이미 등록된 참여자입니다: ${trimmedId}`, {
              id: trimmedId,
            })
          }
          db
            .prepare('INSERT INTO contacts (id, display_name, created_at) VALUES (?, ?, ?)')
            .run(trimmedId, name, new Date().toISOString())
          const contact = db
            .prepare('SELECT id, display_name, created_at FROM contacts WHERE id = ?')
            .get(trimmedId) as ContactRow
          emitSuccess(io, g, { id: contact.id, display_name: contact.display_name }, () =>
            renderContact(contact),
          )
        }),
      )
    })

  program
    .command('whoami')
    .description('현재 호출자를 확인합니다')
    .action((opts: GlobalOptions) => {
      const g = globals(opts)
      return runAction(io, g, () =>
        withDb(io, (db) => {
          const actor = requireActor({ db }, g, io.env)
          emitSuccess(io, g, { id: actor.id, display_name: actor.display_name }, () =>
            renderContact(actor),
          )
        }),
      )
    })
}
