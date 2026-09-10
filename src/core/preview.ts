/**
 * 본문의 미리보기를 만든다. LF/CRLF로 나눠 공백이 아닌 첫 줄을 골라
 * 앞뒤 공백을 제거하고, 코드 포인트 80개를 넘으면 80개 뒤에 `…`를 붙인다.
 * Markdown 기호는 해석하지 않는다.
 */
export function preview(body: string, limit = 80): string {
  const lines = body.split(/\r\n|\n|\r/)
  const first = lines.find((line) => line.trim() !== '') ?? ''
  const trimmed = first.trim()
  const length = [...trimmed].length
  if (length <= limit) return trimmed
  return [...trimmed].slice(0, limit).join('') + '…'
}
