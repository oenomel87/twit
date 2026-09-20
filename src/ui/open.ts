import { spawn } from 'node:child_process'

export function openUrl(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open'
  const child = spawn(command, [url], { stdio: 'ignore', detached: true })
  child.unref()
  child.on('error', () => {
    // 비동기 실패는 명령을 죽이지 않는다. 동기 throw만 commands/ui.ts가 stderr로 받는다.
  })
}
