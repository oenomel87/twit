# twit 구현 설계 및 구현 계획

> **대체됨 (2026-09-09)**: 이 문서는 v1 작업 관리 모델 설계다. [03-v2-mail-inbox-design.md](./03-v2-mail-inbox-design.md)와 [04-v2-implementation-design.md](./04-v2-implementation-design.md)가 대체했으며 구현하지 않는다.

- 작성일: 2026-09-09
- 상태: 구현 설계. [01-cli-collaboration-design.md](./01-cli-collaboration-design.md)의 기능 설계를 전제로 기술 결정, 데이터 스키마, 명령 명세, 처리 규칙, 구현 단계를 확정한다.
- 범위: 로컬 단일 머신에서 동작하는 twit CLI 초기 버전

## 1. 확정된 기술 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| 언어·런타임 | TypeScript, Node.js 22 이상 | 개발 속도, 워크스페이스 내 다른 프로젝트와 일관성 |
| 저장소 | SQLite 단일 파일, `better-sqlite3` | 동기 API로 트랜잭션 처리가 단순함. `node:sqlite`는 22.x에서 실험 경고를 stderr에 출력하므로 제외 |
| DB 위치 | `$TWIT_HOME/twit.db`, 기본 `~/.twit/twit.db` | 여러 프로젝트의 에이전트가 하나의 작업 목록을 공유 |
| 호출자 식별 | 환경변수 `TWIT_ACTOR`, 전역 옵션 `--actor`로 일회성 덮어쓰기 | 같은 머신의 여러 에이전트 세션을 서로 다른 참여자로 구분 |
| 서버·여러 머신 | 지원하지 않음. 저장소 추상화도 두지 않음 | 로컬 전용으로 확정 |
| CLI 파서 | `commander` | 중첩 하위 명령과 도움말 생성 |
| 테스트 | `vitest` | 임시 DB를 사용한 통합 테스트 위주 |
| 배포 | `npm link` 또는 `npm install -g .` 로 `twit` 실행 파일 등록 | 로컬 전용이므로 패키지 배포 불필요 |
| 시각 | ISO 8601 UTC 문자열 | 정렬과 JSON 호환 |

의존성은 `better-sqlite3`, `commander` 두 개로 제한한다. 개발 의존성은 `typescript`, `vitest`, `@types/node`, `@types/better-sqlite3`, `tsx`다.

## 2. 프로젝트 구조

```text
twit/
  package.json            bin: { "twit": "dist/cli/main.js" }
  tsconfig.json
  src/
    cli/
      main.ts             commander 루트, 전역 옵션(--json, --actor), 종료 코드 매핑
      commands/
        actor.ts          actor add/list/deactivate, whoami
        task.ts           task create/list/show/assign/claim/status/resume/submit/update/reassign/cancel
        comment.ts        comment add/list
        question.ts       question ask/answer/resolve
        review.ts         review approve/request-changes
        inbox.ts          inbox list
        history.ts        history list
      output.ts           텍스트 표 렌더링, JSON 봉투 출력
      input.ts            --file, --body-file 로딩, JSON 검증
    core/
      errors.ts           TwitError와 오류 코드
      ids.ts              접두사별 순번 ID 발급
      state.ts            상태·전환 표, 전환 검증 함수
      context.ts          호출자 해석, DB 열기
      services/
        actor.ts
        task.ts           등록·조회·배정·인수·상태·재배정·취소·내용 변경
        comment.ts
        question.ts
        submission.ts     제출·검토
        history.ts
      mutation.ts         트랜잭션·리비전 검사·멱등성·이력 기록을 묶는 공통 실행기
    store/
      db.ts               연결, PRAGMA, 마이그레이션 적용
      migrations/
        001_initial.ts
      repo/               테이블별 접근 함수(순수 SQL, 규칙 없음)
    types.ts              도메인 타입, JSON 출력 타입
  test/
    helpers.ts            임시 TWIT_HOME, 참여자 사전 등록, CLI 호출 도우미
    *.test.ts
```

규칙 검증은 전부 `core/services`에서 수행한다. `cli/`는 입력 파싱과 출력만 담당하고, `store/repo`는 SQL만 담당한다.

## 3. 데이터 스키마

모든 테이블은 `001_initial` 마이그레이션으로 생성한다. 연결 시 `journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON`, `synchronous=NORMAL`을 설정한다.

```sql
CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);

CREATE TABLE id_counters (prefix TEXT PRIMARY KEY, next INTEGER NOT NULL);

CREATE TABLE actors (
  id            TEXT PRIMARY KEY,           -- 예: codex-1, dane
  display_name  TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('human','agent')),
  cli           TEXT,                       -- 참고용: codex, opencode, claude 등
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE tasks (
  id                    TEXT PRIMARY KEY,   -- T-001
  title                 TEXT NOT NULL,
  purpose               TEXT NOT NULL,
  body                  TEXT NOT NULL,
  done_criteria         TEXT NOT NULL,
  requester_id          TEXT NOT NULL REFERENCES actors(id),
  assignee_id           TEXT REFERENCES actors(id),
  reviewer_id           TEXT REFERENCES actors(id),
  status                TEXT NOT NULL,
  content_version       INTEGER NOT NULL DEFAULT 1,
  revision              INTEGER NOT NULL DEFAULT 1,
  current_attempt_id    TEXT,               -- attempts.id, 순환 참조라 FK 없음
  current_submission_id TEXT,
  parent_id             TEXT REFERENCES tasks(id),
  block_reason          TEXT,               -- blocked 상태의 사유
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX tasks_assignee ON tasks(assignee_id, status);
CREATE INDEX tasks_reviewer ON tasks(reviewer_id, status);
CREATE INDEX tasks_requester ON tasks(requester_id, status);

CREATE TABLE task_relations (
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  related_id  TEXT NOT NULL REFERENCES tasks(id),
  PRIMARY KEY (task_id, related_id)
);

CREATE TABLE task_refs (                     -- 참고 자료
  id        INTEGER PRIMARY KEY,
  task_id   TEXT NOT NULL REFERENCES tasks(id),
  kind      TEXT NOT NULL CHECK (kind IN ('path','url','commit','other')),
  value     TEXT NOT NULL,
  note      TEXT
);

CREATE TABLE attempts (
  id               TEXT PRIMARY KEY,        -- A-001
  task_id          TEXT NOT NULL REFERENCES tasks(id),
  assignee_id      TEXT NOT NULL REFERENCES actors(id),
  content_version  INTEGER NOT NULL,
  started_at       TEXT NOT NULL,
  ended_at         TEXT,
  end_reason       TEXT                     -- submitted_approved, changes_requested, reassigned, cancelled, content_changed
);
CREATE INDEX attempts_task ON attempts(task_id);

CREATE TABLE comments (
  id               TEXT PRIMARY KEY,        -- C-001
  task_id          TEXT NOT NULL REFERENCES tasks(id),
  author_id        TEXT NOT NULL REFERENCES actors(id),
  type             TEXT NOT NULL CHECK (type IN ('progress','question','answer','submission','review','system')),
  body             TEXT NOT NULL,
  content_version  INTEGER NOT NULL,
  attempt_id       TEXT,
  question_id      TEXT,
  submission_id    TEXT,
  review_id        TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX comments_task ON comments(task_id, id);

CREATE TABLE questions (
  id               TEXT PRIMARY KEY,        -- Q-001
  task_id          TEXT NOT NULL REFERENCES tasks(id),
  author_id        TEXT NOT NULL REFERENCES actors(id),
  recipient_id     TEXT NOT NULL REFERENCES actors(id),
  blocking         INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL CHECK (status IN ('open','answered','resolved')),
  content_version  INTEGER NOT NULL,
  question_comment_id TEXT NOT NULL REFERENCES comments(id),
  answer_comment_id   TEXT REFERENCES comments(id),
  answered_by      TEXT REFERENCES actors(id),
  resolved_at      TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX questions_recipient ON questions(recipient_id, status);
CREATE INDEX questions_author ON questions(author_id, status);

CREATE TABLE submissions (
  id                   TEXT PRIMARY KEY,    -- S-001
  task_id              TEXT NOT NULL REFERENCES tasks(id),
  author_id            TEXT NOT NULL REFERENCES actors(id),
  content_version      INTEGER NOT NULL,
  attempt_id           TEXT NOT NULL REFERENCES attempts(id),
  summary              TEXT NOT NULL,
  verification         TEXT NOT NULL,
  remaining_issues     TEXT,
  accepted_as_current  INTEGER NOT NULL,
  created_at           TEXT NOT NULL
);

CREATE TABLE submission_artifacts (
  id             INTEGER PRIMARY KEY,
  submission_id  TEXT NOT NULL REFERENCES submissions(id),
  kind           TEXT NOT NULL CHECK (kind IN ('path','url','commit','other')),
  value          TEXT NOT NULL,
  note           TEXT
);

CREATE TABLE reviews (
  id             TEXT PRIMARY KEY,          -- R-001
  submission_id  TEXT NOT NULL REFERENCES submissions(id),
  task_id        TEXT NOT NULL REFERENCES tasks(id),
  author_id      TEXT NOT NULL REFERENCES actors(id),
  verdict        TEXT NOT NULL CHECK (verdict IN ('approved','changes_requested')),
  body           TEXT NOT NULL,
  self_review    INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);

CREATE TABLE history (
  id          INTEGER PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  actor_id    TEXT NOT NULL REFERENCES actors(id),
  action      TEXT NOT NULL,                -- task.create, task.claim, question.ask …
  before_json TEXT,                         -- 변경 전 주요 필드
  after_json  TEXT,                         -- 변경 후 주요 필드
  request_id  TEXT,
  revision    INTEGER NOT NULL,             -- 이 변경 이후의 리비전
  created_at  TEXT NOT NULL
);
CREATE INDEX history_task ON history(task_id, id);

CREATE TABLE requests (                      -- 멱등성 기록
  actor_id     TEXT NOT NULL,
  request_id   TEXT NOT NULL,
  input_hash   TEXT NOT NULL,               -- 명령명 + 정규화된 입력의 sha256
  result_json  TEXT NOT NULL,               -- 최초 성공 응답의 data
  created_at   TEXT NOT NULL,
  PRIMARY KEY (actor_id, request_id)
);
```

### ID 규칙

`id_counters`에서 접두사별 순번을 트랜잭션 안에서 증가시키고 `T-001`처럼 세 자리 이상으로 0을 채운다. 접두사는 `T` 작업, `A` 시도, `C` 댓글, `Q` 질문, `S` 제출, `R` 검토다. 정렬은 ID 문자열이 아니라 생성 시각 또는 rowid를 사용한다.

## 4. 호출자와 참여자

```sh
twit actor add codex-1 --name "Codex 1" --kind agent --cli codex
twit actor add dane --name "Dane" --kind human
twit actor list [--all]
twit actor deactivate codex-1
twit whoami
```

- `actor add`는 호출자 설정 없이도 실행 가능한 유일한 변경 명령이다. 최초 참여자를 등록하기 위해서다. 등록된 참여자가 하나라도 있으면 호출자 설정을 요구한다.
- 호출자 해석 순서: `--actor` 옵션, `TWIT_ACTOR` 환경변수. 둘 다 없으면 `ACTOR_NOT_CONFIGURED`.
- 해석된 ID가 등록되지 않았거나 비활성이면 `ACTOR_NOT_CONFIGURED`이며 메시지에 ID를 포함한다.
- `actor list`는 기본으로 활성 참여자만 표시한다.
- 비활성 참여자는 새 담당자·검토자·질문 수신자로 지정할 수 없다. 기존 배정은 유지된다.

## 5. 공통 변경 처리 규칙

모든 변경 명령은 `core/mutation.ts`의 실행기를 거친다. 처리 순서는 다음과 같고 전체가 `BEGIN IMMEDIATE` 트랜잭션 하나다.

1. `requests`에서 `(호출자, request_id)`를 조회한다. 있고 `input_hash`가 같으면 저장된 `result_json`을 그대로 반환하며 `replayed: true`를 붙인다. 있고 해시가 다르면 `REQUEST_ID_CONFLICT`.
2. 대상 작업을 읽는다. 없으면 `NOT_FOUND`.
3. `--expect-revision`과 현재 리비전을 비교한다. 다르면 `REVISION_CONFLICT`. 오류 상세에 현재 리비전을 포함하고 `task show` 재조회를 안내한다.
4. 서비스가 권한, 상태 전환, 시도·내용 버전을 검증한다. 실패 시 `FORBIDDEN`, `INVALID_TRANSITION`, `STALE_ATTEMPT`, `VALIDATION_ERROR` 중 하나.
5. 변경을 적용하고 `revision`을 1 증가시키며 `updated_at`을 갱신한다.
6. `history`에 한 건 이상 기록한다. 필요하면 `comments`에 `system` 유형을 남긴다.
7. `requests`에 결과를 저장한다.
8. 커밋한다. 오류가 나면 전부 롤백되고 아무 기록도 남지 않는다.

`input_hash`는 명령 이름과 옵션·본문 파일 내용을 정규화한 JSON의 sha256이다. 파일 경로가 아니라 파일 내용을 해시하므로 같은 경로에 다른 내용을 넣어 재전송하면 충돌로 판정한다.

`--request-id`는 모든 변경 명령의 필수 옵션이다. 생략 시 `VALIDATION_ERROR`로 거절하며 자동 생성하지 않는다. 자동 생성하면 재시도 시 중복 기록이 생기기 때문이다.

`--expect-revision`은 기존 작업을 변경하는 모든 명령에 필수다. `task create`와 `actor` 명령만 예외다.

동시 인수는 `BEGIN IMMEDIATE`가 쓰기 잠금을 직렬화하므로 뒤에 온 요청이 3단계에서 `REVISION_CONFLICT`로 실패한다. 별도 잠금 테이블은 두지 않는다.

## 6. 상태 전환 표

`core/state.ts`는 `(현재 상태, 동작) → 다음 상태`를 하나의 표로 가진다. 표에 없는 조합은 `INVALID_TRANSITION`이다.

| 동작 | 허용 현재 상태 | 다음 상태 | 호출자 | 추가 조건과 부수 효과 |
|---|---|---|---|---|
| `task.assign` | draft | queued | 요청자 | 담당자 활성. 검토자 함께 지정 가능 |
| `task.claim` | queued, changes_requested | in_progress | 현재 담당자 | 새 시도 생성, `current_attempt_id` 갱신 |
| `question.ask --blocking` | in_progress, waiting_answer | waiting_answer | 현재 담당자 | 질문 등록. 이미 대기 중이면 상태 유지 |
| `task.resume` | waiting_answer | in_progress | 현재 담당자 | 현재 내용 버전의 차단 질문이 모두 `resolved` |
| `task.status set blocked` | in_progress, waiting_answer | blocked | 현재 담당자 | `--reason` 필수, `block_reason` 저장 |
| `task.resume` | blocked | in_progress | 현재 담당자 | `--reason` 필수, 현재 내용 버전의 미해결 차단 질문 없음, `block_reason` 제거 |
| `task.submit` | in_progress | in_review | 현재 담당자 | 현재 시도·내용 버전 일치 시 `current_submission_id` 갱신 |
| `review.approve` | in_review | done | 검토자 또는 검토자 없을 때 요청자 | 현재 제출 대상. 시도 종료 `submitted_approved` |
| `review.request-changes` | in_review | changes_requested | 위와 같음 | 시도 종료 `changes_requested`. 담당자가 다시 `claim` |
| `task.cancel` | done, cancelled 외 전부 | cancelled | 요청자 | `--reason` 필수. 시도 종료 `cancelled`, 현재 제출 미채택 처리 |
| `task.reassign` | draft 제외 미종료 | queued | 요청자 | `--assignee --reason` 필수. 시도 종료 `reassigned`, 현재 제출 미채택 처리. 같은 담당자 허용 |
| `task.update` (내용) | 미종료 | 담당자 있으면 queued, 없으면 draft | 요청자 | `content_version` 증가. 시도 종료 `content_changed`, 현재 제출 미채택 처리 |
| `task.update` (검토자만) | 미종료 | in_review였다면 queued, 아니면 상태 유지 | 요청자 | 내용 버전 유지. 현재 제출 있으면 미채택 처리하고 시도 종료 `content_changed` |
| `task.update` (참고자료·관련작업만) | 미종료 | 상태 유지 | 요청자 | 내용 버전·시도·제출 유지 |

`task status set`은 `blocked`만 받는다. 다른 값은 `VALIDATION_ERROR`로 거절하고 전용 명령을 안내한다.

`done`, `cancelled`에서는 어떤 변경 명령도 받지 않는다. 댓글 추가도 거절한다.

## 7. 명령 명세

전역 옵션: `--json`, `--actor <id>`. 변경 명령 공통 옵션: `--request-id <id>`, 기존 작업 변경 시 `--expect-revision <n>`.

본문 입력은 `--body-file <path>` 또는 `--body <text>` 중 하나다. 두 개를 함께 주면 `VALIDATION_ERROR`. `--body-file -`은 표준 입력이다.

### 7.1 작업

```sh
twit task create --file task.json --request-id <id>
twit task list --mine [--role assignee|reviewer|requester] [--status <s>]... [--parent T-001] [--include-closed]
twit task show T-001
twit task assign T-001 --assignee <actor> [--reviewer <actor>] --expect-revision <n> --request-id <id>
twit task claim T-001 --expect-revision <n> --request-id <id>
twit task status set T-001 blocked --reason <text> --expect-revision <n> --request-id <id>
twit task resume T-001 [--reason <text>] --expect-revision <n> --request-id <id>
twit task submit T-001 --file submission.json --expect-revision <n> --request-id <id>
twit task update T-001 --file patch.json --expect-revision <n> --request-id <id>
twit task reassign T-001 --assignee <actor> --reason <text> --expect-revision <n> --request-id <id>
twit task cancel T-001 --reason <text> --expect-revision <n> --request-id <id>
```

`task.json` 형식:

```json
{
  "title": "결제 재시도 로직 정리",
  "purpose": "왜 하는가",
  "body": "무엇을 어떻게 할 것인가",
  "done_criteria": "언제 끝났다고 볼 것인가",
  "assignee": "opencode-1",
  "reviewer": "codex-1",
  "parent": "T-003",
  "related": ["T-004"],
  "refs": [{ "kind": "path", "value": "src/pay/retry.ts", "note": "현재 구현" }]
}
```

`title`, `purpose`, `body`, `done_criteria`는 필수이며 공백만 있으면 거절한다. `patch.json`은 위 필드의 부분집합이며 `title`, `purpose`, `body`, `done_criteria` 중 하나라도 실제 값이 바뀌면 내용 변경으로 처리한다. 값이 같으면 변경으로 보지 않는다.

`submission.json` 형식:

```json
{
  "attempt_id": "A-002",
  "content_version": 1,
  "summary": "수행 내용과 완료 조건 충족 여부",
  "verification": "실행한 검증, 결과, 미실행 항목과 이유",
  "artifacts": [{ "kind": "commit", "value": "a1b2c3d", "note": "worktree feature/retry" }],
  "remaining_issues": "제한과 후속 작업"
}
```

`attempt_id`, `content_version`, `summary`, `verification`은 필수다. `artifacts`는 빈 배열을 허용하되 생략은 거절해서 산출물 참조를 의식적으로 비우게 한다.

제출 판정:

- 호출자가 `attempt_id`의 담당자가 아니면 `FORBIDDEN`.
- 작업이 `in_progress`이고 `attempt_id`, `content_version`이 현재 값과 같으면 현재 제출로 채택하고 `in_review`로 전환한다. 응답 `accepted_as_current: true`.
- 그 외의 경우, 즉 시도나 내용 버전이 오래되었거나 작업이 이미 다른 상태라면 제출을 `accepted_as_current: false`로 보존만 한다. 상태와 현재 제출은 바꾸지 않는다. 리비전은 증가한다. 응답은 성공이며 텍스트 출력에 "현재 결과로 채택되지 않음"과 사유를 명시한다.
- 작업이 `done`, `cancelled`이면 위 규칙보다 우선하여 `INVALID_TRANSITION`.

`task list --mine` 출력 필드는 기능 설계 4장을 따른다. `응답 필요`는 그 작업에서 호출자를 수신자로 하는 `open` 질문 수다. 텍스트 출력은 한 작업당 한 줄이며 열 순서는 ID, 상태, 역할, 담당자, 검토자, 응답 필요, 버전/리비전, 갱신 시각, 제목이다.

`task show` 텍스트 출력은 헤더, 본문 섹션, 배정, 관련 작업, 미해결 질문, 현재 제출과 검토, 산출물, 최근 댓글 20개 순이다. 댓글이 20개를 넘으면 마지막 줄에 전체 개수와 `twit comment list T-001` 안내를 넣는다.

### 7.2 댓글

```sh
twit comment add T-001 --type progress --body-file note.md --expect-revision <n> --request-id <id>
twit comment list T-001 [--after C-010] [--type <t>] [--limit <n>]
```

- `comment add`는 `progress`만 허용한다. 다른 유형은 전용 명령이 생성한다.
- 작성자는 작업의 요청자, 담당자, 검토자, 또는 그 작업에 질문을 받은 참여자여야 한다. 그 외는 `FORBIDDEN`.
- `comment list`는 기본 전체를 시간순으로 반환한다. `--limit` 없이 부분 결과를 주지 않는다.

### 7.3 질문·답변·수신함

```sh
twit question ask T-001 --to <actor> [--blocking] --body-file q.md --expect-revision <n> --request-id <id>
twit question answer Q-001 --body-file a.md --expect-revision <n> --request-id <id>
twit question resolve Q-001 [--reason <text>] --expect-revision <n> --request-id <id>
twit question list T-001 [--status open|answered|resolved]
twit inbox list
```

- `--blocking`은 현재 담당자만 사용할 수 있고 작업이 `in_progress` 또는 `waiting_answer`여야 한다. 그 외 조합은 `FORBIDDEN` 또는 `INVALID_TRANSITION`.
- 일반 질문은 작업 참여자 누구나 등록할 수 있으며 상태를 바꾸지 않는다.
- 답변은 수신자 또는 요청자만 할 수 있다. `open`인 질문만 답변 가능하고 `answered`로 바뀐다. 답변 댓글은 `answer` 유형으로 남고 `answered_by`에 실제 답변자를 기록한다.
- 해결은 질문 작성자만 할 수 있고 `open` 또는 `answered`에서 `resolved`로 바뀐다. `open`에서 바로 해결하면 철회로 보고 `--reason`을 요구한다.
- 질문의 `--expect-revision`은 질문이 속한 작업의 리비전이다. `inbox list`와 `question list` 출력에 작업 리비전을 함께 표시한다.
- `inbox list`는 두 구역으로 나눈다. 첫째는 호출자가 수신자인 `open` 질문, 둘째는 호출자가 작성자인 `answered` 질문이다. 각 항목에 질문 ID, 작업 ID, 차단 여부, 상대, 작업 리비전, 본문 첫 줄을 표시한다.
- 답변과 해결은 작업 상태를 바꾸지 않는다. 담당자가 `task resume`을 호출해야 한다.
- `task resume` 검사 대상은 현재 `content_version`의 차단 질문뿐이다. 이전 버전 질문은 남아 있어도 재개를 막지 않는다.

### 7.4 검토

```sh
twit review approve T-001 --body-file review.md --expect-revision <n> --request-id <id>
twit review request-changes T-001 --body-file review.md --expect-revision <n> --request-id <id>
twit review list T-001
```

- 대상은 항상 `current_submission_id`다. 별도 제출 ID를 받지 않는다. 응답과 이력에 어느 제출 ID에 대한 검토인지 기록한다.
- 검토자가 지정되어 있으면 검토자만 가능하다. 없으면 요청자만 가능하다.
- 검토자와 제출 작성자가 같으면 `self_review = 1`로 기록하고 텍스트 출력에 표시한다.
- 승인 시 시도를 `submitted_approved`로 종료하고 `done`으로 전환한다.
- 수정 요청 시 시도를 `changes_requested`로 종료하고 `changes_requested`로 전환한다. 담당자가 `claim`하면 새 시도가 생기고 새 제출을 올린다. 이전 제출의 `accepted_as_current`는 그대로 두되 `current_submission_id`는 새 제출이 올 때까지 유지한다. 상세 화면은 "수정 요청됨"과 함께 표시한다.

### 7.5 이력

```sh
twit history list T-001 [--after <n>]
```

`history` 테이블을 순서대로 반환한다. 텍스트 출력은 리비전, 시각, 호출자, 동작, 요약 한 줄이다. JSON은 `before`, `after`를 포함한다.

## 8. 출력 계약과 종료 코드

JSON 봉투:

```json
{ "schema_version": 1, "ok": true, "data": { ... }, "error": null }
{ "schema_version": 1, "ok": false, "data": null,
  "error": { "code": "REVISION_CONFLICT", "message": "...", "details": { "expected": 3, "current": 5 } } }
```

- 변경 명령의 `data`에는 최소 `task_id`, `revision`, `status`가 들어간다. 생성한 개체 ID(`attempt_id`, `comment_id`, `question_id`, `submission_id`, `review_id`)와 `accepted_as_current`, `replayed`를 해당하는 경우 포함한다.
- 성공 JSON은 stdout, 오류 JSON도 stdout에 출력한다. 진단·경고 문구는 stderr다. `--json`이 없을 때 오류는 stderr에 한 줄로 출력한다.
- 텍스트 모드에서 리비전 충돌 시 안내 문구에 `twit task show T-001`을 포함한다.

종료 코드:

| 코드 | 오류 |
|---|---|
| 0 | 성공. 미채택 제출과 멱등 재전송도 성공이다 |
| 1 | 예기치 못한 내부 오류 |
| 2 | `VALIDATION_ERROR`, `REQUEST_ID_CONFLICT` |
| 3 | `NOT_FOUND` |
| 4 | `FORBIDDEN` |
| 5 | `REVISION_CONFLICT` |
| 6 | `INVALID_TRANSITION` |
| 7 | `STALE_ATTEMPT` |
| 8 | `ACTOR_NOT_CONFIGURED` |

`STALE_ATTEMPT`는 `--attempt` 옵션을 받는 명령에 현재 시도가 아닌 ID가 들어왔을 때 사용한다. 초기 버전에서는 `task submit`이 시도 ID를 받지만 위 제출 판정 규칙에 따라 보존 처리하므로, 실제로는 호출자가 해당 시도의 담당자가 아닌 경우의 `FORBIDDEN`과 구분하기 위해 코드만 예약한다.

## 9. 텍스트 출력 원칙

- 한 줄 요약 목록은 고정 폭 열을 쓰고 제목은 마지막 열에 두어 잘림을 피한다.
- 본문은 그대로 출력한다. Markdown을 해석하지 않는다.
- 비밀값을 걸러내는 기능은 두지 않는다. 대신 본문 파일 내용 외에 환경변수나 파일 시스템을 읽지 않는다.
- 시각은 UTC ISO 문자열 그대로 표시한다. 로컬 시각 변환은 하지 않는다.

## 10. 테스트 계획

`test/helpers.ts`가 임시 디렉터리를 `TWIT_HOME`으로 만들고 `dane`(human), `codex-1`, `opencode-1`(agent)을 등록한다. 테스트는 CLI 진입 함수를 직접 호출하고 stdout을 가로채 JSON을 파싱한다. 동시성 테스트만 `child_process`로 실제 프로세스 두 개를 띄운다.

기능 설계 11장의 완료 조건을 테스트 파일에 1:1로 대응시킨다.

| 완료 조건 | 테스트 |
|---|---|
| 담당·검토 역할 미종료 작업 중복 없는 목록 | `list.test.ts`: 한 작업에 담당자이자 검토자인 경우 한 줄, 역할 두 개 표시 |
| 종료 작업 포함 옵션과 빈 목록 | `list.test.ts` |
| 상세에서 완료 조건·현재 제출·질문·이력 확인 | `show.test.ts` |
| 배정·댓글·질문·답변만으로 다른 프로세스 미실행 | 코드 검토 항목. `child_process`, `spawn` 사용처가 테스트 외에 없음을 `grep`으로 확인하는 테스트 추가 |
| 담당자가 아닌 수신자의 수신함 조회 | `inbox.test.ts` |
| 답변 후 명시적 재개 전 대기 유지 | `question.test.ts` |
| 미해결 차단 질문이 있으면 재개 불가 | `question.test.ts` |
| 동시 인수 중 하나만 성공, 재전송 중복 없음 | `concurrency.test.ts`, `idempotency.test.ts` |
| 권한·전환·리비전 오류 시 무변경 | `transition.test.ts`: 오류 후 `history` 행 수와 리비전이 그대로임을 확인 |
| 취소·재배정·내용 변경 이후 과거 제출 미채택 | `submission.test.ts` |
| 검토가 제출에 연결, 검토자 없으면 요청자 승인 | `review.test.ts` |
| 프로세스 종료 후 재조회 | `persistence.test.ts`: 프로세스를 새로 띄워 조회 |
| 두 에이전트가 twit만으로 전체 흐름 수행 | `flow.test.ts`: 기능 설계 9장의 아홉 단계를 순서대로 실행 |

## 11. 구현 단계

각 단계는 테스트가 통과한 상태로 끝나며 다음 단계의 전제가 된다.

1. **골격과 기반**: `package.json`, `tsconfig`, commander 루트, DB 열기와 마이그레이션, 오류 코드와 종료 코드, JSON 봉투, ID 발급, 호출자 해석, `actor add/list/deactivate`, `whoami`. 테스트: 참여자 등록과 `ACTOR_NOT_CONFIGURED`.
2. **작업 기본과 변경 실행기**: `mutation.ts`의 트랜잭션·리비전·멱등성·이력 처리, `task create/show/list/assign/update/cancel/reassign`, `history list`. 테스트: 목록, 상세, 리비전 충돌, 멱등 재전송, 내용 변경 시 버전 증가.
3. **인수와 진행**: 시도 생성, `task claim`, `task status set blocked`, `task resume`, `comment add/list`. 테스트: 동시 인수, 전환 오류 무변경, 댓글 권한.
4. **질문·답변·수신함**: `question ask/answer/resolve/list`, `inbox list`, 차단 질문과 재개 조건. 테스트: 수신함, 대기 유지, 재개 거절.
5. **제출과 검토**: `task submit`, `review approve/request-changes/list`, 미채택 판정, 자기 검토 표시. 테스트: 과거 제출 보존, 검토자 부재 시 요청자 승인, 수정 요청 후 재인수.
6. **전체 흐름과 마무리**: `flow.test.ts`, `persistence.test.ts`, 프로세스 미실행 검사, 사용법 README, `npm link` 확인. 기능 설계 11장의 체크박스를 채운다.

각 단계는 대략 하루 안에 끝나는 크기이며, 3단계까지 끝나면 사람이 요청자로 참여하는 최소 사용이 가능하다.

## 12. 초기 버전에서 의도적으로 제외한 것

- 참여자 삭제. 이력 참조가 깨지므로 비활성화만 제공한다.
- 댓글·제출·검토 수정과 삭제. 후속 기록으로 정정한다.
- `done`, `cancelled` 작업 재개. 후속 작업을 새로 등록한다.
- 상위 작업의 자동 상태 변경, 하위 작업 집계.
- 리비전 없는 편의 변경 명령. 에이전트가 항상 `task show` 후 변경하도록 강제한다.
- 본문 크기 제한. 초기에는 두지 않고 문제가 생기면 추가한다.
- 파일 경로 참조의 존재 확인. 참조는 문자열로만 저장하고 확인은 열람자가 한다.
