import type { Database, Transaction } from 'better-sqlite3'
import { TwitError } from './errors.js'
import { assertNotBlank, loadBody } from './body.js'
import type { ContactRow } from './context.js'
import { hashInput, resolveReplay, saveRequest } from './idempotency.js'

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

export function getMessage(db: Database, id: string): MessageRow | undefined {
  return db.prepare(`${SELECT_WITH_RECEIPT} WHERE m.id = ?`).get(id) as MessageRow | undefined
}

export interface SendInput {
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

function nextSeq(db: Database): number {
  return (db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM messages').get() as { next: number }).next
}

function messageId(seq: number): string {
  return `M-${String(seq).padStart(3, '0')}`
}

function insertMessage(db: Database, row: {
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

export async function sendMessage(
  db: Database,
  actor: ContactRow,
  input: SendInput,
): Promise<SendResult> {
  const subject = (input.subject ?? '').trim()
  assertNotBlank(subject, '제목')
  const body = await loadBody({ body: input.body, bodyFile: input.bodyFile })
  const inputHash = input.requestId
    ? hashInput({ command: 'send', to: input.to, subject, body })
    : null

  const apply = db.transaction((): SendResult => {
    const replayId = resolveReplay(db, actor.id, input.requestId, inputHash)
    if (replayId) {
      const existing = getMessage(db, replayId)
      if (existing) return { message: existing, replayed: true }
    }
    const recipient = db.prepare('SELECT id FROM contacts WHERE id = ?').get(input.to) as
      | { id: string }
      | undefined
    if (!recipient) {
      throw new TwitError('NOT_FOUND', `등록되지 않은 수신자입니다: ${input.to}`, { to: input.to })
    }
    const seq = nextSeq(db)
    const id = messageId(seq)
    insertMessage(db, {
      seq,
      id,
      threadId: id,
      replyToId: null,
      senderId: actor.id,
      recipientId: recipient.id,
      subject,
      body,
    })
    if (input.requestId && inputHash) {
      saveRequest(db, actor.id, input.requestId, inputHash, id)
    }
    return { message: getMessage(db, id) as MessageRow, replayed: false }
  })
  return commit(apply)
}

function commit(apply: Transaction<() => SendResult>): SendResult {
  try {
    return apply.immediate()
  } catch (err) {
    if (err instanceof TwitError) throw err
    throw new TwitError('STORAGE_ERROR', `데이터베이스 저장에 실패했습니다: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err instanceof Error ? err.name : String(err),
    })
  }
}

export interface ReadResult {
  message: MessageRow
  marked_read: boolean
}

export function readMessage(db: Database, actor: ContactRow, id: string): ReadResult {
  const row = getMessage(db, id)
  if (!row) {
    throw new TwitError('NOT_FOUND', `메시지를 찾을 수 없습니다: ${id}`, { id })
  }
  if (row.sender_id !== actor.id && row.recipient_id !== actor.id) {
    throw new TwitError('FORBIDDEN', '발신자나 수신자만 이 메시지를 읽을 수 있습니다.', {
      id,
      actor: actor.id,
    })
  }
  let markedRead = false
  if (row.recipient_id === actor.id) {
    const result = db
      .prepare('UPDATE receipts SET read_at = ? WHERE message_id = ? AND read_at IS NULL')
      .run(new Date().toISOString(), id)
    markedRead = result.changes === 1
  }
  return { message: getMessage(db, id) as MessageRow, marked_read: markedRead }
}

export interface ReplyInput {
  id: string
  body?: string
  bodyFile?: string
  requestId?: string
}

export async function replyMessage(
  db: Database,
  actor: ContactRow,
  input: ReplyInput,
): Promise<SendResult> {
  const body = await loadBody({ body: input.body, bodyFile: input.bodyFile })
  const inputHash = input.requestId
    ? hashInput({ command: 'reply', reply_to_id: input.id, body })
    : null

  const apply = db.transaction((): SendResult => {
    const replayId = resolveReplay(db, actor.id, input.requestId, inputHash)
    if (replayId) {
      const existing = getMessage(db, replayId)
      if (existing) return { message: existing, replayed: true }
    }
    const original = getMessage(db, input.id)
    if (!original) {
      throw new TwitError('NOT_FOUND', `메시지를 찾을 수 없습니다: ${input.id}`, { id: input.id })
    }
    if (original.sender_id !== actor.id && original.recipient_id !== actor.id) {
      throw new TwitError('FORBIDDEN', '발신자나 수신자만 답장할 수 있습니다.', {
        id: original.id,
        actor: actor.id,
      })
    }
    const recipientId =
      original.sender_id === original.recipient_id
        ? original.sender_id
        : original.recipient_id === actor.id
          ? original.sender_id
          : original.recipient_id
    const seq = nextSeq(db)
    const id = messageId(seq)
    insertMessage(db, {
      seq,
      id,
      threadId: original.thread_id,
      replyToId: original.id,
      senderId: actor.id,
      recipientId: recipientId,
      subject: original.subject,
      body,
    })
    if (input.requestId && inputHash) {
      saveRequest(db, actor.id, input.requestId, inputHash, id)
    }
    return { message: getMessage(db, id) as MessageRow, replayed: false }
  })
  return commit(apply)
}

export function setArchived(
  db: Database,
  actor: ContactRow,
  id: string,
  archived: boolean,
): { id: string; archived: boolean } {
  const row = getMessage(db, id)
  if (!row) {
    throw new TwitError('NOT_FOUND', `메시지를 찾을 수 없습니다: ${id}`, { id })
  }
  if (row.recipient_id !== actor.id) {
    throw new TwitError('FORBIDDEN', '수신자만 보관 상태를 바꿀 수 있습니다.', {
      id,
      actor: actor.id,
    })
  }
  db.prepare('UPDATE receipts SET archived = ? WHERE message_id = ?').run(archived ? 1 : 0, id)
  return { id, archived }
}
