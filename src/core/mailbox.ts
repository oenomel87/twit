import type { DatabaseSync } from 'node:sqlite'
import { TwitError } from './errors.js'
import { assertNotBlank, loadBody } from './body.js'
import { hashInput, resolveReplay, saveRequest } from './idempotency.js'
import { immediate } from '../store/db.js'

export interface MessageRow {
  seq: number
  id: string
  thread_id: string
  reply_to_id: string | null
  sender_id: string
  recipient_id: string
  subject: string
  body: string
  created_at: string
  read_at: string | null
  archived: number
}

const SELECT_WITH_RECEIPT = `SELECT m.seq, m.id, m.thread_id, m.reply_to_id, m.sender_id, m.recipient_id, m.subject, m.body, m.created_at,
       r.read_at AS read_at, r.archived AS archived
FROM messages m
LEFT JOIN receipts r ON r.message_id = m.id`

export function getMessage(db: DatabaseSync, id: string): MessageRow | undefined {
  return db.prepare(`${SELECT_WITH_RECEIPT} WHERE m.id = ?`).get(id) as unknown as MessageRow | undefined
}

export interface SendInput {
  from: string
  to: string
  subject?: string
  body?: string
  bodyFile?: string
  requestId?: string
}

export interface SendResult {
  message: MessageRow
  replayed: boolean
}

function nextSeq(db: DatabaseSync): number {
  return (db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM messages').get() as unknown as { next: number }).next
}

function messageId(seq: number): string {
  return `M-${String(seq).padStart(3, '0')}`
}

function insertMessage(db: DatabaseSync, row: {
  seq: number
  id: string
  threadId: string
  replyToId: string | null
  senderId: string
  recipientId: string
  subject: string
  body: string
}): void {
  const createdAt = new Date().toISOString()
  db.prepare(
    `INSERT INTO messages (seq, id, thread_id, reply_to_id, sender_id, recipient_id, subject, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.seq,
    row.id,
    row.threadId,
    row.replyToId,
    row.senderId,
    row.recipientId,
    row.subject,
    row.body,
    createdAt,
  )
  db.prepare('INSERT INTO receipts (message_id, read_at, archived) VALUES (?, NULL, 0)').run(row.id)
}

export async function sendMessage(db: DatabaseSync, input: SendInput): Promise<SendResult> {
  const subject = (input.subject ?? '').trim()
  assertNotBlank(subject, '제목')
  const body = await loadBody({ body: input.body, bodyFile: input.bodyFile })
  const inputHash = input.requestId
    ? hashInput({ command: 'send', to: input.to, subject, body })
    : null

  return immediate(db, (): SendResult => {
    const replayId = resolveReplay(db, input.from, input.requestId, inputHash)
    if (replayId) {
      const existing = getMessage(db, replayId)
      if (existing) return { message: existing, replayed: true }
    }
    const seq = nextSeq(db)
    const id = messageId(seq)
    insertMessage(db, {
      seq,
      id,
      threadId: id,
      replyToId: null,
      senderId: input.from,
      recipientId: input.to,
      subject,
      body,
    })
    if (input.requestId && inputHash) {
      saveRequest(db, input.from, input.requestId, inputHash, id)
    }
    return { message: getMessage(db, id) as unknown as MessageRow, replayed: false }
  })
}

export interface ReadResult {
  message: MessageRow
  marked_read: boolean
}

export function readMessage(db: DatabaseSync, as: string, id: string): ReadResult {
  return immediate(db, (): ReadResult => {
    const row = getMessage(db, id)
    if (!row) {
      throw new TwitError('NOT_FOUND', `메시지를 찾을 수 없습니다: ${id}`, { id })
    }
    if (row.sender_id !== as && row.recipient_id !== as) {
      throw new TwitError('FORBIDDEN', '발신자나 수신자만 이 메시지를 읽을 수 있습니다.', {
        id,
        as,
      })
    }
    let markedRead = false
    if (row.recipient_id === as) {
      const result = db
        .prepare('UPDATE receipts SET read_at = ? WHERE message_id = ? AND read_at IS NULL')
        .run(new Date().toISOString(), id)
      markedRead = Number(result.changes) === 1
    }
    return { message: getMessage(db, id) as unknown as MessageRow, marked_read: markedRead }
  })
}

export interface ReplyInput {
  as: string
  id: string
  body?: string
  bodyFile?: string
  requestId?: string
}

export async function replyMessage(db: DatabaseSync, input: ReplyInput): Promise<SendResult> {
  const body = await loadBody({ body: input.body, bodyFile: input.bodyFile })
  const inputHash = input.requestId
    ? hashInput({ command: 'reply', reply_to_id: input.id, body })
    : null

  return immediate(db, (): SendResult => {
    const replayId = resolveReplay(db, input.as, input.requestId, inputHash)
    if (replayId) {
      const existing = getMessage(db, replayId)
      if (existing) return { message: existing, replayed: true }
    }
    const original = getMessage(db, input.id)
    if (!original) {
      throw new TwitError('NOT_FOUND', `메시지를 찾을 수 없습니다: ${input.id}`, { id: input.id })
    }
    if (original.sender_id !== input.as && original.recipient_id !== input.as) {
      throw new TwitError('FORBIDDEN', '발신자나 수신자만 답장할 수 있습니다.', {
        id: original.id,
        as: input.as,
      })
    }
    const recipientId =
      original.sender_id === original.recipient_id
        ? original.sender_id
        : original.recipient_id === input.as
          ? original.sender_id
          : original.recipient_id
    const seq = nextSeq(db)
    const id = messageId(seq)
    insertMessage(db, {
      seq,
      id,
      threadId: original.thread_id,
      replyToId: original.id,
      senderId: input.as,
      recipientId: recipientId,
      subject: original.subject,
      body,
    })
    if (input.requestId && inputHash) {
      saveRequest(db, input.as, input.requestId, inputHash, id)
    }
    return { message: getMessage(db, id) as unknown as MessageRow, replayed: false }
  })
}

export function setArchived(
  db: DatabaseSync,
  as: string,
  id: string,
  archived: boolean,
): { id: string; archived: boolean } {
  const row = getMessage(db, id)
  if (!row) {
    throw new TwitError('NOT_FOUND', `메시지를 찾을 수 없습니다: ${id}`, { id })
  }
  if (row.recipient_id !== as) {
    throw new TwitError('FORBIDDEN', '수신자만 보관 상태를 바꿀 수 있습니다.', {
      id,
      as,
    })
  }
  db.prepare('UPDATE receipts SET archived = ? WHERE message_id = ?').run(archived ? 1 : 0, id)
  return { id, archived }
}
