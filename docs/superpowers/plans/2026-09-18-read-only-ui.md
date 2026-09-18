# 읽기 전용 로컬 UI (`twit ui`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Follow @test-driven-development: no production code without a failing test first.

**Goal:** `twit ui`가 로컬 브라우저에서 메일함 전체 대화를 읽기 전용으로 보여 준다.

**Architecture:** 기존 SQLite를 `openDatabase`로 연 뒤 `node:http`가 `127.0.0.1` 임의 포트에 GET만 받는다. 조회는 `queries.ts`의 관찰자 함수이고, HTML은 `page.ts` 문자열이다. CLI `read`/`thread` 권한 규칙은 바꾸지 않는다. `run(['ui'])` 성공 경로는 SIGINT를 기다리므로 테스트는 서버 모듈을 직접 연다.

**Tech Stack:** TypeScript, Node 24, `node:http`, `node:sqlite`, commander, vitest. 새 npm 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-09-18-read-only-ui-design.md`

---

## File map

| File | Responsibility |
|---|---|
| Create: `src/core/queries.ts` (extend) | `listThreads`, `getThreadForUi`, `toObserverMessage`. 권한 투영 없음 |
| Create: `src/ui/server.ts` | `startUiServer(db)` — GET `/`, `/api/threads`, `/api/threads/:id` |
| Create: `src/ui/page.ts` | `PAGE_HTML` 한 문자열. `textContent`만 사용 |
| Create: `src/ui/open.ts` | `openUrl(url)` — macOS `open` / 그 외 `xdg-open`. src에서 `child_process`를 쓰는 유일한 파일 |
| Create: `src/commands/ui.ts` | `twit ui`. `--as` 거절, DB 수명, 시그널 대기 |
| Modify: `src/main.ts` | `registerUiCommand`. `--as` 도움말 문구 |
| Modify: `src/commands/contacts.ts` | 「유일한 명령」→ contacts와 ui |
| Create: `test/ui.test.ts` | 관찰자 조회·HTTP·페이지·`--as` |
| Modify: `test/persistence.test.ts` | `child_process` 예외 `ui/open.ts` |
| Modify: `test/docs.test.ts` | 05·README의 `twit ui` 안내 |
| Modify: `docs/03-…`, `04-…`, `05-…`, `README.md`, `docs/README.md` | 명세 10장 |

테스트는 기존 `test/helpers.ts`의 임시 `TWIT_HOME`만 쓴다. 실제 `~/.twit`을 열지 않는다.

---

### Task 1: 관찰자 조회 함수

**Files:**
- Modify: `src/core/queries.ts`
- Test: `test/ui.test.ts`

이 함수들은 HTTP보다 먼저 둔다. 서버는 여기만 호출한다.

- [ ] **Step 1: Write the failing tests**

`test/ui.test.ts`를 만든다.

```typescript
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHome, run, setup, testHome } from './helpers.js'
import { getThreadForUi, listThreads } from '../src/core/queries.js'
import { openDatabase } from '../src/store/db.js'
import { resolveDbPath } from '../src/core/context.js'

beforeEach(async () => {
  await setup()
})

async function seedTwoThreads(): Promise<void> {
  expect(
    (await run(['send', '--from', 'claude', '--to', 'codex', '--subject', '첫번째', '--body', '알파 본문', '--json'])).code,
  ).toBe(0)
  expect((await run(['reply', 'M-001', '--as', 'codex', '--body', '알파 답장', '--json'])).code).toBe(0)
  expect(
    (await run(['send', '--from', 'dane', '--to', 'grok', '--subject', '두번째', '--body', '베타 본문', '--json'])).code,
  ).toBe(0)
  expect((await run(['reply', 'M-003', '--as', 'grok', '--body', '베타 답장', '--json'])).code).toBe(0)
}

function openTestDb(): DatabaseSync {
  return openDatabase(resolveDbPath({ TWIT_HOME: testHome() }))
}

describe('관찰자 조회', () => {
  it('대화를 마지막 seq 역순으로 나열하고 최초 제목·미리보기를 담는다', async () => {
    await seedTwoThreads()
    const db = openTestDb()
    try {
      const threads = listThreads(db)
      expect(threads.map((t) => t.thread_id)).toEqual(['M-003', 'M-001'])
      expect(threads[0]).toMatchObject({
        thread_id: 'M-003',
        subject: '두번째',
        participants: ['dane', 'grok'],
        message_count: 2,
        last_id: 'M-004',
        preview: '베타 답장',
      })
      expect(threads[0]).not.toHaveProperty('body')
      expect(threads[1]).toMatchObject({
        thread_id: 'M-001',
        subject: '첫번째',
        participants: ['claude', 'codex'],
        message_count: 2,
        last_id: 'M-002',
        preview: '알파 답장',
      })
      expect(typeof threads[0].last_at).toBe('string')
    } finally {
      db.close()
    }
  })

  it('대화 ID와 속한 메시지 ID로 같은 본문 목록을 오래된 순으로 돌려준다', async () => {
    await seedTwoThreads()
    const db = openTestDb()
    try {
      const viaOrigin = getThreadForUi(db, 'M-001')
      const viaReply = getThreadForUi(db, 'M-002')
      expect(viaOrigin?.thread_id).toBe('M-001')
      expect(viaReply?.thread_id).toBe('M-001')
      expect(viaOrigin?.subject).toBe('첫번째')
      expect(viaOrigin?.participants).toEqual(['claude', 'codex'])
      expect(viaOrigin?.messages.map((m) => m.id)).toEqual(['M-001', 'M-002'])
      expect(viaOrigin?.messages[0]).toMatchObject({
        sender: 'claude',
        recipient: 'codex',
        body: '알파 본문',
        read: false,
        archived: false,
      })
      expect(viaOrigin?.messages[0]).not.toHaveProperty('preview')
      expect(viaOrigin?.messages).toEqual(viaReply?.messages)
    } finally {
      db.close()
    }
  })

  it('없는 ID는 undefined다', async () => {
    await seedTwoThreads()
    const db = openTestDb()
    try {
      expect(getThreadForUi(db, 'M-999')).toBeUndefined()
    } finally {
      db.close()
    }
  })

  it('수신자 read 이후 표시는 바뀌고 조회만으로는 receipts가 불변이다', async () => {
    await seedTwoThreads()
    const snapshot = (db: DatabaseSync) =>
      db.prepare('SELECT message_id, read_at, archived FROM receipts ORDER BY message_id').all()

    const beforeDb = openTestDb()
    let before: unknown
    try {
      before = snapshot(beforeDb)
      expect(getThreadForUi(beforeDb, 'M-001')?.messages[0]?.read).toBe(false)
    } finally {
      beforeDb.close()
    }

    expect((await run(['read', 'M-001', '--as', 'codex', '--json'])).code).toBe(0)

    const afterRead = openTestDb()
    try {
      expect(getThreadForUi(afterRead, 'M-001')?.messages[0]?.read).toBe(true)
    } finally {
      afterRead.close()
    }

    const probe = openTestDb()
    let mid: unknown
    try {
      mid = snapshot(probe)
      getThreadForUi(probe, 'M-001')
      listThreads(probe)
      expect(snapshot(probe)).toEqual(mid)
    } finally {
      probe.close()
    }

    expect(mid).not.toEqual(before)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/ui.test.ts
```

Expected: FAIL — `listThreads` / `getThreadForUi` export 없음.

- [ ] **Step 3: Write minimal implementation**

`src/core/queries.ts` 하단에 추가한다. 기존 `preview`, `threadMessages`, `MessageRow`를 재사용한다. `getMessage`는 `mailbox.ts`에서 가져온다.

```typescript
import { getMessage } from './mailbox.js'

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
```

`queries.ts` 상단에 `getMessage` 임포트가 순환이 되면(`mailbox.ts`가 `queries.ts`를 임포트하지 않음 — 확인됨) 그대로 둔다. 순환이 생기면 `toObserverMessage`/`getThreadForUi`만 `src/core/observer.ts`로 옮기고 테스트 임포트를 맞춘다.

- [ ] **Step 4: Run tests and make sure they pass**

```bash
npx vitest run test/ui.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/queries.ts test/ui.test.ts
git commit -m "$(cat <<'EOF'
# feat : 관찰자 대화 목록·상세 조회

UI가 --as 권한 투영 없이 thread_id 기준으로 전체 대화를 읽는다.
EOF
)"
```

---

### Task 2: HTTP 서버

**Files:**
- Create: `src/ui/server.ts`
- Create: `src/ui/page.ts` (placeholder HTML, Task 3에서 화면을 채운다)
- Modify: `test/ui.test.ts`

- [ ] **Step 1: Write the failing HTTP tests**

`test/ui.test.ts`에 서버 describe를 추가한다. Task 1의 `seedTwoThreads` / `openTestDb`를 재사용한다.

```typescript
import { startUiServer, type UiServer } from '../src/ui/server.js'

async function withServer(
  fn: (server: UiServer, db: DatabaseSync) => Promise<void>,
): Promise<void> {
  const db = openTestDb()
  const server = await startUiServer(db)
  try {
    await fn(server, db)
  } finally {
    await server.close()
    db.close()
  }
}

describe('UI HTTP', () => {
  it('GET /api/threads가 마지막 seq 역순 목록을 돌려준다', async () => {
    await seedTwoThreads()
    await withServer(async (server) => {
      const res = await fetch(`${server.url}/api/threads`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/application\/json/)
      const body = (await res.json()) as { threads: { thread_id: string; body?: string }[] }
      expect(body.threads.map((t) => t.thread_id)).toEqual(['M-003', 'M-001'])
      expect(body.threads[0]).not.toHaveProperty('body')
    })
  })

  it('GET /api/threads/:id 는 대화 ID와 답장 ID가 같다', async () => {
    await seedTwoThreads()
    await withServer(async (server) => {
      const a = await fetch(`${server.url}/api/threads/M-001`)
      const b = await fetch(`${server.url}/api/threads/M-002`)
      expect(a.status).toBe(200)
      const da = (await a.json()) as { thread_id: string; messages: { id: string; body: string }[] }
      const db = (await b.json()) as { thread_id: string; messages: { id: string }[] }
      expect(da.thread_id).toBe('M-001')
      expect(da.messages.map((m) => m.id)).toEqual(['M-001', 'M-002'])
      expect(da.messages[0].body).toBe('알파 본문')
      expect(db.messages.map((m) => m.id)).toEqual(da.messages.map((m) => m.id))
    })
  })

  it('없는 대화는 404, POST는 405다', async () => {
    await seedTwoThreads()
    await withServer(async (server) => {
      const missing = await fetch(`${server.url}/api/threads/M-999`)
      expect(missing.status).toBe(404)
      expect(await missing.json()).toEqual({ error: 'NOT_FOUND' })

      const posted = await fetch(`${server.url}/api/threads`, { method: 'POST' })
      expect(posted.status).toBe(405)
      expect(await posted.json()).toEqual({ error: 'METHOD_NOT_ALLOWED' })
    })
  })

  it('GET만으로는 receipts가 바뀌지 않는다', async () => {
    await seedTwoThreads()
    await withServer(async (server, db) => {
      const snap = () =>
        db.prepare('SELECT message_id, read_at, archived FROM receipts ORDER BY message_id').all()
      const before = snap()
      await fetch(`${server.url}/api/threads`)
      await fetch(`${server.url}/api/threads/M-001`)
      expect(snap()).toEqual(before)
    })
  })

  it('127.0.0.1에만 붙는다', async () => {
    await withServer(async (server) => {
      expect(server.url.startsWith('http://127.0.0.1:')).toBe(true)
      expect(typeof server.port).toBe('number')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/ui.test.ts
```

Expected: FAIL — `../src/ui/server.js` 없음.

- [ ] **Step 3: Write minimal server**

`src/ui/page.ts` (자리만):

```typescript
export const PAGE_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>twit</title></head><body><p>twit ui</p></body></html>`
```

`src/ui/server.ts`:

```typescript
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { DatabaseSync } from 'node:sqlite'
import { getThreadForUi, listThreads } from '../core/queries.js'
import { PAGE_HTML } from './page.js'

export interface UiServer {
  url: string
  port: number
  close(): Promise<void>
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function handle(db: DatabaseSync, req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const method = req.method ?? 'GET'
  const api = url.pathname === '/api/threads' || url.pathname.startsWith('/api/threads/')

  if (api && method !== 'GET') {
    sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' })
    return
  }

  if (method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(PAGE_HTML)
    return
  }

  if (method === 'GET' && url.pathname === '/api/threads') {
    sendJson(res, 200, { threads: listThreads(db) })
    return
  }

  const match = url.pathname.match(/^\/api\/threads\/([^/]+)$/)
  if (method === 'GET' && match?.[1]) {
    const thread = getThreadForUi(db, decodeURIComponent(match[1]))
    if (!thread) {
      sendJson(res, 404, { error: 'NOT_FOUND' })
      return
    }
    sendJson(res, 200, thread)
    return
  }

  sendJson(res, 404, { error: 'NOT_FOUND' })
}

export function startUiServer(db: DatabaseSync): Promise<UiServer> {
  const server = createServer((req, res) => {
    handle(db, req, res)
  })
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('error', onError)
      reject(err)
    }
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError)
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        server.close()
        reject(new Error('UI 서버 주소를 확인하지 못했습니다'))
        return
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        port: addr.port,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()))
          }),
      })
    })
  })
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run test/ui.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/server.ts src/ui/page.ts test/ui.test.ts
git commit -m "$(cat <<'EOF'
# feat : twit ui 로컬 HTTP 조회 API

127.0.0.1에서 대화 목록·상세 GET만 제공하고 쓰기는 없다.
EOF
)"
```

---

### Task 3: 메일함 HTML

**Files:**
- Modify: `src/ui/page.ts`
- Modify: `test/ui.test.ts`

- [ ] **Step 1: Write the failing page tests**

```typescript
describe('UI 페이지', () => {
  it('GET / 은 HTML이고 메시지 필드를 innerHTML에 넣지 않는다', async () => {
    await withServer(async (server) => {
      const res = await fetch(server.url + '/')
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/text\/html/)
      const html = await res.text()
      expect(html).toContain('textContent')
      expect(html).not.toMatch(/innerHTML\s*=/)
      expect(html).toContain('새로고침')
      expect(html).toContain('id="thread-list"')
      expect(html).toContain('id="thread-view"')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/ui.test.ts
```

Expected: FAIL — placeholder HTML에 `새로고침` / `textContent` 없음.

- [ ] **Step 3: Replace `PAGE_HTML`**

명세 3장과 초안 `.superpowers/brainstorm/42090-1789740323/mail-ui.html`을 따른다. `src/ui/page.ts`의 `PAGE_HTML`은 아래를 모두 만족하는 한 문자열이다.

필수 DOM:

- 왼쪽 `#thread-list`, 오른쪽 `#thread-view`
- `#refresh` 버튼 텍스트 `새로고침`
- `#thread-count` — 빈 메일함이면 `대화 0`
- `#thread-header` — 제목, `M-030 → M-056` 형태의 ID 범위, 참여자
- `#thread-messages` — 오래된 순 카드

동작:

- 첫 로드: `GET /api/threads` 후 첫 대화(가장 최근)를 연다. 없으면 오른쪽 안내
- 목록 클릭: `GET /api/threads/:id`
- 새로고침: 목록과 열려 있는 `thread_id` 상세를 다시 가져온다. 그 ID가 목록에 없으면 첫 대화
- 제목·이름·미리보기·본문·ID는 `textContent` 또는 `createTextNode`만. `innerHTML` / `insertAdjacentHTML` 금지
- 본문: CSS `white-space: pre-wrap`
- 카드: `발신자 → 수신자`, ID, 시각, 수신자 `미읽음`/`보관` 표시
- 의존성·마크다운 렌더·검색 없음

스크립트 골격:

```javascript
function setText(el, value) { el.textContent = value ?? '' }

async function loadList() {
  const data = await fetch('/api/threads').then((r) => r.json())
  setText(threadCount, '대화 ' + data.threads.length)
  renderList(data.threads)
  if (selectedId && data.threads.some((t) => t.thread_id === selectedId)) {
    await loadThread(selectedId)
  } else if (data.threads[0]) {
    await loadThread(data.threads[0].thread_id)
  } else {
    showEmpty()
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run test/ui.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/page.ts test/ui.test.ts
git commit -m "$(cat <<'EOF'
# feat : twit ui 메일함 화면

대화 목록과 스레드를 textContent로만 그린다.
EOF
)"
```

---

### Task 4: `twit ui` 명령

**Files:**
- Create: `src/commands/ui.ts`
- Modify: `src/main.ts`
- Modify: `src/commands/contacts.ts`
- Modify: `test/ui.test.ts`

성공 경로는 SIGINT까지 대기한다. **`run(['ui'])`를 테스트에서 호출하지 않는다.** hang 난다. `--as` 거절은 `runCli`로, 주소록 생략·브라우저 실패는 주입 훅이 있는 `runUi`로 검사한다.

- [ ] **Step 1: Write the failing command tests**

```typescript
import { CONTACTS } from './helpers.js'
import { runUi } from '../src/commands/ui.js'

function makeIo(contacts: string | null = CONTACTS) {
  const out: string[] = []
  const err: string[] = []
  return {
    io: {
      stdout: (text: string) => out.push(text),
      stderr: (text: string) => err.push(text),
      env: {
        TWIT_HOME: testHome(),
        ...(contacts === null ? {} : { TWIT_CONTACTS: contacts }),
      },
    },
    out,
    err,
  }
}

describe('twit ui 명령', () => {
  it('--as 가 있으면 VALIDATION_ERROR 이고 서버를 열지 않는다', async () => {
    const r = await run(['ui', '--as', 'dane', '--json'])
    expect(r.code).toBe(2)
    expect(r.json?.error?.code).toBe('VALIDATION_ERROR')
    expect(r.json?.error?.message).toMatch(/--as/)
  })

  it('주소록 없이 ui를 연다', async () => {
    await seedTwoThreads()
    const { io, out } = makeIo(null)
    let url = ''
    await runUi(io, { json: true }, {
      openUrl: () => {},
      waitUntilDone: async () => {
        url = (JSON.parse(out.join('')) as { data: { url: string } }).data.url
        const res = await fetch(`${url}/api/threads`)
        expect(res.status).toBe(200)
        expect(((await res.json()) as { threads: unknown[] }).threads).toHaveLength(2)
      },
    })
    expect(url.startsWith('http://127.0.0.1:')).toBe(true)
  })

  it('브라우저 열기 실패는 stderr에 남기고 서버는 유지한다', async () => {
    await seedTwoThreads()
    const { io, err } = makeIo()
    await runUi(io, { json: true }, {
      openUrl: () => {
        throw new Error('no browser')
      },
      waitUntilDone: async () => {},
    })
    expect(err.join('')).toMatch(/warning: 브라우저/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/ui.test.ts
```

Expected: FAIL — unknown command `ui` (종료 코드 2이지만 메시지/코드가 commander 파서 오류). `error.code`가 `VALIDATION_ERROR`가 아니거나 메시지가 `--as`가 아니다.

- [ ] **Step 3: Implement the command**

`src/commands/ui.ts`. `runUi`를 export해서 테스트가 SIGINT 없이 성공 경로를 돈다. `loadContacts`는 호출하지 않는다.

```typescript
import type { Command } from 'commander'
import type { CliIo } from '../core/io.js'
import {
  closeContext,
  loadContext,
  mergeGlobalOptions,
  type GlobalOptions,
} from '../core/context.js'
import { TwitError } from '../core/errors.js'
import { runAction } from '../core/report.js'
import { emitSuccess } from '../output/json.js'
import { startUiServer } from '../ui/server.js'
import { openUrl as openUrlDefault } from '../ui/open.js'

function waitForSignal(): Promise<void> {
  return new Promise((resolve) => {
    const stop = () => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      resolve()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}

export interface UiHooks {
  openUrl?: (url: string) => void
  waitUntilDone?: () => Promise<void>
}

export async function runUi(io: CliIo, g: GlobalOptions, hooks: UiHooks = {}): Promise<void> {
  if (g.as !== undefined) {
    throw new TwitError(
      'VALIDATION_ERROR',
      'ui에는 --as를 쓸 수 없습니다. 관찰자 화면은 전체 대화를 보여 줍니다.',
    )
  }
  const ctx = loadContext(io.env)
  try {
    let server
    try {
      server = await startUiServer(ctx.db)
    } catch (err) {
      throw new TwitError('STORAGE_ERROR', 'UI 서버를 열지 못했습니다', {
        cause: err instanceof Error ? err.message : String(err),
      })
    }
    try {
      emitSuccess(io, g, { url: server.url, port: server.port }, () => server.url)
      try {
        (hooks.openUrl ?? openUrlDefault)(server.url)
      } catch (err) {
        io.stderr(
          `warning: 브라우저를 열지 못했습니다: ${err instanceof Error ? err.message : String(err)}\n`,
        )
      }
      await (hooks.waitUntilDone ?? waitForSignal)()
    } finally {
      await server.close()
    }
  } finally {
    closeContext(ctx)
  }
}

export function registerUiCommand(program: Command, io: CliIo): void {
  const globals = (opts: GlobalOptions): GlobalOptions =>
    mergeGlobalOptions(program.opts() as GlobalOptions, opts)

  program
    .command('ui')
    .description('전체 대화를 읽기 전용 브라우저 화면으로 연다')
    .action(async (opts: GlobalOptions) => {
      const g = globals(opts)
      return runAction(io, g, () => runUi(io, g))
    })
}
```

이 단계는 `src/ui/open.ts`가 아직 없으면 `openUrl`을 같은 파일의 빈 함수로 두지 말고, Task 5와 순서를 맞춘다. **open.ts가 없어 빌드가 깨지면 Task 4 Step 3에서 stub를 만든다:**

```typescript
// src/ui/open.ts — Task 5에서 spawn으로 교체
export function openUrl(_url: string): void {}
```

stub는 `child_process`를 임포트하지 않는다.

`src/main.ts`:

- `registerUiCommand` 임포트·등록
- `.option('--as <이름>', …)` 문구를 `contacts와 send, ui에서는 쓰지 않는다`로 수정

`src/commands/contacts.ts` description:

```
주소록(이름 목록)을 조회합니다. --as 없이 실행할 수 있는 명령이다 (ui도 해당)
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run test/ui.test.ts
```

Expected: PASS. `run(['ui'])`는 호출하지 말 것 — hang.

- [ ] **Step 5: Commit**

```bash
git add src/commands/ui.ts src/commands/contacts.ts src/main.ts src/ui/open.ts test/ui.test.ts
git commit -m "$(cat <<'EOF'
# feat : twit ui 명령

--as 없이 관찰자 화면을 열고, 붙이면 VALIDATION_ERROR다.
EOF
)"
```

---

### Task 5: 브라우저 열기 + child_process 예외

**Files:**
- Modify: `src/ui/open.ts`
- Modify: `test/persistence.test.ts`

- [ ] **Step 1: Write the failing persistence assertion**

`test/persistence.test.ts`의 `src 코드에서 child_process를 쓰지 않는다`를 바꾼다.

```typescript
it('src 코드에서 child_process를 쓰는 파일은 ui/open.ts 뿐이다', async () => {
  // walk 로직은 기존과 동일
  const users = files
    .filter((file) => readFileSync(file, 'utf8').includes('child_process'))
    .map((file) => path.relative(srcDir, file))
    .sort()
  expect(users).toEqual(['ui/open.ts'])
})
```

- [ ] **Step 2: Run that test to verify it fails**

```bash
npx vitest run test/persistence.test.ts
```

Expected: FAIL — `users`가 `[]` (stub에는 child_process가 없음).

- [ ] **Step 3: Implement openUrl**

`src/ui/open.ts`:

```typescript
import { spawn } from 'node:child_process'

export function openUrl(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open'
  const child = spawn(command, [url], { stdio: 'ignore', detached: true })
  child.unref()
  child.on('error', () => {
    // 비동기 실패는 명령을 죽이지 않는다. 동기 throw만 commands/ui.ts가 stderr로 받는다.
  })
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run test/persistence.test.ts test/ui.test.ts
```

Expected: PASS. fs-boundary 테스트는 여전히 `core/body.ts`, `store/db.ts`만 `node:fs`를 쓴다.

- [ ] **Step 5: Commit**

```bash
git add src/ui/open.ts test/persistence.test.ts
git commit -m "$(cat <<'EOF'
# feat : twit ui 기본 브라우저 열기

src에서 child_process는 ui/open.ts만 허용한다.
EOF
)"
```

---

### Task 6: 문서와 가이드 테스트

**Files:**
- Modify: `docs/03-v2-mail-inbox-design.md`
- Modify: `docs/04-v2-implementation-design.md`
- Modify: `docs/05-agent-usage-guide.md`
- Modify: `docs/README.md`
- Modify: `README.md`
- Modify: `test/docs.test.ts`

- [ ] **Step 1: Write the failing docs tests**

`test/docs.test.ts`에 추가:

```typescript
it('사람은 twit ui로 전체를 보고 에이전트는 쓰지 않는다고 안내한다', () => {
  expect(GUIDE).toContain('twit ui')
  expect(GUIDE).toMatch(/에이전트는.*쓰지/)
  expect(ROOT_README).toContain('twit ui')
})
```

기존 「주소록이 없으면 모든 명령」을 검사하는 테스트는 없다. 05 본문만 고친다.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/docs.test.ts
```

Expected: FAIL — 05/README에 `twit ui` 없음.

- [ ] **Step 3: Update documents**

**`docs/03-v2-mail-inbox-design.md`**

- 4장 「주소록이 설정되지 않았거나 비어 있으면 모든 명령을 오류로 거절」→ `contacts`와 `--as`/`--from`/`--to`가 필요한 명령은 거절. `twit ui`는 주소록 없이 연다.
- 5장 머리 「`send` 외의 명령은 `--as`」→ `contacts`와 `ui`는 `--as` 없음. `send`는 `--from`/`--to`. 나머지 메일함 명령은 `--as`.
- 9장 포함에 `- 로컬 읽기 전용 화면 \`twit ui\`` 추가.
- 9장 제외의 「웹 UI, 원격 서버, 여러 머신 지원」→ 「원격 웹 UI·상시 서버, 여러 머신 지원」.
- 10장 체크박스 추가 (구현 후 `[x]`):
  - 관찰자 UI가 전체 대화를 보여 주고 GET이 읽음을 바꾸지 않는다.
  - `twit ui --as`는 거절된다.

**`docs/04-v2-implementation-design.md`**

- 2장 구조에 `commands/ui.ts`, `ui/server.ts`, `ui/page.ts`, `ui/open.ts`.
- 「파일 시스템 접근은 body.ts와 db.ts」유지. `child_process`는 `ui/open.ts`만.
- 4장 `--as`: contacts와 ui는 제외. ui에 `--as`를 붙이면 `VALIDATION_ERROR`. ui는 `TWIT_CONTACTS` 불필요.
- 「`--as` 없이 실행할 수 있는 유일한 명령」→ `contacts`와 `ui`.
- 전역 옵션 설명에 ui 추가.

**`docs/05-agent-usage-guide.md`**

- 2장 「주소록이 없으면 모든 명령」→ `ui` 예외를 한 문장으로.
- 새 절 (에이전트 지침 붙여넣기 블록에는 넣지 않는다):

```markdown
## N. 사람용 관찰 화면

사람은 `twit ui`로 메일함 전체 대화를 읽기 전용으로 볼 수 있다. 읽음·보관·답장은 하지 않는다.
에이전트는 `twit ui`를 쓰지 않는다. 조회·답장은 기존처럼 `--as` CLI를 쓴다.
```

**`README.md`** 주요 명령에:

```
twit ui                         # 전체 대화를 읽기 전용으로 브라우저에 연다
```

**`docs/README.md`** 표에:

```
| [읽기 전용 로컬 UI](./superpowers/specs/2026-09-18-read-only-ui-design.md) | 유효 | 사람용 `twit ui` 관찰 화면 |
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run
```

Expected: 기존 102 + 신규 ui/docs 전부 PASS.

수동 확인(구현자):

```bash
TWIT_HOME=$(mktemp -d) TWIT_CONTACTS=dane,claude,codex,opencode,grok \
  node --disable-warning=ExperimentalWarning bin/twit.js send --from claude --to codex --subject "ui" --body "hello"
TWIT_HOME=... TWIT_CONTACTS=... node --disable-warning=ExperimentalWarning bin/twit.js ui
```

브라우저가 열리고 대화가 보이면 Ctrl+C. 실제 `~/.twit`이 아닌 임시 홈을 쓴다.

- [ ] **Step 5: Commit**

```bash
git add docs/03-v2-mail-inbox-design.md docs/04-v2-implementation-design.md docs/05-agent-usage-guide.md docs/README.md README.md test/docs.test.ts
git commit -m "$(cat <<'EOF'
# doc : twit ui 관찰 화면 안내

로컬 읽기 전용 UI를 포함 범위로 두고 에이전트는 CLI를 유지한다.
EOF
)"
```

---

## 구현 시 주의

- `run(['ui'])` 또는 `runCli(['ui'], …)`는 테스트에서 호출하지 않는다. SIGINT를 기다려 hang 난다.
- `withDb`로 UI 핸들러를 감싸지 않는다. 서버가 떠 있는 동안 DB를 닫으면 안 된다.
- `toMeta(row, as)`를 관찰자 API에 재사용하지 않는다. 발신자 쪽 `read: null`이 되어 명세와 어긋난다.
- 페이지에 `innerHTML`을 쓰지 않는다. `insertAdjacentHTML`도 쓰지 않는다.
- 새 npm 패키지를 추가하지 않는다.
- 실제 `~/.twit/twit.db`를 테스트에서 열지 않는다.
