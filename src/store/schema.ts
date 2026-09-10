export interface Migration {
  version: number
  /** 트랜잭션 시작 전에 실행할 문. 마이그레이션 2는 foreign_keys를 끄고 시작한다. */
  before?: string[]
  statements: string[]
  /** 트랜잭션 안에서 문을 실행한 뒤 foreign_key_check를 수행한다. */
  foreignKeyCheck?: boolean
  /** 트랜잭션 종료 뒤 실행할 문. 마이그레이션 2는 foreign_keys를 다시 켠다. */
  after?: string[]
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE contacts (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at   TEXT NOT NULL
)`,
      `CREATE TABLE messages (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  id           TEXT NOT NULL UNIQUE,
  thread_id    TEXT NOT NULL,
  reply_to_id  TEXT REFERENCES messages(id),
  sender_id    TEXT NOT NULL REFERENCES contacts(id),
  recipient_id TEXT NOT NULL REFERENCES contacts(id),
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL
)`,
      `CREATE INDEX messages_recipient ON messages(recipient_id, seq)`,
      `CREATE INDEX messages_sender    ON messages(sender_id, seq)`,
      `CREATE INDEX messages_thread    ON messages(thread_id, seq)`,
      `CREATE TABLE receipts (
  message_id TEXT PRIMARY KEY REFERENCES messages(id),
  read_at    TEXT,
  archived   INTEGER NOT NULL DEFAULT 0
)`,
      `CREATE TABLE requests (
  sender_id  TEXT NOT NULL,
  request_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  message_id TEXT NOT NULL REFERENCES messages(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (sender_id, request_id)
)`,
    ],
  },
  {
    version: 2,
    before: [`PRAGMA foreign_keys = OFF`],
    foreignKeyCheck: true,
    statements: [
      `CREATE TABLE messages_new (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  id           TEXT NOT NULL UNIQUE,
  thread_id    TEXT NOT NULL,
  reply_to_id  TEXT REFERENCES messages(id),
  sender_id    TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL
)`,
      `INSERT INTO messages_new (seq, id, thread_id, reply_to_id, sender_id, recipient_id, subject, body, created_at)
 SELECT seq, id, thread_id, reply_to_id, sender_id, recipient_id, subject, body, created_at FROM messages`,
      `DROP TABLE messages`,
      `ALTER TABLE messages_new RENAME TO messages`,
      `CREATE INDEX messages_recipient ON messages(recipient_id, seq)`,
      `CREATE INDEX messages_sender    ON messages(sender_id, seq)`,
      `CREATE INDEX messages_thread    ON messages(thread_id, seq)`,
      `DROP TABLE contacts`,
    ],
    after: [`PRAGMA foreign_keys = ON`],
  },
]
