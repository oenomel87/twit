# twit v2 구현 설계 및 실행 계획

- 작성일: 2026-09-09
- 상태: 구현 설계. [03-v2-mail-inbox-design.md](./03-v2-mail-inbox-design.md)의 기능 설계를 전제로 기술 결정, 스키마, 명령별 JSON 구조, 처리 규칙, 테스트, 실행 단계를 확정한다.
- 관계: 02 문서의 기술 결정 중 언어·드라이버·저장 경로·호출자 식별·JSON 봉투·종료 코드 체계를 재사용한다. 작업 관리 스키마와 서비스 계층은 가져오지 않는다.

## 1. 기술 결정

| 항목 | 결정 |
|---|---|
| 언어·런타임 | TypeScript, Node.js 22 이상, ESM |
| SQLite 드라이버 | `better-sqlite3`. `node:sqlite`는 22.x에서 실험 경고를 stderr에 출력하므로 제외 |
| DB 위치 | `$TWIT_HOME/twit.db`, 기본 `~/.twit/twit.db`. 디렉터리가 없으면 첫 실행 시 생성 |
| 호출자 | 전역 옵션 `--actor <id>`, 없으면 환경변수 `TWIT_ACTOR` |
| CLI 파서 | `commander` |
| 테스트 | `vitest` |
| 설치 | `npm install && npm run build && npm link` 로 `twit` 명령 등록 |
| 시각 | ISO 8601 UTC, 밀리초 포함 |
| 대화 ID | 별도 발급하지 않고 최초 메시지 ID를 사용. 최초 메시지는 `thread_id == id` |
| 메시지 ID | `M-001` 형식. 자동 증가 정수 `seq`에서 유도하며 세 자리 이상 0 채움 |

런타임 의존성은 `better-sqlite3`, `commander` 둘이다. 개발 의존성은 `typescript`, `vitest`, `tsx`, `@types/node`, `@types/better-sqlite3`다.

## 2. 프로젝트 구조

```text
twit/
  package.json              "bin": { "twit": "./dist/main.js" }, "type": "module"
  tsconfig.json
  src/
    main.ts                 commander 루트, 전역 옵션, 종료 코드 매핑, 오류 출력
    commands/
      contacts.ts           contacts add / contacts (목록), whoami
      inbox.ts              inbox
      read.ts               read
      send.ts               send, reply
      thread.ts             thread
      sent.ts               sent
      archive.ts            archive, unarchive
    core/
      errors.ts             TwitError, 오류 코드, 종료 코드 표
      context.ts            호출자 해석, DB 열기, 부트스트랩 규칙
      mailbox.ts            send/reply/read/archive 처리 규칙과 트랜잭션
      queries.ts            inbox/sent/thread/read 조회
      idempotency.ts        요청 키 해시와 기록 조회·저장
      body.ts               --body / --body-file / stdin 로딩과 공백 검사
    store/
      db.ts                 연결, PRAGMA, 마이그레이션
      schema.ts             CREATE 문
    output/
      json.ts               봉투 출력
      text.ts               표·상세 렌더링
  docs/
    05-agent-usage-guide.md 에이전트용 사용 가이드
  test/
    helpers.ts              임시 TWIT_HOME, 참여자 등록, 명령 실행 도우미
    *.test.ts
```

파일 시스템 접근은 `body.ts`의 `--body-file` 읽기와 `db.ts`의 DB 파일 열기 두 곳뿐이다. 이 제약은 테스트로 고정한다.

## 3. 스키마

연결 시 `journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON`, `synchronous=NORMAL`.

```sql
CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE contacts (
  id           TEXT PRIMARY KEY,          -- codex-1, opencode-1, dane
  display_name TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE messages (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  id           TEXT NOT NULL UNIQUE,      -- 'M-' || seq (3자리 이상 0 채움)
  thread_id    TEXT NOT NULL,             -- 최초 메시지의 id
  reply_to_id  TEXT REFERENCES messages(id),
  sender_id    TEXT NOT NULL REFERENCES contacts(id),
  recipient_id TEXT NOT NULL REFERENCES contacts(id),
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX messages_recipient ON messages(recipient_id, seq);
CREATE INDEX messages_sender    ON messages(sender_id, seq);
CREATE INDEX messages_thread    ON messages(thread_id, seq);

CREATE TABLE receipts (                    -- 수신 상태, 메시지당 한 행
  message_id TEXT PRIMARY KEY REFERENCES messages(id),
  read_at    TEXT,
  archived   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE requests (                    -- 전송 중복 방지
  sender_id  TEXT NOT NULL,
  request_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  message_id TEXT NOT NULL REFERENCES messages(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (sender_id, request_id)
);
```

- ID 규칙: 쓰기 트랜잭션 안에서 `SELECT COALESCE(MAX(seq), 0) + 1`로 다음 `seq`를 계산하고, `id`를 `M-` + `String(seq).padStart(3, '0')`으로 만들어 `seq`와 `id`를 같은 `INSERT`에 명시한다. `AUTOINCREMENT`는 삭제가 없으므로 계산값과 항상 일치하며, 삽입 후 갱신은 하지 않는다. 트랜잭션이 `BEGIN IMMEDIATE`이므로 두 프로세스가 같은 `seq`를 계산할 수 없다.
- `thread_id`는 `send`에서 자기 `id`, `reply`에서 원문의 `thread_id`다.
- 정렬은 항상 `seq`다. `created_at`이 같아도 순서가 결정된다.
- 수정·삭제 SQL은 `receipts`의 `read_at`, `archived` 갱신 외에 존재하지 않는다.

## 4. 호출자와 참여자

```sh
twit contacts add codex-1 --name "Codex 1"
twit contacts add dane --name "Dane"
twit contacts
twit whoami
```

- `contacts add`는 참여자가 하나도 없을 때 호출자 없이 실행할 수 있다. 참여자가 하나라도 있으면 다른 명령과 같이 호출자를 요구한다. 첫 사용 시 사람이 자신과 에이전트를 순서대로 등록하면 된다.
- 참여자 ID 형식은 `^[a-z0-9][a-z0-9._-]{0,63}$`이다. 중복 등록은 `VALIDATION_ERROR`.
- 호출자 해석: `--actor` → `TWIT_ACTOR`. 둘 다 없거나 미등록이면 `ACTOR_NOT_CONFIGURED`. 메시지에 설정 방법과 `twit contacts`를 안내한다.
- 삭제와 비활성화는 두지 않는다. 메시지 이력이 참조하기 때문이다.

## 5. 명령과 JSON 구조

전역 옵션: `--json`, `--actor <id>`. 모든 성공 응답은 아래 봉투를 따른다.

```json
{ "schema_version": 1, "ok": true, "data": { }, "error": null }
{ "schema_version": 1, "ok": false, "data": null,
  "error": { "code": "FORBIDDEN", "message": "...", "details": { } } }
```

공통 개체:

```json
"MessageSummary": {
  "id": "M-003", "thread_id": "M-001", "reply_to_id": "M-002",
  "sender": "opencode-1", "recipient": "codex-1",
  "subject": "재시도 로직 구현 요청", "created_at": "2026-09-09T07:00:00.000Z",
  "read": true, "archived": false, "body_length": 1234
}
"Message": MessageSummary + { "body": "..." }
```

`read`, `archived`는 호출자가 수신자인 메시지에만 값이 있고, 그 외에는 `null`이다. 보낸함과 발신자의 `read`에서 상대 상태를 노출하지 않기 위해서다.

| 명령 | 옵션 | `data` |
|---|---|---|
| `whoami` | | `{ "id", "display_name" }` |
| `contacts` | | `{ "contacts": [{ "id", "display_name" }] }` |
| `contacts add <id>` | `--name` 필수 | `{ "id", "display_name" }` |
| `inbox` | `--unread` / `--archived` / `--all` 중 최대 하나 | `{ "messages": [MessageSummary] }` 최신순 |
| `read <id>` | | `{ "message": Message, "marked_read": true|false }` |
| `send` | `--to`, `--subject`, `--body`/`--body-file`, `--request-id` | `{ "message": Message, "replayed": false }` |
| `reply <id>` | `--body`/`--body-file`, `--request-id` | `{ "message": Message, "replayed": false }` |
| `thread <id>` | `--no-body` | `{ "thread_id", "participants": [a, b], "messages": [Message 또는 MessageSummary] }` 오래된 순 |
| `sent` | | `{ "messages": [MessageSummary] }` 최신순, `read`·`archived`는 `null` |
| `archive <id>` | | `{ "id", "archived": true }` |
| `unarchive <id>` | | `{ "id", "archived": false }` |

`marked_read`는 이번 호출로 읽음이 새로 기록되었을 때만 `true`다. `replayed`는 요청 키 재전송으로 기존 메시지를 돌려줄 때 `true`다.

## 6. 처리 규칙

### 6.1 권한

| 명령 | 허용 호출자 |
|---|---|
| `read`, `thread` | 해당 메시지(대화)의 발신자 또는 수신자 |
| `reply` | 원문의 발신자 또는 수신자 |
| `archive`, `unarchive` | 해당 메시지의 수신자 |
| `send` | 등록된 모든 참여자. 수신자도 등록되어 있어야 함 |

권한 위반은 `FORBIDDEN`이다. 존재하지 않는 메시지는 `NOT_FOUND`이며, 권한 검사보다 먼저 판정한다. 로컬 신뢰 환경이므로 존재 여부를 숨기지 않는다.

### 6.2 전송과 답장

`send`와 `reply`는 같은 함수를 거친다. 입력 준비는 트랜잭션 밖에서 끝내고 DB 처리만 `BEGIN IMMEDIATE` 트랜잭션 하나로 묶는다. `--body-file -`로 표준 입력을 기다리는 동안 다른 프로세스의 쓰기를 막지 않기 위해서다.

트랜잭션 밖:

1. 본문과 제목을 로드하고 공백만 있으면 `VALIDATION_ERROR`. 제목은 앞뒤 공백을 제거하고 본문은 그대로 둔다. 표준 입력은 여기서 끝까지 읽는다.
2. `--request-id`가 있으면 해시를 계산한다. 해시 입력은 `send`가 `{ command: "send", to, subject, body }`, `reply`가 `{ command: "reply", reply_to_id, body }`를 정규화한 JSON의 sha256이다. 답장 제목은 원문에서 오고 원문은 불변이므로 해시에 넣지 않는다. 원문 ID가 들어가므로 같은 키로 다른 메시지에 답장하면 충돌로 판정한다.

트랜잭션 안:

3. `--request-id`가 있으면 `requests`에서 `(호출자, request_id)`를 조회한다. 있고 해시가 같으면 해당 메시지를 `replayed: true`로 반환하고 끝낸다. 해시가 다르면 `REQUEST_ID_CONFLICT`.
4. `reply`는 원문을 읽고 권한을 검사한 뒤 수신자를 정한다. 호출자가 원문 수신자면 원문 발신자에게, 호출자가 원문 발신자면 원문 수신자에게 보낸다. 자기에게 보낸 메시지는 둘 다 자신이다. 제목과 `thread_id`는 원문에서 가져온다.
5. `send`는 `--to`가 등록된 참여자인지 확인한다.
6. 다음 `seq`와 `id`를 계산해 `messages`에 삽입하고, `receipts`에 `read_at NULL`, `archived 0`으로 삽입한다.
7. `--request-id`가 있으면 `requests`에 기록한다.
8. 커밋한다. 어느 단계에서든 실패하면 전부 롤백된다.

같은 키로 두 프로세스가 동시에 전송하면 트랜잭션이 직렬화되어 뒤의 것이 3단계에서 기존 메시지를 `replayed: true`로 받는다. 메시지는 하나만 생긴다.

### 6.3 읽기와 보관

- `read`: 권한 검사 후 호출자가 수신자이면 `UPDATE receipts SET read_at = ? WHERE message_id = ? AND read_at IS NULL`을 실행한다. `marked_read`는 사전에 조회한 `read_at`이 아니라 이 조건부 `UPDATE`가 실제로 변경한 행 수(`changes`)가 1일 때만 `true`다. 같은 메시지를 두 프로세스가 동시에 읽으면 한 호출만 `true`를 받고 첫 번째 시각만 남는다. 발신자가 읽으면 `UPDATE`를 실행하지 않는다. 응답의 `message.read`는 `UPDATE` 이후 다시 조회한 값이다.
- `archive` / `unarchive`: `UPDATE receipts SET archived = ? WHERE message_id = ?`. `read_at`은 건드리지 않는다. 이미 같은 상태여도 성공이다.
- `inbox`, `sent`, `thread`는 `SELECT`만 실행한다.

### 6.4 조회 필터

| 명령·옵션 | 조건 |
|---|---|
| `inbox` | `recipient_id = me AND archived = 0` |
| `inbox --unread` | 위 조건 + `read_at IS NULL` |
| `inbox --archived` | `recipient_id = me AND archived = 1` |
| `inbox --all` | `recipient_id = me` |
| `sent` | `sender_id = me` |
| `thread <id>` | `thread_id = (해당 메시지의 thread_id)` |

옵션 두 개 이상 조합은 `VALIDATION_ERROR`다.

## 7. 오류와 종료 코드

| 코드 | 종료 코드 | 상황 |
|---|---|---|
| `ACTOR_NOT_CONFIGURED` | 8 | 호출자 미설정 또는 미등록 |
| `NOT_FOUND` | 3 | 참여자 또는 메시지 없음 |
| `FORBIDDEN` | 4 | 발신자·수신자가 아닌 호출자 |
| `VALIDATION_ERROR` | 2 | 필수값 누락, 공백 본문, 옵션 조합 오류, ID 형식 오류, 중복 등록 |
| `REQUEST_ID_CONFLICT` | 5 | 같은 요청 키에 다른 내용 |
| `STORAGE_ERROR` | 6 | DB 열기 실패, 마이그레이션 실패, SQLite 오류 |
| 내부 오류 | 1 | 위에 해당하지 않는 예외 |

- `--json`이면 오류도 stdout에 봉투로 출력한다. 아니면 stderr에 `error: <code>: <message>` 한 줄이다.
- 진단·경고는 항상 stderr다. stdout에는 결과만 쓴다.
- `main.ts`가 모든 예외를 잡아 종료 코드로 바꾼다. 스택 추적은 `TWIT_DEBUG=1`일 때만 stderr에 출력한다.

## 8. 텍스트 출력

- `inbox`, `sent`: 한 메시지당 한 줄. 열은 ID, 읽음 표시(`*` 미읽음, 공백 읽음), 상대 참여자, 시각, 제목 순이며 제목이 마지막이다. `--all`은 보관 표시 열 `[A]`를 추가한다.
- `read`: 헤더 블록(ID, From, To, Subject, Date, Reply-To, Thread)과 빈 줄, 본문 원문.
- `thread`: 메시지마다 헤더 블록과 본문을 구분선으로 나눈다. `--no-body`는 한 메시지당 한 줄로 ID, 방향(`→`), 시각, 답장 대상, 읽음 표시, 본문 길이를 표시한다.
- 빈 목록은 `(no messages)` 한 줄이다.
- Markdown을 해석하지 않고 시각을 로컬로 변환하지 않는다.

## 9. 에이전트용 사용 가이드

`docs/05-agent-usage-guide.md`를 코드와 함께 작성한다. 각 에이전트의 지침 파일에 그대로 붙여 넣을 수 있는 짧은 절과 사람이 읽는 설명을 나눈다.

포함 내용:

1. 설정: `TWIT_ACTOR` 지정, `twit whoami`로 확인, `twit contacts`로 상대 확인.
2. 세션 규칙: 세션 시작 시와 작업을 마치기 전에 `twit inbox --json`을 실행한다. 기본 인박스는 읽었지만 보관하지 않은 메시지도 포함하므로 이전 세션에서 읽고 처리하지 못한 요청이 함께 보인다. 읽지 않은 메시지는 `read`로 읽고, 필요한 경우 `reply`하며, 처리가 끝난 메시지는 `archive`로 보관해 인박스를 비운다. `--unread`는 이미 처리 중인 세션에서 새로 온 것만 볼 때 쓴다. 인박스에 남아 있는 메시지는 아직 처리하지 않은 것으로 간주한다. 이는 참여자 사이의 사용 관례이며, 03 문서 원칙대로 twit이 보관을 완료로 해석하지는 않는다.
3. 요청 작성: 작업 위치 절대 경로, 요청 내용, 원하는 답장 형식을 본문에 적는다. 03 문서 6장의 예시를 옮긴다.
4. 긴 문서·폴더 전달: 03 문서 6장의 표와 폴더 예시, 본문 저장과 경로 참조의 시점 차이.
5. 긴 대화 확인: `thread --no-body`로 새 답장을 찾고 필요한 메시지만 `read`.
6. 결과 답장: 변경 요약, 저장소·커밋, 실행한 검증, 남은 사항.
7. 중복 방지: 응답 유실이 우려되는 자동화 호출에서는 `--request-id`를 처음부터 지정한다.
8. 한계: 전송은 상대를 깨우지 않는다. 같은 ID를 여러 세션이 쓰면 요청을 중복 수행할 수 있다.

에이전트별 적용 위치는 Claude Code `CLAUDE.md`, Codex `AGENTS.md`, OpenCode 지침 파일이며 가이드에 예시 문단을 둔다.

## 10. 테스트 계획

`test/helpers.ts`가 임시 디렉터리를 `TWIT_HOME`으로 만들고 `dane`, `codex-1`, `opencode-1`을 등록한다. `run(actor, argv)`가 CLI 진입 함수를 프로세스 내에서 호출하고 stdout을 가로채 JSON 봉투와 종료 코드를 돌려준다. 프로세스 재시작이나 동시 실행이 필요한 검증만 `child_process`로 실제 `dist/main.js`를 실행한다.

03 문서 10장의 완료 조건과 테스트 파일 대응:

| 완료 조건 | 테스트 |
|---|---|
| A가 보낸 메시지가 B 인박스에 읽지 않음으로 표시 | `send.test.ts` |
| 기본 인박스에 읽은 메시지 포함, 보관 제외 | `inbox.test.ts` |
| 인박스·대화 조회로 읽음 상태 불변 | `inbox.test.ts`, `thread.test.ts` |
| `thread --no-body`가 본문 없이 길이를 반환하고 상태 불변 | `thread.test.ts` |
| 수신자 `read` 시 해당 메시지만 읽음 | `read.test.ts` |
| 받은·보낸 메시지 답장이 올바른 상대에게 전송 | `reply.test.ts` |
| 여러 답장이 같은 대화에 연결, 직접 답장 대상 구분 | `reply.test.ts` |
| 보관한 대화의 새 답장이 기본 인박스에 표시 | `archive.test.ts` |
| 보관·복원이 읽음 상태와 원문 불변 | `archive.test.ts` |
| 제삼자가 읽거나 답장 불가 | `permission.test.ts` |
| 같은 요청 키 재전송은 중복 없음, 다른 내용은 거절 | `idempotency.test.ts` |
| 두 프로세스의 동시 전송·동일 요청 키 동시 전송·동시 읽기 | `concurrency.test.ts` (실제 프로세스 두 개를 동시에 실행. 동시 전송은 메시지 두 개와 서로 다른 ID, 동일 키는 메시지 한 개와 `replayed` 한 번, 동시 읽기는 `marked_read: true` 한 번) |
| 프로세스 종료 후 유지 | `persistence.test.ts` (실제 프로세스 두 번 실행) |
| 저장 실패 시 부분 저장 없음 | `atomicity.test.ts` (`requests` 삽입 실패를 유도하고 `messages`·`receipts` 행 수 확인) |
| `--body-file` 본문이 원본 파일 변경 후에도 유지 | `send.test.ts` |
| 경로가 포함된 메시지 읽기가 파일을 열지 않음 | `fs-boundary.test.ts` (`fs` 사용처가 `body.ts`, `db.ts`뿐임을 소스 검사) |
| 사용 가이드에 전달 예시와 시점 차이 안내 | `docs.test.ts` (05 문서에 필수 문구 존재 확인) |
| 전송·답장으로 프로세스 미실행 | `fs-boundary.test.ts` (`child_process` 사용처가 테스트 외에 없음) |
| 실제 두 CLI 에이전트가 요청→질문→답변→결과 수행 | 수동 검증. 결과를 05 문서 끝에 기록 |

## 11. 실행 계획

각 단계는 테스트 통과로 끝나며 다음 단계의 전제다. 단계마다 확인 명령을 적었다.

### 1단계: 골격, DB, 참여자

산출물:

- `package.json`, `tsconfig.json`, `vitest` 설정, `npm run build`, `npm test`
- `store/db.ts`, `store/schema.ts`: DB 열기, PRAGMA, 마이그레이션
- `core/errors.ts`, `core/context.ts`, `output/json.ts`, `main.ts`
- `contacts add`, `contacts`, `whoami`
- `test/helpers.ts`, `contacts.test.ts`

확인:

```sh
npm run build && npm link
TWIT_HOME=/tmp/twit-demo twit contacts add dane --name Dane
TWIT_HOME=/tmp/twit-demo TWIT_ACTOR=dane twit whoami --json
TWIT_HOME=/tmp/twit-demo twit whoami          # 종료 코드 8
```

### 2단계: 전송, 읽기, 인박스, 보낸함

산출물:

- `core/body.ts`, `core/mailbox.ts`의 `send`, `read`, `core/queries.ts`의 `inbox`, `sent`
- `output/text.ts`의 목록·상세 렌더링
- `send.test.ts`, `read.test.ts`, `inbox.test.ts`, `permission.test.ts`

확인: 두 참여자로 보내고, 수신자 인박스에 `*`로 표시되는지, `read` 후 표시가 사라지는지, 제삼자 `read`가 종료 코드 4인지 확인.

### 3단계: 답장, 대화, 보관

산출물:

- `reply`, `thread`(`--no-body` 포함), `archive`, `unarchive`
- `reply.test.ts`, `thread.test.ts`, `archive.test.ts`

확인: 받은 메시지와 보낸 메시지 각각에 답장해 상대가 맞는지, `thread --no-body`의 `body_length`가 본문 길이와 같은지, 보관 후 새 답장이 인박스에 뜨는지 확인.

### 4단계: 중복 방지, 원자성, 경계 검사

산출물:

- `core/idempotency.ts`, `send`·`reply`의 `--request-id`
- `idempotency.test.ts`, `atomicity.test.ts`, `concurrency.test.ts`, `persistence.test.ts`, `fs-boundary.test.ts`

확인: 같은 키 재전송이 같은 메시지 ID를 `replayed: true`로 돌려주고, 다른 본문이면 종료 코드 5인지 확인. 두 프로세스를 동시에 띄운 전송·읽기에서 메시지 수와 `marked_read` 횟수가 기대와 같은지 확인.

### 5단계: 사용 가이드와 실제 연동 검증

산출물:

- `docs/05-agent-usage-guide.md`, `docs.test.ts`
- README 색인 갱신, 03 문서 10장 체크박스 갱신

확인: 서로 다른 두 에이전트 CLI에 `TWIT_ACTOR`와 세션 규칙을 설정하고, 사람이 각 에이전트에 조회를 지시하며 요청→질문→답변→결과 흐름을 수행한다. 각 단계에서 사용한 명령과 결과를 05 문서 끝에 기록한다.

### 단계 밖의 규칙

- 각 단계에서 `npm test`와 `npm run build`가 통과해야 다음 단계로 간다.
- 03 문서와 어긋나는 결정이 필요하면 코드보다 문서를 먼저 고친다.
- 파일 시스템 접근은 `body.ts`, `db.ts` 밖에 추가하지 않는다.

## 12. 제외

- 참여자 삭제·비활성화·이름 변경
- 메시지 수정·삭제, 대화 단위 보관
- 페이지 처리, 검색, 날짜 필터. 목록이 커져 문제가 되면 `--limit`부터 추가한다.
- 상대의 읽음 여부 노출. 03 문서 5.6이 제외했으며, 실제 사용에서 필요해지면 03을 먼저 고친다.
- 본문 크기 제한
