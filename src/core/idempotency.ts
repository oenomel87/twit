import { createHash } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import { TwitError } from './errors.js'

export function hashInput(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

interface RequestRow {
  sender_id: string
  request_id: string
  input_hash: string
  message_id: string
  created_at: string
}

export function findRequest(
  db: Database,
  senderId: string,
  requestId: string,
): RequestRow | undefined {
  return db
    .prepare('SELECT * FROM requests WHERE sender_id = ? AND request_id = ?')
    .get(senderId, requestId) as RequestRow | undefined
}

export function saveRequest(
  db: Database,
  senderId: string,
  requestId: string,
  inputHash: string,
  messageId: string,
): void {
  db.prepare(
    'INSERT INTO requests (sender_id, request_id, input_hash, message_id, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(senderId, requestId, inputHash, messageId, new Date().toISOString())
}

export function resolveReplay(
  db: Database,
  senderId: string,
  requestId: string | undefined,
  inputHash: string | null,
): string | null {
  if (!requestId || inputHash === null) return null
  const existing = findRequest(db, senderId, requestId)
  if (!existing) return null
  if (existing.input_hash !== inputHash) {
    throw new TwitError('REQUEST_ID_CONFLICT', '같은 요청 키에 다른 내용이 저장되어 있습니다.', {
      request_id: requestId,
    })
  }
  return existing.message_id
}
