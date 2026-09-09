import { Command, CommanderError } from 'commander'
import { EXIT_CODES } from './core/errors.js'
import type { CliIo } from './core/io.js'
import { reportError, ReportedError } from './core/report.js'
import { errorEnvelope } from './output/json.js'
import { registerContactsCommands } from './commands/contacts.js'
import { registerSendReadCommands } from './commands/send.js'
import { registerListCommands } from './commands/inbox.js'
import { registerThreadCommand } from './commands/thread.js'
import { registerArchiveCommands } from './commands/archive.js'

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const program = new Command()
  program
    .name('twit')
    .description('로컬 에이전트 메일함. 사람과 CLI 에이전트가 비동기 메시지를 주고받는다.')
    .option('--json', '결과를 JSON 봉투로 출력한다')
    .option('--actor <id>', '호출자 참여자 ID')
    .exitOverride()

  registerContactsCommands(program, io)
  registerSendReadCommands(program, io)
  registerListCommands(program, io)
  registerThreadCommand(program, io)
  registerArchiveCommands(program, io)

  try {
    await program.parseAsync(argv, { from: 'user' })
    return 0
  } catch (err) {
    if (err instanceof ReportedError) return err.exitCode
    if (err instanceof CommanderError) {
      if (
        err.code === 'commander.helpDisplayed' ||
        err.code === 'commander.help' ||
        err.code === 'commander.version'
      ) {
        return err.exitCode
      }
      // 파서 오류는 commander가 이미 stderr로 안내한다. --json일 때만 봉투를 stdout에 추가한다.
      if (argv.includes('--json')) {
        io.stdout(
          errorEnvelope({
            code: 'VALIDATION_ERROR',
            message: err.message,
            details: { argv },
          }),
        )
      }
      return EXIT_CODES.VALIDATION_ERROR
    }
    return reportError(err, null, io)
  }
}
