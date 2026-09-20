import type { Command } from 'commander'
import type { CliIo } from '../core/io.js'
import { loadContacts, mergeGlobalOptions, type GlobalOptions } from '../core/context.js'
import { runAction } from '../core/report.js'
import { emitSuccess } from '../output/json.js'

export function registerContactsCommand(program: Command, io: CliIo): void {
  const globals = (opts: GlobalOptions): GlobalOptions =>
    mergeGlobalOptions(program.opts() as GlobalOptions, opts)

  program
    .command('contacts')
    .description('주소록(이름 목록)을 조회합니다. --as 없이 실행할 수 있는 명령이다 (ui도 해당)')
    .action((opts: GlobalOptions) => {
      const g = globals(opts)
      return runAction(io, g, () => {
        const contacts = loadContacts(io.env)
        emitSuccess(io, g, { contacts }, () => contacts.join('\n'))
      })
    })
}
