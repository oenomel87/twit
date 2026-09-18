import type { DatabaseSync } from 'node:sqlite'
import { preview } from './preview.js'
import { getMessage, type MessageRow } from './mailbox.js'

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

export interface ThreadSummary {
  thread_id: string
  subject: string
  participants: [string, string]
  message_count: number
  last_id: string
  last_at: string
  preview: string
}

export interface ObserverMessage {
  id: string
  thread_id: string
  reply_to_id: string | null
  sender: string
  recipient: string
  subject: string
  created_at: string
  read: boolean
  archived: boolean
  body_length: number
  body: string
}

export interface ThreadDetail {
  thread_id: string
  subject: string
  participants: [string, string]
  messages: ObserverMessage[]
}

export function toObserverMessage(row: MessageRow): ObserverMessage {
  return {
    id: row.id,
    thread_id: row.thread_id,
    reply_to_id: row.reply_to_id,
    sender: row.sender_id,
    recipient: row.recipient_id,
    subject: row.subject,
    created_at: row.created_at,
    read: row.read_at !== null,
    archived: row.archived === 1,
    body_length: [...row.body].length,
    body: row.body,
  }
}

export function listThreads(db: DatabaseSync): ThreadSummary[] {
  const groups = db
    .prepare(
      `SELECT thread_id,
              MIN(seq) AS origin_seq,
              MAX(seq) AS last_seq,
              COUNT(*) AS message_count
       FROM messages
       GROUP BY thread_id
       ORDER BY MAX(seq) DESC, thread_id ASC`,
    )
    .all() as unknown as { thread_id: string; origin_seq: number; last_seq: number; message_count: number }[]

  const bySeq = db.prepare(
    `SELECT m.seq, m.id, m.thread_id, m.reply_to_id, m.sender_id, m.recipient_id, m.subject, m.body, m.created_at,
            r.read_at AS read_at, r.archived AS archived
     FROM messages m
     LEFT JOIN receipts r ON r.message_id = m.id
     WHERE m.seq = ?`,
  )

  return groups.map((group) => {
    const origin = bySeq.get(group.origin_seq) as unknown as MessageRow
    const last = bySeq.get(group.last_seq) as unknown as MessageRow
    return {
      thread_id: origin.id,
      subject: origin.subject,
      participants: [origin.sender_id, origin.recipient_id],
      message_count: Number(group.message_count),
      last_id: last.id,
      last_at: last.created_at,
      preview: preview(last.body),
    }
  })
}

export function getThreadForUi(db: DatabaseSync, id: string): ThreadDetail | undefined {
  const start = getMessage(db, id)
  if (!start) return undefined
  const rows = threadMessages(db, start.thread_id)
  const origin = rows[0] ?? start
  return {
    thread_id: start.thread_id,
    subject: origin.subject,
    participants: [origin.sender_id, origin.recipient_id],
    messages: rows.map(toObserverMessage),
  }
}
