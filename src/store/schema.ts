export interface Migration {
  version: number
  statements: string[]
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
]
