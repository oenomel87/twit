import type { Database } from 'better-sqlite3'
import type { MessageRow } from './mailbox.js'

export type InboxFilter = 'default' | 'unread' | 'archived' | 'all'

export function inboxMessages(db: Database, actorId: string, filter: InboxFilter): MessageRow[] {
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
    .all(actorId) as MessageRow[]
}

export function sentMessages(db: Database, actorId: string): MessageRow[] {
  return db
    .prepare(
      `SELECT m.seq, m.id, m.thread_id, m.reply_to_id, m.sender_id, m.recipient_id, m.subject, m.body, m.created_at,
              r.read_at AS read_at, r.archived AS archived
       FROM messages m
       LEFT JOIN receipts r ON r.message_id = m.id
       WHERE sender_id = ?
       ORDER BY m.seq DESC`,
    )
    .all(actorId) as MessageRow[]
}

export function threadMessages(db: Database, threadId: string): MessageRow[] {
  return db
    .prepare(
      `SELECT m.seq, m.id, m.thread_id, m.reply_to_id, m.sender_id, m.recipient_id, m.subject, m.body, m.created_at,
              r.read_at AS read_at, r.archived AS archived
       FROM messages m
       LEFT JOIN receipts r ON r.message_id = m.id
       WHERE thread_id = ?
       ORDER BY m.seq ASC`,
    )
    .all(threadId) as MessageRow[]
}

export function toSummary(row: MessageRow, viewerId: string): Record<string, unknown> {
  const isRecipient = row.recipient_id === viewerId
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
    body_length: row.body.length,
  }
}

export function toMessage(row: MessageRow, viewerId: string): Record<string, unknown> {
  return { ...toSummary(row, viewerId), body: row.body }
}
