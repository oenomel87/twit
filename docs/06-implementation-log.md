# twit v2 구현 로그

- 작성일: 2026-09-09
- 상태: 구현 완료. [04-v2-implementation-design.md](./04-v2-implementation-design.md)의 5단계 실행 계획을 수행한 기록이다.
- 관계: 기능은 [03-v2-mail-inbox-design.md](./03-v2-mail-inbox-design.md), 처리 규칙은 04 문서를 따른다. 03 문서 10장 체크박스 중 자동 테스트 항목은 이 로그의 검증으로 갱신했다.

## 1. 요약

| 단계 | 산출물 | 검증 |
|---|---|---|
| 1단계 | 골격(`package.json`, `tsconfig.json`), `store/`(스키마·마이그레이션), `core/`(오류·호출자), `output/json.ts`, `contacts`/`whoami`, `test/helpers.ts` | 테스트 16개, `npm link` 후 종료 코드 0·0·8 시나리오 확인 |
| 2단계 | `core/body.ts`, `core/mailbox.ts`(`send`, `read`), `core/queries.ts`(`inbox`, `sent`), `output/text.ts`, `commands/send.ts`, `commands/inbox.ts` | 테스트 26개 추가. 미읽음 `*` 표시 → `read` 후 사라짐, 제삼자 `read` 종료 코드 4 확인 |
| 3단계 | `reply`, `thread`(`--no-body` 포함), `archive`, `unarchive` | 테스트 19개 추가. 답장 방향, `body_length`, 보관 후 새 답장 노출 확인 |
| 4단계 | `core/idempotency.ts`, `send`·`reply`의 `--request-id` | 테스트 26개 추가. `idempotency`·`atomicity`·`concurrency`·`persistence`·`fs-boundary` |
| 5단계 | [05-agent-usage-guide.md](./05-agent-usage-guide.md), `test/docs.test.ts`, README 색인·03 체크박스 갱신 | 테스트 9개 추가. 전체 흐름(요청 → 질문 → 답변 → 결과 → 보관) 수동 확인 |

최종 상태: 테스트 92개 통과(`vitest`, §5의 구현 후 수정 포함), `tsc` 빌드 경고 없음, `npm link`로 `twit` 명령 등록 완료.

## 2. 구현 중 특이 사항

구현에서 설계 문서에 없던 문제를 만나거나 결정을 요한 경우다. 코드와 함께 문서를 고친 항목은 명시한다.

### 2.1 진입점 분리 — fs 경계 원칙 위반을 사전에 수정

`main.ts`에서 직접 실행 여부를 판별하는 관용 패턴은 `realpathSync(process.argv[1])`로 `node:fs`를 요구한다. 그런데 이 판별은 fs 사용처 제약(04 문서 §2: `body.ts`, `db.ts`뿐)에 어긋난다. `npm link`가 만드는 심볼릭 링크로 실행하면 realpath 비교 없이는 진입 판별이 실패하므로 판별 로직 자체를 제거할 수 없었다.

해결: 진입점을 `bin/twit.js`(저장소 파일, shebang 포함)로 분리하고 `package.json`의 `bin`을 `./bin/twit.js`로 바꿨다. `main.ts`는 `runCli`만 export하며 fs를 쓰지 않는다. `prepare` 스크립트가 `npm link`·`npm install` 때 빌드를 보장한다. 실행 계획의 규칙(코드보다 문서를 먼저 고친다)에 따라 04 문서 §1·§2를 코드 수정 전에 갱신했다.

### 2.2 commander에서 같은 이름 명령 중복 등록 불가

`contacts`(목록)와 `contacts add`(등록)를 `program.command('contacts')`로 두 번 만들면 "cannot add command 'contacts' as already have command 'contacts'" 오류로 즉시 종료된다. 해결: `contacts` 명령 하나에 `.action()`(목록)과 `.command('add')`(등록)를 함께 등록했다. commander는 action과 서브커맨드를 동시에 갖는 명령을 지원하며, `twit contacts`는 목록이 실행되고 `twit contacts add`는 서브커맨드로 분기된다.

### 2.3 commander 전역 옵션은 서브커맨드 뒤에서도 파싱된다

`twit whoami --json`처럼 전역 옵션(`--json`, `--actor`)이 서브커맨드 뒤에 와도 commander v14가 program 수준에서 파싱했다. 다만 옵션 값이 program과 서브커맨드 중 어느 쪽에 붙는지에 의존하지 않도록 `mergeGlobalOptions`로 두 값을 합쳐 사용한다(`undefined`인 쪽을 건너뛴다). 실행 중 어느 위치에서도 동일하게 동작함을 테스트로 고정했다(`contacts.test.ts`).

### 2.4 commander `--no-body` 부정(negatable) 옵션의 기본값

`.option('--no-body', ..., false)`처럼 명시적 기본값 `false`를 주면 commander의 부정 옵션 규칙(생략 시 `true`)이 무시되고 항상 `false`가 되어, `thread`가 본문을 항상 생략했다. 명시적 기본값 인자를 빼서 해결했다. 부정 옵션에는 기본값 인자를 주지 않는 것이 규칙이다.

### 2.5 commander 파서 오류와 `--json` 계약

알 수 없는 옵션·명령은 commander가 자체적으로 stderr에 안내문을 쓰고 `CommanderError`를 던진다. 이 경우에도 JSON 계약을 지키기 위해 argv에 `--json`이 있으면 stdout에 `VALIDATION_ERROR` 봉투를 추가로 출력하고 종료 코드 2로 마친다. 텍스트 모드에서는 commander의 안내문만 두고 중복 출력하지 않는다.

### 2.6 `better-sqlite3` 타입 임포트 충돌

`import Database from 'better-sqlite3'`(기본 임포트)와 `import type { Database }`를 한 파일에 함께 쓰면 "Duplicate identifier 'Database'"로 실패한다. 기본 임포트는 그대로 두고 타입은 `import type { Database as SqliteDatabase }` 별칭으로 분리했다.

또한 `db.transaction(fn)`이 반환하는 값의 타입은 튜플이 아닌 함수 시그니처 제약(`Transaction<F extends VariableArgFunction>`)을 갖는다. `Transaction<[], SendResult>`는 타입 오류이며 `Transaction<() => SendResult>`가 맞다. `BEGIN IMMEDIATE` 실행은 `.immediate()` 메서드로 한다.

### 2.7 참여자 목록 정렬의 동일 밀리초 문제

`contacts add`를 연속 호출하면 `created_at`이 같은 밀리초로 기록될 수 있다. `ORDER BY created_at`만으로는 등록 순서가 결정되지 않아 `ORDER BY created_at, rowid`로 결정화했다. `rowid`는 삽입 순서이므로 같은 시각의 순서를 보존한다.

### 2.8 JSON 응답의 응답 필드 프로젝션

`contacts` 목록을 DB 행(`created_at` 포함)을 그대로 반환하면 설계 §5의 응답 구조(`{ id, display_name }`)와 어긋난다. 출력 계층에서 필드를 프로젝션해 설계된 구조만 노출한다. 반대로 `sent` 등에서 수신자의 `read_at` 원시값은 노출하지 않고 수신자 관점의 `read` 불리언(또는 `null`)만 내보낸다.

### 2.9 원자성 테스트의 실패 유도 방법

"requests 삽입 실패 유도"는 코드 경로를 조작해 만들 수 없다(정상 흐름의 `requests` INSERT는 FK·PK를 항상 만족). 대신 테스트가 DB에 직접 연결해 `BEFORE INSERT ON requests ... RAISE(ABORT)` 트리거를 심고 전송했다. 이때 SQLite 오류가 그대로 빠져나가지 않도록 트랜잭션 실행은 `STORAGE_ERROR`(종료 코드 6)로 래핑하며, `messages`·`receipts`·`requests`의 행 수가 모두 불변함을 확인한다.

### 2.10 메시지 ID 발급

설계 §3대로 쓰기 트랜잭션 안에서 `SELECT COALESCE(MAX(seq), 0) + 1`로 `seq`를 계산하고 `M-` + 0 채움 ID를 같은 INSERT에 명시했다. `BEGIN IMMEDIATE` 트랜잭션 때문에 두 프로세스가 같은 `seq`를 계산할 수 없으며, 실제 두 프로세스의 동시 전송에서 서로 다른 ID(`M-001`, `M-002`)가 나오는 것을 `concurrency.test.ts`로 확인했다. 동일 요청 키의 동시 전송에서는 메시지가 하나만 생기고 둘 중 하나가 `replayed: true`를 받는다.

## 3. 설계가 정하지 않은 부분의 구현 결정

04 문서가 정하지 않아 구현에서 결정한 사항이다. 추후 문서화가 필요하면 이 항목을 근거로 쓴다.

| 항목 | 결정 |
|---|---|
| `whoami`/`contacts` 텍스트 출력 | 한 참여자당 `id (display_name)` 한 줄. 빈 목록은 `(no contacts)` |
| `inbox`/`sent` 텍스트 행 | `id`, 읽음 표시(`*`/공백), 상대 참여자, ISO 시각, 제목 순을 두 칸 공백으로 구분. `--all`은 앞에 `[A]` 보관 표시 |
| `read` 텍스트 출력 | `ID`, `From`, `To`, `Subject`, `Date`, `Reply-To`, `Thread` 헤더와 빈 줄, 본문. 값이 없으면 `-` |
| `thread --no-body` 텍스트 행 | `id`, `발신자 → 수신자`, 시각, `reply:<대상>`, 읽음 표시(받은 메시지만, 보낸 것은 `-`), 본문 길이 |
| `send`/`reply`/`archive` 텍스트 성공 줄 | `sent M-001 -> codex-1  제목`, `M-001 archived` |
| `contacts add` 검사 순서 | ID 형식 → 이름 공백 → 호출자 요건 → 중복. 호출자 검사가 중복 검사보다 먼저다 |
| 본문 파일 읽기 실패 | `VALIDATION_ERROR`(종료 코드 2). 파일 문제는 사용자 입력으로 본다 |
| 봉투 JSON 포맷 | `JSON.stringify(..., null, 2)` + 개행. 사람이 읽기 좋게 pretty 출력 |
| 미사용 `--json` 오류 대상 | 파서 오류 포함(2.5 참조) |

## 4. 검증 기록
### 4.1 자동 테스트

```sh
npm test   # 13개 파일, 87개 테스트 통과
npm run build   # tsc 오류 없음
```

파일 대응은 04 문서 §10의 표와 같다. `fs-boundary`는 `persistence.test.ts` 안에서 소스 검사로 수행한다(src 전체를 훑어 `node:fs` 임포트가 `core/body.ts`, `store/db.ts`뿐인지, `child_process`가 없는지 확인).

### 4.2 수동 명령 검증

`npm link` 후 실제 `twit` 명령으로 아래 흐름을 실행해 확인했다.

1. 1단계 시나리오: 빈 홈에서 `contacts add`(호출자 없이) 성공, `whoami --json` 성공, 호출자 없는 `whoami` 종료 코드 8.
2. 2단계 시나리오: `send` 후 수신자 인박스에 `*` 표시, `read` 후 표시 사라짐, 제삼자 `read` 종료 코드 4.
3. 3단계 시나리오: 받은/보낸 메시지 각각의 답장 방향, `thread --no-body`의 본문 길이(문자 수) 일치, 보관 후 새 답장이 기본 인박스에 표시.
4. 4단계 시나리오: 같은 키 재전송이 같은 ID를 `replayed: true`로 반환, 같은 키+다른 본문은 종료 코드 5.
5. 전체 흐름: 요청 → 질문 → 답변 → 결과 → 보관 → 인박스 비움 → `thread --no-body`로 답장 체인 확인.

`--body-file -` 표준 입력 입력도 확인했다(printf 파이프 → 본문 저장).

### 4.3 남은 항목

03 문서 10장의 마지막 체크박스 하나가 남아 있다: 서로 다른 두 에이전트 CLI에 `TWIT_ACTOR`와 세션 규칙을 적용하고 요청 → 질문 → 답변 → 결과 흐름을 실제로 수행하는 것. 수행 결과는 [05-agent-usage-guide.md](./05-agent-usage-guide.md)의 "10. 수동 연동 검증 기록"에 기록한다.

## 5. 구현 후 수정(2026-09-09)

첫 구현 커밋 이후 발견해 고친 결함과 불일치다. 각 항목은 회귀 테스트를 함께 추가했다(최종 92개).

| 구분 | 내용 | 수정 | 검증 |
|---|---|---|---|
| 결함 | 파이프 출력이 64KB에서 잘림 | `bin/twit.js`가 `process.exit(code)`로 마쳐 대기 중인 stdout 쓰기가 버려졌다. `process.exitCode = code`로 바꿔 이벤트 루프가 스트림을 비운 뒤 끝나게 했다. 상대가 먼저 닫은 파이프(EPIPE)는 정상 종료로 처리 | 100KB 본문 전송 뒤 `read --json \| wc -c`로 300,422바이트 온전 확인, 회귀 테스트 |
| 결함 | 표준 입력(`--body-file -`) 본문이 공백 검사를 건너뜀 | `body.ts`가 stdin 경로에서 `assertNotBlank`를 빠뜨렸다. 공백만 있으면 `VALIDATION_ERROR`(2)로 거절 | 실제 프로세스로 stdin 공백/정상 케이스 테스트 |
| 불일치 | `body_length`가 UTF-16 코드 단위 수(이모지 2개 = 4) | 03 문서 5.5의 "문자 수"대로 코드 포인트 수로 계산(`[...body].length`). `thread --no-body` 텍스트 출력도 함께 수정 | 이모지 본문 `body_length: 2` 확인, 회귀 테스트 |
| 불일치 | `read`·`archive`·`unarchive`의 UPDATE에서 나는 SQLite 오류가 내부 오류(1)로 나감 | 04 문서 7장의 규칙(SQLite 오류 → `STORAGE_ERROR`, 6)을 `withDb`에서 일원 적용. send/reply의 개별 래핑은 제거해 규칙을 한 곳에 둠 | receipts 갱신을 ABORT하는 트리거로 세 명령 모두 종료 코드 6 확인, 회귀 테스트 |
| 불일치 | `thread`의 `participants`가 조회에 쓴 메시지의 발신자·수신자 순서를 따름 | 답장 ID로 조회하면 순서가 뒤집혔다. 대화의 최초 메시지(`rows[0]`) 기준으로 고정 | M-002(답장)로 조회해도 최초 메시지 순서 유지, 회귀 테스트 |
