import { preview } from '../core/preview.js'
import type { MessageRow } from '../core/mailbox.js'

function readMark(row: MessageRow, viewerId: string, fallback = ' '): string {
  if (row.recipient_id !== viewerId) return fallback
  return row.read_at !== null ? ' ' : '*'
}

/** 목록 한 항목을 두 줄로 렌더링한다. 둘째 줄은 들여쓴 미리보기다. */
function listEntry(firstLine: string, row: MessageRow): string {
  return `${firstLine}\n  ${preview(row.body)}`
}

export function renderMessageList(
  rows: MessageRow[],
  viewerId: string,
  opts: { showArchived?: boolean } = {},
): string {
  if (rows.length === 0) return '(no messages)'
  return rows
    .map((row) => {
      const counterpart = row.sender_id === viewerId ? row.recipient_id : row.sender_id
      const archivedMark = opts.showArchived ? (row.archived === 1 ? '[A] ' : '    ') : ''
      const firstLine = `${archivedMark}${row.id}  ${readMark(row, viewerId)}  ${counterpart}  ${row.created_at}  ${row.subject}`
      return listEntry(firstLine, row)
    })
    .join('\n')
}

export function renderMessageDetail(row: MessageRow): string {
  const lines = [
    `ID: ${row.id}`,
    `From: ${row.sender_id}`,
    `To: ${row.recipient_id}`,
    `Subject: ${row.subject}`,
    `Date: ${row.created_at}`,
    `Reply-To: ${row.reply_to_id ?? '-'}`,
    `Thread: ${row.thread_id}`,
    '',
    row.body,
  ]
  return lines.join('\n')
}

const SEPARATOR = '-'.repeat(48)

export { SEPARATOR }

export function renderThread(rows: MessageRow[]): string {
  return rows.map((row) => renderMessageDetail(row)).join(`\n${SEPARATOR}\n`)
}

export function renderThreadList(rows: MessageRow[], viewerId: string): string {
  if (rows.length === 0) return '(no messages)'
  return rows
    .map((row) => {
      const replyTo = row.reply_to_id ?? '-'
      const firstLine = `${row.id}  ${row.sender_id} → ${row.recipient_id}  ${row.created_at}  reply:${replyTo}  ${readMark(row, viewerId, '-')}  ${[...row.body].length}`
      return listEntry(firstLine, row)
    })
    .join('\n')
}
