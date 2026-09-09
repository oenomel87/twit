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
import { setArchived } from '../core/mailbox.js'

export function registerArchiveCommands(program: Command, io: CliIo): void {
  const globals = (opts: GlobalOptions): GlobalOptions =>
    mergeGlobalOptions(program.opts() as GlobalOptions, opts)

  const register = (name: 'archive' | 'unarchive', archived: boolean, description: string) => {
    program
      .command(name)
      .description(description)
      .argument('<id>', '메시지 ID')
      .action((id: string, opts: GlobalOptions) => {
        const g = globals(opts)
        return runAction(io, g, () =>
          withDb(io, (db) => {
            const actor = requireActor({ db }, g, io.env)
            const result = setArchived(db, actor, id, archived)
            emitSuccess(io, g, result, () =>
              `${result.id} ${result.archived ? 'archived' : 'unarchived'}`,
            )
          }),
        )
      })
  }

  register('archive', true, '받은 메시지를 기본 인박스에서 숨깁니다')
  register('unarchive', false, '보관한 메시지를 기본 인박스로 돌립니다')
}
