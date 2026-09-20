# twit v2 구현 설계 및 실행 계획

- 작성일: 2026-09-09
- 상태: 구현 설계. [03-v2-mail-inbox-design.md](./03-v2-mail-inbox-design.md)의 기능 설계를 전제로 기술 결정, 스키마, 명령별 JSON 구조, 처리 규칙, 테스트, 실행 단계를 확정한다. 1차 구현은 완료됐고, 2026-09-10에 2차 개선(환경변수 주소록, 미리보기, 일괄 읽기, JSON 봉투 버전 2)을 반영했다. 2차 개선 부분은 13장의 실행 계획을 따른다.
- 관계: 02 문서의 기술 결정 중 언어·드라이버·저장 경로·호출자 식별·JSON 봉투·종료 코드 체계를 재사용한다. 작업 관리 스키마와 서비스 계층은 가져오지 않는다.

## 1. 기술 결정

| 항목 | 결정 |
|---|---|
| 언어·런타임 | TypeScript, Node.js 24 이상, ESM. 2차 개선에서 22에서 24로 올렸다 |
| SQLite 드라이버 | Node 내장 `node:sqlite`(`DatabaseSync`). 1차 구현의 `better-sqlite3`는 네이티브 바이너리가 Node 주 버전에 묶여 fnm으로 버전이 바뀔 때마다 재빌드가 필요했고, 실제로 다른 에이전트가 다른 Node로 빌드해 CLI가 열리지 않는 일이 있었다. `node:sqlite`는 24.x에서 아직 실험 기능 경고를 내므로 진입점에서 그 경고만 끈다. API가 바뀌면 `store/db.ts` 한 곳만 고친다 |
| DB 위치 | `$TWIT_HOME/twit.db`, 기본 `~/.twit/twit.db`. 디렉터리가 없으면 첫 실행 시 생성 |
| 주소록 | 환경변수 `TWIT_CONTACTS`의 쉼표 구분 이름 목록. DB에 참여자를 저장하지 않는다 |
| 이름 지정 | `send`는 `--from`·`--to`, `contacts`와 `ui`는 `--as` 없음, 그 외 명령은 전역 옵션 `--as`. 자기 이름 환경변수는 두지 않는다 |
| Node 버전 | `.node-version`으로 24 고정, `engines`는 `>=24`. 네이티브 모듈이 없으므로 버전을 바꿔도 재빌드는 없다 |
| JSON 봉투 | `schema_version: 2`. 1과의 차이는 5장 참조 |
| CLI 파서 | `commander` |
| 테스트 | `vitest` |
| 설치 | `npm install && npm run build && npm link` 로 `twit` 명령 등록. 진입점은 `bin/twit.js`이므로 실행에는 항상 사전 빌드가 필요하다. `prepare` 스크립트가 `npm link`·`npm install` 때 빌드를 실행한다 |
| 시각 | ISO 8601 UTC, 밀리초 포함 |
| 대화 ID | 별도 발급하지 않고 최초 메시지 ID를 사용. 최초 메시지는 `thread_id == id` |
| 메시지 ID | `M-001` 형식. 자동 증가 정수 `seq`에서 유도하며 세 자리 이상 0 채움 |

런타임 의존성은 `commander` 하나다. 개발 의존성은 `typescript`, `vitest`, `tsx`, `@types/node`(24 이상)다. `@types/better-sqlite3`는 제거한다.

## 2. 프로젝트 구조

```text
twit/
  package.json              "bin": { "twit": "./bin/twit.js" }, "type": "module"
  bin/
    twit.js                 실행 진입점. shebang `#!/usr/bin/env -S node --disable-warning=ExperimentalWarning`으로 node:sqlite 경고만 끄고 dist/main.js의 runCli를 호출한다
  tsconfig.json
  src/
    main.ts                 commander 루트, 전역 옵션, 종료 코드 매핑, 오류 출력
    commands/
      contacts.ts           contacts (주소록 목록)
      inbox.ts              inbox
      read.ts               read (여러 ID, --unread)
      send.ts               send, reply
      thread.ts             thread
      sent.ts               sent
      archive.ts            archive, unarchive
      ui.ts                 ui (읽기 전용 관찰 화면)
    core/
      errors.ts             TwitError, 오류 코드, 종료 코드 표
      context.ts            주소록 해석, --as/--from/--to 이름 검증, DB 열기
      mailbox.ts            send/reply/read/archive 처리 규칙과 트랜잭션
      queries.ts            inbox/sent/thread 조회, 목록·상세 변환
      preview.ts            본문 미리보기 순수 함수
      idempotency.ts        요청 키 해시와 기록 조회·저장
      body.ts               --body / --body-file / stdin 로딩과 공백 검사
    store/
      db.ts                 node:sqlite 연결, PRAGMA, 마이그레이션, 트랜잭션 도우미. SQLite API를 쓰는 유일한 파일
      schema.ts             CREATE 문
    output/
      json.ts               봉투 출력
      text.ts               표·상세 렌더링
    ui/
      server.ts             로컬 HTTP GET 서버 (127.0.0.1)
      page.ts               HTML 페이지 문자열
      open.ts               기본 브라우저 열기. src에서 child_process를 쓰는 유일한 파일
  docs/
    05-agent-usage-guide.md 에이전트용 사용 가이드
  test/
    helpers.ts              임시 TWIT_HOME, TWIT_CONTACTS 설정, 명령 실행 도우미
    *.test.ts
```

파일 시스템 접근은 `body.ts`의 `--body-file` 읽기와 `db.ts`의 DB 파일 열기 두 곳뿐이다. `child_process`는 `ui/open.ts`만 사용한다. 이 제약은 테스트로 고정한다.

## 3. 스키마

연결 시 `journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON`, `synchronous=NORMAL`을 `PRAGMA` 문으로 설정한다. `node:sqlite`에는 트랜잭션 도우미가 없으므로 `db.ts`가 `BEGIN IMMEDIATE` → 함수 실행 → `COMMIT`, 예외 시 `ROLLBACK`을 수행하는 `immediate(fn)`을 제공하고, 모든 쓰기 명령은 이를 통해서만 트랜잭션을 연다. SQLite 오류는 `node:sqlite`가 던지는 오류의 `code`가 `ERR_SQLITE_ERROR`인지로 판별해 `STORAGE_ERROR`로 바꾼다.

```sql
CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE messages (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  id           TEXT NOT NULL UNIQUE,      -- 'M-' || seq (3자리 이상 0 채움)
  thread_id    TEXT NOT NULL,             -- 최초 메시지의 id
  reply_to_id  TEXT REFERENCES messages(id),
  sender_id    TEXT NOT NULL,             -- 주소록 이름 문자열. FK 없음
  recipient_id TEXT NOT NULL,
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

- 마이그레이션 1(1차 구현)은 `contacts` 테이블과 `messages`의 발신자·수신자 외래키를 가지고 있었다. 마이그레이션 2는 SQLite 공식 절차(테이블 재생성)로 외래키를 없애고 `contacts`를 삭제한다. 기존 메시지의 `claude-1` 같은 이름은 그대로 남는다.
  - 순서: 트랜잭션 시작 전에 `PRAGMA foreign_keys=OFF` → `BEGIN IMMEDIATE` → 새 `messages_new` 생성 → `INSERT INTO messages_new SELECT …` → 기존 `messages` 삭제 → `messages_new`를 `messages`로 이름 변경 → 인덱스 재생성 → `DROP TABLE contacts` → `PRAGMA foreign_key_check` → 결과가 비어 있으면 `COMMIT`, 아니면 `ROLLBACK` → 성공·실패 모두 `PRAGMA foreign_keys=ON`.
  - 보존 검증: `messages`의 `seq`·`id`·`thread_id`·`reply_to_id`·이름·본문, `receipts`의 `read_at`·`archived`, `requests`의 키·해시·메시지 참조가 전환 전후로 같아야 한다. 전환 후 기존 요청 키 재전송은 새 메시지를 만들지 않고 `replayed: true`를 돌려준다.
  - 실패 내성: 중간 단계에서 실패하면 원래 스키마와 데이터가 남고, 다시 실행하면 정상 전환된다. `migration.test.ts`가 중간 실패를 유도해 확인한다.
  - 참고: https://www.sqlite.org/lang_altertable.html#making_other_kinds_of_table_schema_changes
- ID 규칙: 쓰기 트랜잭션 안에서 `SELECT COALESCE(MAX(seq), 0) + 1`로 다음 `seq`를 계산하고, `id`를 `M-` + `String(seq).padStart(3, '0')`으로 만들어 `seq`와 `id`를 같은 `INSERT`에 명시한다. `AUTOINCREMENT`는 삭제가 없으므로 계산값과 항상 일치하며, 삽입 후 갱신은 하지 않는다. 트랜잭션이 `BEGIN IMMEDIATE`이므로 두 프로세스가 같은 `seq`를 계산할 수 없다.
- `thread_id`는 `send`에서 자기 `id`, `reply`에서 원문의 `thread_id`다.
- 정렬은 항상 `seq`다. `created_at`이 같아도 순서가 결정된다.
- 수정·삭제 SQL은 `receipts`의 `read_at`, `archived` 갱신 외에 존재하지 않는다.

## 4. 주소록과 이름

```sh
export TWIT_CONTACTS="dane,claude,codex,opencode,grok"
twit contacts
twit inbox --as claude
twit send --from claude --to codex --subject "..." --body-file request.md
```

- 주소록 해석: `TWIT_CONTACTS`를 쉼표로 나누고 각 항목의 앞뒤 공백을 제거하며 빈 항목은 버린다. 환경변수가 없거나 결과가 비어 있으면 `ACTOR_NOT_CONFIGURED`로 거절하고 설정 예시를 안내한다. `contacts`도 이때는 빈 목록 대신 같은 오류를 낸다. 설정이 없다는 사실을 숨기지 않기 위해서다. `ui`는 주소록이 없어도 된다.
- 이름 형식은 `^[a-z0-9][a-z0-9._-]{0,63}$`이다. 형식에 맞지 않거나 중복된 항목이 목록에 있으면 `VALIDATION_ERROR`로 거절하고 어느 항목인지 알려 준다.
- `--as`: `contacts`와 `ui`를 제외한 모든 명령에 필수인 전역 옵션이다. `send`는 `--as` 대신 `--from`을 받으며 둘을 함께 주면 `VALIDATION_ERROR`다. `ui`에 `--as`를 붙이면 `VALIDATION_ERROR`다. `contacts`·`send`·`ui`가 아닌 명령에서 `--as`가 없으면 `ACTOR_NOT_CONFIGURED`이며 메시지에 "자기 이름을 `--as <이름>`으로 지정하세요"와 현재 주소록을 담는다. `ui`는 `TWIT_CONTACTS`가 없어도 된다.
- `--from`, `--to`: `send`에 필수다.
- `--as`, `--from`, `--to`의 값이 주소록에 없으면 `NOT_FOUND`로 거절하고 현재 주소록을 `details.contacts`에 담는다.
- 자기 이름 환경변수(`TWIT_ACTOR`)와 참여자 등록 명령, `whoami`는 없앤다. 1차 구현의 `--actor`는 `--as`로 이름을 바꾼다.
- `contacts`는 주소록을 순서대로 보여 준다. `--as` 없이 실행할 수 있는 명령은 `contacts`와 `ui`다. `contacts`는 에이전트가 자기 이름을 고르기 전에 호출하기 때문이다.

## 5. 명령과 JSON 구조

전역 옵션: `--json`, `--as <이름>`(`contacts`와 `send`, `ui`는 받지 않는다). 모든 성공 응답은 아래 봉투를 따른다.

```json
{ "schema_version": 2, "ok": true, "data": { }, "error": null }
{ "schema_version": 2, "ok": false, "data": null,
  "error": { "code": "FORBIDDEN", "message": "...", "details": { } } }
```

`schema_version` 1(1차 구현)과의 차이는 `read`의 `data`가 단건·다건 모두 `messages` 배열인 것, 목록 항목에 `preview`가 있는 것, `whoami`와 `contacts add`가 없는 것, `contacts`의 `data`가 이름 배열인 것이다. 파서가 버전을 확인해 분기할 수 있도록 값을 올린다.

공통 개체:

```json
"MessageMeta": {
  "id": "M-003", "thread_id": "M-001", "reply_to_id": "M-002",
  "sender": "opencode", "recipient": "codex",
  "subject": "재시도 로직 구현 요청", "created_at": "2026-09-09T07:00:00.000Z",
  "read": true, "archived": false, "body_length": 1234
}
"MessageSummary": MessageMeta + { "preview": "작업 위치: /workspace/example" }
"Message": MessageMeta + { "body": "..." }
```

`MessageSummary`는 목록(`inbox`, `sent`, `thread --no-body`)에만 쓰고 `Message`는 본문을 돌려주는 응답(`read`, `send`, `reply`, `thread`)에 쓴다. `preview`는 목록에만 있고 `body`가 있는 응답에는 없다. 구현에서는 공통 메타데이터 변환과 두 확장을 분리해 서로 새지 않게 한다.

`preview` 규칙: 본문을 LF 또는 CRLF로 나눠 공백이 아닌 첫 줄을 고르고 앞뒤 공백을 제거한다. 코드 포인트 80개를 넘으면 앞 80개 뒤에 `…`를 붙이고, 정확히 80개면 그대로 둔다. Markdown 기호는 해석하지 않는다.

`read`, `archived`는 호출자가 수신자인 메시지에만 값이 있고, 그 외에는 `null`이다. 보낸함과 발신자의 `read`에서 상대 상태를 노출하지 않기 위해서다.

| 명령 | 옵션 | `data` |
|---|---|---|
| `contacts` | `--as` 불필요 | `{ "contacts": ["dane", "claude", "codex", "opencode", "grok"] }` 주소록 순서 |
| `inbox` | `--as`, `--unread` / `--archived` / `--all` 중 최대 하나 | `{ "messages": [MessageSummary] }` 최신순 |
| `read [ids...]` | `--as`, `--unread` (ID와 함께 불가) | `{ "messages": [Message + { "marked_read": true\|false }] }` ID는 지정 순서, `--unread`는 오래된 순 |
| `send` | `--from`, `--to`, `--subject`, `--body`/`--body-file`, `--request-id` | `{ "message": Message, "replayed": false }` |
| `reply <id>` | `--as`, `--body`/`--body-file`, `--request-id` | `{ "message": Message, "replayed": false }` |
| `thread <id>` | `--as`, `--no-body` | `{ "thread_id", "participants": [a, b], "messages": [Message 또는 MessageSummary] }` 오래된 순. `participants`는 최초 메시지의 발신자·수신자 순 |
| `sent` | `--as` | `{ "messages": [MessageSummary] }` 최신순, `read`·`archived`는 `null` |
| `archive <id>` | `--as` | `{ "id", "archived": true }` |
| `unarchive <id>` | `--as` | `{ "id", "archived": false }` |
| `ui` | `--as` 불가. `TWIT_CONTACTS` 불필요 | `{ "url", "port" }` 출력 후 프로세스 대기 |

`marked_read`는 이번 호출로 읽음이 새로 기록되었을 때만 `true`다. `replayed`는 요청 키 재전송으로 기존 메시지를 돌려줄 때 `true`다. `read`는 단건도 `messages` 배열 한 개로 돌려준다.

## 6. 처리 규칙

### 6.1 권한

| 명령 | 허용되는 `--as` 이름 |
|---|---|
| `read`, `thread` | 해당 메시지(대화)의 발신자 또는 수신자 |
| `reply` | 원문의 발신자 또는 수신자 |
| `archive`, `unarchive` | 해당 메시지의 수신자 |
| `send` | `--from`, `--to`가 주소록에 있으면 누구나 |

권한 위반은 `FORBIDDEN`이다. 존재하지 않는 메시지는 `NOT_FOUND`이며, 권한 검사보다 먼저 판정한다. 이름이 주소록에 있는지는 4장의 규칙으로 그보다 먼저 검사한다. 로컬 신뢰 환경이므로 존재 여부를 숨기지 않는다.

### 6.2 전송과 답장

`send`와 `reply`는 같은 함수를 거친다. 입력 준비는 트랜잭션 밖에서 끝내고 DB 처리만 `BEGIN IMMEDIATE` 트랜잭션 하나로 묶는다. `--body-file -`로 표준 입력을 기다리는 동안 다른 프로세스의 쓰기를 막지 않기 위해서다.

트랜잭션 밖:

1. 본문과 제목을 로드하고 공백만 있으면 `VALIDATION_ERROR`. 제목은 앞뒤 공백을 제거하고 본문은 그대로 둔다. 표준 입력은 여기서 끝까지 읽는다.
2. `--request-id`가 있으면 해시를 계산한다. 요청 키는 `(발신자, request_id)`로 구분한다. 해시 입력은 `send`가 `{ command: "send", to, subject, body }`, `reply`가 `{ command: "reply", reply_to_id, body }`를 정규화한 JSON의 sha256이다. 답장 제목은 원문에서 오고 원문은 불변이므로 해시에 넣지 않는다. 원문 ID가 들어가므로 같은 키로 다른 메시지에 답장하면 충돌로 판정한다.

트랜잭션 안:

3. `--request-id`가 있으면 `requests`에서 `(호출자, request_id)`를 조회한다. 있고 해시가 같으면 해당 메시지를 `replayed: true`로 반환하고 끝낸다. 해시가 다르면 `REQUEST_ID_CONFLICT`.
4. `reply`는 원문을 읽고 권한을 검사한 뒤 수신자를 정한다. 호출자가 원문 수신자면 원문 발신자에게, 호출자가 원문 발신자면 원문 수신자에게 보낸다. 자기에게 보낸 메시지는 둘 다 자신이다. 제목과 `thread_id`는 원문에서 가져온다.
5. `send`는 4장의 규칙으로 이미 `--from`, `--to`를 검사했으므로 여기서는 추가 검사가 없다. 발신자는 `--from`이다.
6. 다음 `seq`와 `id`를 계산해 `messages`에 삽입하고, `receipts`에 `read_at NULL`, `archived 0`으로 삽입한다.
7. `--request-id`가 있으면 `requests`에 기록한다.
8. 커밋한다. 어느 단계에서든 실패하면 전부 롤백된다.

같은 키로 두 프로세스가 동시에 전송하면 트랜잭션이 직렬화되어 뒤의 것이 3단계에서 기존 메시지를 `replayed: true`로 받는다. 메시지는 하나만 생긴다.

### 6.3 읽기와 보관

- `read`: 전체를 `BEGIN IMMEDIATE` 트랜잭션 하나로 처리한다. 순서는 대상 확정 → 존재·권한 검사 → 조건부 읽음 갱신 → 갱신 후 재조회 → 커밋이다.
  - 대상 확정: ID 목록이면 그 순서대로, 중복이 있으면 `VALIDATION_ERROR`. `--unread`면 `recipient_id = as AND archived = 0 AND read_at IS NULL`을 `seq` 오름차순으로 고른다. ID와 `--unread`를 함께 주거나 둘 다 없으면 `VALIDATION_ERROR`.
  - 검사: 하나라도 없으면 `NOT_FOUND`, 발신자도 수신자도 아니면 `FORBIDDEN`. 어느 경우든 트랜잭션을 롤백해 아무것도 읽음 처리되지 않는다.
  - 갱신: `--as`가 수신자인 메시지마다 `UPDATE receipts SET read_at = ? WHERE message_id = ? AND read_at IS NULL`을 실행한다. `marked_read`는 이 조건부 `UPDATE`가 실제로 변경한 행 수가 1일 때만 `true`다. 발신자로 읽는 메시지는 `UPDATE`를 실행하지 않고 `marked_read: false`다. 중간 `UPDATE`가 SQLite 오류를 내면 전체가 롤백되고 `STORAGE_ERROR`다.
  - 같은 메시지를 두 프로세스가 동시에 읽으면 트랜잭션이 직렬화되어 한 호출만 `true`를 받고 첫 번째 시각만 남는다.
  - 응답의 각 `read`는 갱신 이후 다시 조회한 값이다.
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
| `read --unread` | `recipient_id = me AND archived = 0 AND read_at IS NULL`, `seq` 오름차순 |
| `thread <id>` | `thread_id = (해당 메시지의 thread_id)` |

옵션 두 개 이상 조합은 `VALIDATION_ERROR`다.

## 7. 오류와 종료 코드

| 코드 | 종료 코드 | 상황 |
|---|---|---|
| `ACTOR_NOT_CONFIGURED` | 8 | 주소록 미설정 또는 `--as` 누락 |
| `NOT_FOUND` | 3 | 주소록에 없는 이름 또는 메시지 없음 |
| `FORBIDDEN` | 4 | 발신자·수신자가 아닌 호출자 |
| `VALIDATION_ERROR` | 2 | 필수값 누락, 공백 본문, 옵션 조합 오류, 주소록 항목 형식·중복 오류, `read`의 중복 ID |
| `REQUEST_ID_CONFLICT` | 5 | 같은 요청 키에 다른 내용 |
| `STORAGE_ERROR` | 6 | DB 열기 실패, 마이그레이션 실패, SQLite 오류 |
| 내부 오류 | 1 | 위에 해당하지 않는 예외 |

- `--json`이면 오류도 stdout에 봉투로 출력한다. 아니면 stderr에 `error: <code>: <message>` 한 줄이다.
- 진단·경고는 항상 stderr다. stdout에는 결과만 쓴다.
- `main.ts`가 모든 예외를 잡아 종료 코드로 바꾼다. 스택 추적은 `TWIT_DEBUG=1`일 때만 stderr에 출력한다.

## 8. 텍스트 출력

- `inbox`, `sent`: 한 메시지당 두 줄. 첫 줄의 열은 ID, 읽음 표시(`*` 미읽음, 공백 읽음), 상대 참여자, 시각, 제목 순이며 제목이 마지막이다. 둘째 줄은 두 칸 들여쓴 미리보기다. `--all`은 첫 줄 앞에 보관 표시 `[A]`를 추가한다.
- `read`: 메시지마다 헤더 블록(ID, From, To, Subject, Date, Reply-To, Thread)과 빈 줄, 본문 원문. 여러 건이면 구분선으로 나눈다. 빈 결과는 `(no messages)`.
- `thread`: 메시지마다 헤더 블록과 본문을 구분선으로 나눈다. `--no-body`는 한 메시지당 두 줄로 ID, 방향(`→`), 시각, 답장 대상, 읽음 표시, 본문 길이와 들여쓴 미리보기를 표시한다.
- 빈 목록은 `(no messages)` 한 줄이다.
- Markdown을 해석하지 않고 시각을 로컬로 변환하지 않는다.

## 9. 에이전트용 사용 가이드

`docs/05-agent-usage-guide.md`를 코드와 함께 작성한다. 각 에이전트의 지침 파일에 그대로 붙여 넣을 수 있는 짧은 절과 사람이 읽는 설명을 나눈다.

포함 내용:

1. 설정: 셸 설정의 `TWIT_CONTACTS`, 자기 실행 환경에서 `twit contacts --json`으로 목록 확인, 자기 제품명과 맞는 이름 고르기(없거나 둘 이상이면 사람에게 질문), 사람이 지정한 이름 우선. 환경변수는 프로세스별로 상속되므로 목록을 바꾸면 각 에이전트 환경에서 다시 확인한다.
2. 세션 규칙: 세션 시작 시와 작업을 마치기 전에 `twit inbox --as <이름> --json`을 실행한다. 기본 인박스는 읽었지만 보관하지 않은 메시지도 포함하므로 이전 세션에서 읽고 처리하지 못한 요청이 함께 보인다. 읽지 않은 메시지는 `read`로 읽고, 필요한 경우 `reply`하며, 처리가 끝난 메시지는 `archive`로 보관해 인박스를 비운다. `--unread`는 이미 처리 중인 세션에서 새로 온 것만 볼 때 쓴다. 인박스에 남아 있는 메시지는 아직 처리하지 않은 것으로 간주한다. 이는 참여자 사이의 사용 관례이며, 03 문서 원칙대로 twit이 보관을 완료로 해석하지는 않는다.
3. 요청 작성: 작업 위치 절대 경로, 요청 내용, 원하는 답장 형식을 본문에 적는다. 03 문서 6장의 예시를 옮긴다.
4. 긴 문서·폴더 전달: 03 문서 6장의 표와 폴더 예시, 본문 저장과 경로 참조의 시점 차이.
5. 긴 대화 확인: `thread --no-body`로 새 답장을 찾고 필요한 메시지만 `read`.
6. 결과 답장: 변경 요약, 저장소·커밋, 실행한 검증, 남은 사항.
7. 중복 방지: 응답 유실이 우려되는 자동화 호출에서는 `--request-id`를 처음부터 지정한다.
8. 한계: 전송은 상대를 깨우지 않는다. 같은 ID를 여러 세션이 쓰면 요청을 중복 수행할 수 있다.

에이전트별 적용 위치는 Claude Code `CLAUDE.md`, Codex `AGENTS.md`, OpenCode 지침 파일이며 가이드에 예시 문단을 둔다.

## 10. 테스트 계획

`test/helpers.ts`가 임시 디렉터리를 `TWIT_HOME`으로 만들고 `TWIT_CONTACTS=dane,codex,opencode`를 환경에 넣는다. `run(actor, argv)`가 CLI 진입 함수를 프로세스 내에서 호출하고 stdout을 가로채 JSON 봉투와 종료 코드를 돌려준다. 프로세스 재시작이나 동시 실행이 필요한 검증만 `child_process`로 실제 `dist/main.js`를 실행한다.

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
| 주소록에 없는 이름 거절, 주소록 미설정 안내, 항목 형식·중복 오류 | `contacts.test.ts` |
| 마이그레이션 2 이후 1차 구현의 메시지가 조회됨 | `migration.test.ts` (마이그레이션 1 스키마의 DB 파일을 만들어 열기) |
| 미리보기 규칙 | `preview.test.ts` (선행 빈 줄·공백, 한 줄 본문, 79·80·81자, 한글·이모지, CRLF, Markdown 제목), `inbox.test.ts`·`thread.test.ts` (세 목록에만 있고 본문 응답에는 없음) |
| 여러 ID 읽기 순서, `--unread` 순서와 보관 제외, 빈 결과 | `read.test.ts` |
| 여러 건 읽기의 전부 아니면 전무 | `atomicity.test.ts` (없는 ID·권한 없는 ID 혼합, 두 번째 UPDATE를 실패시키는 트리거) |
| 겹치는 ID를 두 프로세스가 동시에 읽어도 메시지별 `marked_read: true`는 한 번 | `concurrency.test.ts` |
| 프로세스 종료 후 유지 | `persistence.test.ts` (실제 프로세스 두 번 실행) |
| 저장 실패 시 부분 저장 없음 | `atomicity.test.ts` (`requests` 삽입 실패를 유도하고 `messages`·`receipts` 행 수 확인) |
| `--body-file` 본문이 원본 파일 변경 후에도 유지 | `send.test.ts` |
| 경로가 포함된 메시지 읽기가 파일을 열지 않음 | `fs-boundary.test.ts` (`fs` 사용처가 `body.ts`, `db.ts`뿐임을 소스 검사) |
| 사용 가이드에 전달 예시와 시점 차이 안내 | `docs.test.ts` (05 문서에 필수 문구 존재 확인) |
| 전송·답장으로 프로세스 미실행 | `fs-boundary.test.ts` (`child_process` 사용처가 `ui/open.ts`와 테스트 외에 없음) |
| 실제 두 CLI 에이전트가 요청→질문→답변→결과 수행 | 수동 검증. 결과를 05 문서 끝에 기록 |

## 11. 1차 구현 실행 계획 (완료된 과거 기록)

이 장은 2026-09-09에 완료된 1차 구현의 계획이며, 등록제·`--actor`·`whoami` 등 1차 명령을 기준으로 한다. 현재 계획은 13장이다.

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

- 참여자 저장·등록·삭제. 주소록은 환경변수뿐이다
- 역할 별칭, 역할 환경변수, 프로젝트별 주소록, 자기 이름 환경변수
- 메시지 수정·삭제, 대화 단위 보관
- 페이지 처리, 검색, 날짜 필터. 목록이 커져 문제가 되면 `--limit`부터 추가한다.
- 상대의 읽음 여부 노출. 03 문서 5.6이 제외했으며, 실제 사용에서 필요해지면 03을 먼저 고친다.
- 본문 크기 제한

## 13. 2차 개선 실행 계획

03 문서 4장·5장의 2차 개선 부분과 이 문서의 4장, 5장, 6.3, 7장, 8장, 10장을 구현한다. 배경과 결정은 [07-first-use-review.md](./07-first-use-review.md)에 있다. 각 단계는 테스트 통과로 끝난다.

### 1단계: Node 24, node:sqlite, 주소록과 이름 전환

- JSON 봉투 `schema_version`은 응답 구조가 처음 바뀌는 이 단계에서 2로 올린다. 1단계에서 `contacts`의 `data`가 이름 배열로 바뀌기 때문이다. 버전 1에 서로 다른 구조가 섞이지 않게 한다.
- 1단계부터 3단계까지의 중간 상태는 실제 사용자용 CLI(`npm link`)에 적용하지 않는다. 3단계가 끝난 뒤 4단계에서 CLI와 양쪽 스킬을 한 번에 전환한다. 그 전까지 설치된 CLI는 1차(버전 1)로 유지해 메일 왕복이 끊기지 않게 한다.
- `.node-version`을 24로, `package.json`의 `engines`를 `>=24`로 올리고 `better-sqlite3`와 `@types/better-sqlite3`를 제거한다. `@types/node`를 24로 올린다.
- `store/db.ts`를 `node:sqlite`로 다시 쓰고 `immediate(fn)` 트랜잭션 도우미를 둔다. `mailbox.ts`의 `db.transaction(...).immediate()` 호출을 이 도우미로 바꾼다. `withDb`의 오류 판별을 `ERR_SQLITE_ERROR` 기준으로 바꾼다. 테스트에서 DB를 직접 여는 곳(`atomicity.test.ts` 등)도 `node:sqlite`로 바꾼다.
- `bin/twit.js`의 shebang을 `#!/usr/bin/env -S node --disable-warning=ExperimentalWarning`으로 바꾼다. 테스트가 `node bin/twit.js`로 직접 실행하는 곳은 같은 플래그를 인자로 준다.
- `context.ts`: `TWIT_CONTACTS` 해석, 형식·중복 검사, `--as`·`--from`·`--to` 검증. `TWIT_ACTOR`, 등록 조회, 부트스트랩 규칙 제거.
- `main.ts`: 전역 옵션 `--actor`를 `--as`로 변경. `whoami`, `contacts add` 제거. `send`에 `--from` 추가.
- `schema.ts`, `db.ts`: 마이그레이션 2(외래키 없는 `messages` 재생성, `contacts` 삭제).
- README에 Node 24 요구와 `npm install && npm run build && npm link` 설치 절차를 적는다. 재빌드 안내는 필요 없다.
- 테스트: `helpers.ts`를 환경변수 방식으로 바꾸고 기존 테스트를 전부 통과시킨다. `contacts.test.ts` 갱신, `migration.test.ts` 추가.

확인:

```sh
TWIT_HOME=/tmp/twit-demo TWIT_CONTACTS="dane,codex" twit contacts
TWIT_HOME=/tmp/twit-demo TWIT_CONTACTS="dane,codex" twit send --from dane --to codex --subject s --body b
TWIT_HOME=/tmp/twit-demo TWIT_CONTACTS="dane,codex" twit inbox --as codex
TWIT_HOME=/tmp/twit-demo TWIT_CONTACTS="dane,codex" twit inbox --as ghost     # 종료 코드 3, 목록 안내
TWIT_HOME=/tmp/twit-demo twit contacts                                       # 종료 코드 8, 설정 안내
```

### 2단계: 미리보기

- `preview.ts` 순수 함수, `queries.ts`의 메타·목록·상세 변환 분리, `text.ts` 두 줄 출력.
- 테스트: `preview.test.ts`, 세 목록의 JSON·텍스트 일치, 본문 응답에 `preview` 없음.

### 3단계: 일괄 읽기와 JSON 버전 2

- `read.ts`, `mailbox.ts`: 여러 ID와 `--unread`, 트랜잭션 하나, 전부 아니면 전무.
- `json.ts`: 1단계에서 올린 `schema_version` 2 아래에서 단건 `read` 응답을 `messages` 배열로 통일하고 기존 테스트의 참조를 고친다.
- 테스트: `read.test.ts`, `atomicity.test.ts`, `concurrency.test.ts` 추가 항목. 긴 본문 여러 건의 JSON이 파이프에서 온전한지 `persistence.test.ts`에 추가.

### 4단계: 가이드, 스킬, 연동 검증

- 05 가이드 1·2·3·6·7장을 새 명령으로 고친다. 자기 이름 고르기 규칙, `--as`·`--from`·`--to`, `read --unread`, 회신 필요 여부 명시를 넣는다.
- 양쪽 스킬을 새 명령으로 고친다. Claude Code는 `~/.claude/skills/twit`(SKILL.md와 driver.mjs), Codex는 `~/.codex/skills/twit/SKILL.md`다. Codex 스킬의 교체안은 Codex가 작성해 [skill-proposals/codex-twit-SKILL-v2.md](./skill-proposals/codex-twit-SKILL-v2.md)에 보관했다. 스킬은 저장소 밖이므로 변경 내용을 06 로그에 적는다.
- 실제 CLI 설치(`npm link`)와 양쪽 스킬 교체는 같은 시점에 한다. 어느 하나만 바꾸면 메일 왕복이 막힌다.
- 06 로그에 2차 개선 절을 추가한다.
- 사람이 두 세션에 각각 조회를 지시해 미리보기 확인 → 일괄 읽기 → 답장 → 보관 왕복을 한 차례 수행하고 05 가이드 10장에 기록한 뒤 03 문서 10장의 새 체크박스를 채운다.
