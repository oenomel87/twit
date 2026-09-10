import type { DatabaseSync } from 'node:sqlite'
import { preview } from './preview.js'
import type { MessageRow } from './mailbox.js'

export type InboxFilter = 'default' | 'unread' | 'archived' | 'all'

export function inboxMessages(db: DatabaseSync, as: string, filter: InboxFilter): MessageRow[] {
  const base = 'recipient_id = ?'
  const condition =
    filter === 'all'
      ? base
      : filter === 'archived'
        ? `${base} AND archived = 1`
        : filter === 'unread'
          ? `${base} AND archived = 0 AND read_at IS NULL`
          : `${base} AND archived = 0`
  return db
    .prepare(
      `SELECT m.seq, m.id, m.thread_id, m.reply_to_id, m.sender_id, m.recipient_id, m.subject, m.body, m.created_at,
              r.read_at AS read_at, r.archived AS archived
       FROM messages m
       LEFT JOIN receipts r ON r.message_id = m.id
       WHERE ${condition}
       ORDER BY m.seq DESC`,
    )
    .all(as) as unknown as MessageRow[]
}

export function sentMessages(db: DatabaseSync, as: string): MessageRow[] {
  return db
    .prepare(
      `SELECT m.seq, m.id, m.thread_id, m.reply_to_id, m.sender_id, m.recipient_id, m.subject, m.body, m.created_at,
              r.read_at AS read_at, r.archived AS archived
       FROM messages m
       LEFT JOIN receipts r ON r.message_id = m.id
       WHERE sender_id = ?
       ORDER BY m.seq DESC`,
    )
    .all(as) as unknown as MessageRow[]
}

export function threadMessages(db: DatabaseSync, threadId: string): MessageRow[] {
  return db
    .prepare(
      `SELECT m.seq, m.id, m.thread_id, m.reply_to_id, m.sender_id, m.recipient_id, m.subject, m.body, m.created_at,
              r.read_at AS read_at, r.archived AS archived
       FROM messages m
       LEFT JOIN receipts r ON r.message_id = m.id
       WHERE thread_id = ?
       ORDER BY m.seq ASC`,
    )
    .all(threadId) as unknown as MessageRow[]
}

/** 모든 응답에 공통인 메타데이터. 목록·본문 응답의 공통 부분이다. */
export function toMeta(row: MessageRow, as: string): Record<string, unknown> {
  const isRecipient = row.recipient_id === as
  return {
    id: row.id,
    thread_id: row.thread_id,
    reply_to_id: row.reply_to_id,
    sender: row.sender_id,
    recipient: row.recipient_id,
    subject: row.subject,
    created_at: row.created_at,
    read: isRecipient ? row.read_at !== null : null,
    archived: isRecipient ? row.archived === 1 : null,
    body_length: [...row.body].length,
  }
}

/** 목록(inbox, sent, thread --no-body)의 항목. 본문 대신 미리보기를 담는다. */
export function toSummary(row: MessageRow, as: string): Record<string, unknown> {
  return { ...toMeta(row, as), preview: preview(row.body) }
}

/** 본문을 돌려주는 응답(read, send, reply, thread)의 항목. preview는 없다. */
export function toMessage(row: MessageRow, as: string): Record<string, unknown> {
  return { ...toMeta(row, as), body: row.body }
}
