import { promises as fsPromises } from 'node:fs'
import { TwitError } from './errors.js'

export interface BodyInput {
  body?: string
  bodyFile?: string
}

export async function loadBody(input: BodyInput): Promise<string> {
  if (input.body !== undefined && input.bodyFile !== undefined) {
    throw new TwitError('VALIDATION_ERROR', '--body와 --body-file 중 하나만 지정할 수 있습니다.')
  }
  if (input.bodyFile !== undefined) {
    if (input.bodyFile === '-') return readStdin()
    let content: string
    try {
      content = await fsPromises.readFile(input.bodyFile, 'utf8')
    } catch (err) {
      throw new TwitError('VALIDATION_ERROR', `본문 파일을 읽을 수 없습니다: ${input.bodyFile}`, {
        path: input.bodyFile,
        cause: String(err),
      })
    }
    assertNotBlank(content)
    return content
  }
  if (input.body !== undefined) {
    assertNotBlank(input.body)
    return input.body
  }
  throw new TwitError('VALIDATION_ERROR', '본문이 필요합니다. --body 또는 --body-file을 지정하세요.')
}

export function assertNotBlank(text: string, label = '본문'): void {
  if (text.trim() === '') {
    throw new TwitError('VALIDATION_ERROR', `${label}이(가) 비어 있거나 공백만 있습니다.`)
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', (err) =>
      reject(new TwitError('VALIDATION_ERROR', `표준 입력을 읽을 수 없습니다: ${String(err)}`)),
    )
  })
}
