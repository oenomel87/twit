# twit 읽기 전용 로컬 UI

- 작성일: 2026-09-18
- 상태: 기능 설계. 사용자가 확정한 범위다.
- 관계: 기능 원칙은 [03-v2-mail-inbox-design.md](../../03-v2-mail-inbox-design.md), 기술 골격은 [04-v2-implementation-design.md](../../04-v2-implementation-design.md), 에이전트 관례는 [05-agent-usage-guide.md](../../05-agent-usage-guide.md)를 따른다. 03의 「웹 UI 제외」는 원격·상시 서버를 말한 것으로 두고, 이 문서는 **사람만 쓰는 짧은 수명의 로컬 관찰 화면**을 예외로 추가한다.

## 1. 목적

사람이 에이전트 사이에 오간 메시지를 CLI 없이 한 화면에서 읽는다.

`twit` CLI는 참여자별 인박스다. 지금 `dane` 인박스는 비어 있고 실제 대화는 `claude`/`codex`/`opencode` 사이에 있다. 이 UI는 특정 `--as`의 메일함이 아니라 **메일함 전체의 관찰자 시점**이다.

하지 않는 일:

- 읽음·보관 상태를 바꾸지 않는다
- 보내기·답장·보관을 제공하지 않는다
- 에이전트를 깨우거나 폴링하지 않는다
- 원격 접속, 상시 데몬, 여러 머신 공유를 하지 않는다
- 에이전트가 쓸 전체 덤프 명령을 만들지 않는다. 에이전트는 기존 `inbox`/`read`/`thread`를 쓴다

## 2. 사용

```sh
twit ui
twit ui --json
```

- `--as` 없이 실행한다. `--as`를 붙이면 `VALIDATION_ERROR`(종료 코드 2)다. `send`에 `--as`를 붙인 것과 같다.
- `TWIT_CONTACTS`가 없어도 된다. 주소록 밖의 옛 이름(`claude-1` 등)이 있는 메시지도 보여 준다.
- 프로세스가 살아있는 동안 `127.0.0.1`의 임의 포트에 HTTP 서버를 연다. `0.0.0.0`에는 붙지 않는다.
- 기본 브라우저로 그 URL을 연다. 열기에 실패해도 서버는 유지하고 URL을 표준출력에 남긴다.
- Ctrl+C(SIGINT) 또는 정상 종료 시 서버를 닫고 DB를 닫고 종료 코드 0으로 끝낸다.
- 텍스트 출력: URL 한 줄. JSON 출력: 공통 봉투의 `data`에 `{ "url", "port" }`. 출력 뒤에 프로세스는 대기한다.

## 3. 화면

메일함 레이아웃.

| 영역 | 내용 |
|---|---|
| 왼쪽 | 대화 목록. 마지막 메시지 `seq` 내림차순. 제목(최초 메시지), 참여자, 통수, 시각, 마지막 본문 미리보기 |
| 오른쪽 | 고른 대화. 헤더에 제목·메시지 ID 범위·참여자. 본문은 오래된 순(`seq` 오름차순) |
| 메시지 카드 | `발신자 → 수신자`, ID, 시각, 수신자 읽음/보관 **표시**, 본문 전체 |
| 새로고침 | 버튼을 누르면 목록과, 열려 있는 대화가 있으면 그 상세를 다시 가져온다. 고른 `thread_id`가 남아 있으면 유지한다. 자동 폴링은 없다 |
| 처음 열림 | 대화가 하나라도 있으면 목록의 첫 줄(가장 최근 대화)을 연다. 없으면 빈 안내 |

제목·이름·미리보기·본문 등 메시지에서 온 문자열은 모두 `textContent`(또는 동등한 이스케이프)로 넣는다. `innerHTML`에 끼워 넣지 않는다. 본문은 줄바꿈을 유지한다. 마크다운은 렌더하지 않는다. 검색·이름 필터·작성 폼은 없다.

빈 메일함이면 왼쪽은 「대화 0」, 오른쪽은 안내 문구다.

## 4. 구성

```text
사람 → twit ui → ~/.twit/twit.db (기존 경로, TWIT_HOME 준수)
              → http://127.0.0.1:<port>
              → 기본 브라우저
```

브라우저 HTTP:

| 방법 | 경로 | 성공 | 실패 |
|---|---|---|---|
| GET | `/` | HTML 페이지 (Content-Type: text/html; charset=utf-8) | — |
| GET | `/api/threads` | `{ "threads": ThreadSummary[] }` | — |
| GET | `/api/threads/:id` | `ThreadDetail` | 없으면 404 `{ "error": "NOT_FOUND" }` |
| GET 이외 | `/api/*` | — | 405 `{ "error": "METHOD_NOT_ALLOWED" }` |
| 그 외 경로 |  | 404 | POST 등 쓰기는 만들지 않는다 |

API 응답의 `Content-Type`은 `application/json; charset=utf-8`이다.

CLI JSON 봉투(`schema_version: 2`)는 터미널 출력에만 쓴다. 브라우저 API는 위 작은 JSON이다.

페이지 HTML/CSS/JS는 TypeScript 모듈이 문자열로 내보낸다. 디스크에서 정적 파일을 읽지 않는다. 04 문서의 fs 경계(`body.ts`, `db.ts`만 파일 시스템에 접근)를 유지한다.

브라우저를 여는 것은 `src/ui/open.ts`가 `node:child_process`로 `open`(macOS) / `xdg-open`(그 외)을 한 번 실행하는 것이다. 테스트에서는 이 함수를 주입해 실제 브라우저를 열지 않는다. `test/persistence.test.ts`의 「src에서 child_process 금지」는 이 파일만 예외로 둔다.

## 5. 데이터

스키마 변경 없음. 조회만 추가한다.

대화는 기존과 같이 `thread_id`다. 최초 메시지는 `thread_id == id`이다.

### ThreadSummary

```json
{
  "thread_id": "M-030",
  "subject": "GWE 범위·기준표 v0.1 검토 결과",
  "participants": ["codex", "claude"],
  "message_count": 10,
  "last_id": "M-056",
  "last_at": "2026-09-18T14:03:19.568Z",
  "preview": "kg-mjs-fe 제한적 추가 조사 요청"
}
```

- `subject`: 최초 메시지의 제목
- `participants`: 최초 메시지의 `[sender_id, recipient_id]` (`thread` 명령과 같다)
- `preview`: 마지막 메시지 본문에 기존 `preview()`를 적용
- 정렬: 마지막 메시지 `seq` 내림차순, 같으면 `thread_id`로 결정

### ThreadDetail

```json
{
  "thread_id": "M-030",
  "subject": "GWE 범위·기준표 v0.1 검토 결과",
  "participants": ["codex", "claude"],
  "messages": [ObserverMessage]
}
```

### ObserverMessage

`toMeta`/`toMessage`의 `--as` 권한 투영을 쓰지 않는다. 관찰자는 수신자 영수증을 그대로 본다.

```json
{
  "id": "M-056",
  "thread_id": "M-030",
  "reply_to_id": "M-047",
  "sender": "codex",
  "recipient": "claude",
  "subject": "GWE 범위·기준표 v0.1 검토 결과",
  "created_at": "2026-09-18T14:03:19.568Z",
  "read": false,
  "archived": false,
  "body_length": 3509,
  "body": "…"
}
```

- `read`: `receipts.read_at !== null`
- `archived`: `receipts.archived === 1`
- 목록 API에는 `body`가 없고 `preview`가 있다. 상세 API에는 `body`가 있고 `preview`가 없다.

`:id`는 대화 ID이거나 그 대화에 속한 메시지 ID다. `thread` 명령과 같다. 메시지가 없으면 404.

## 6. 쓰기 금지와 DB 열기

DB는 기존 `openDatabase`로 연다. 마이그레이션이 필요하면 적용한다(지금은 쓰기). 서버가 떠 있는 동안 UI 코드 경로는 `messages` / `receipts` / `requests`에 INSERT·UPDATE·DELETE를 하지 않는다.

읽음 처리 함수(`read` 명령 경로)를 UI에서 호출하지 않는다. `thread` CLI가 읽음을 바꾸지 않는 것과 같은 보장이다.

동시성: CLI가 같은 DB에 쓰는 동안 UI가 읽는 것은 WAL + `busy_timeout`으로 기존과 같다.

## 7. 명령 배치

- `src/commands/ui.ts` — `twit ui` 등록. `--as` 검사, 서버 수명, 시그널, 출력
- `src/ui/server.ts` — `node:http` 서버. `listen(0, '127.0.0.1')`. `close()` 제공
- `src/ui/page.ts` — HTML 문자열
- `src/core/queries.ts` — `listThreads`, `getThreadForUi` (이름 가안). 권한 검사 없음
- `src/main.ts` — 명령 등록. `contacts` 설명을 「`--as` 없이 실행할 수 있는 명령」으로 고친다 (`ui`가 두 번째)

`runCli`가 시그널까지 기다리므로 테스트는 서버 모듈을 직접 호출한다. `run(['ui', '--as', 'dane'])` 같은 검증 오류만 `runCli`로 검사한다.

장기 실행 중 `withDb`의 try/finally로 바로 닫으면 안 된다. UI는 DB를 연 채로 대기하고, 종료 훅에서 닫는다.

## 8. 오류

| 상황 | 동작 |
|---|---|
| `--as` 있음 | 서버를 열지 않음. `VALIDATION_ERROR` 2 |
| DB 열기 실패 | 서버를 열지 않음. `STORAGE_ERROR` 6 |
| 포트 listen 실패 | 서버를 열지 않음. `STORAGE_ERROR` 6 |
| 브라우저 열기 실패 | stderr에 한 줄, URL은 stdout, 서버 유지 |
| 없는 대화 | HTTP 404, 프로세스 유지 |
| 잘못된 HTTP 메서드 | HTTP 405, 프로세스 유지 |

## 9. 테스트

실제 `~/.twit`을 쓰지 않는다. 기존 `test/helpers.ts`의 임시 `TWIT_HOME`을 쓴다.

1. 대화 두 개(각각 답장 포함)를 넣은 뒤 `GET /api/threads`가 마지막 `seq` 역순이고, 제목·참여자·통수·미리보기가 맞는다
2. `GET /api/threads/M-001`과 `GET /api/threads/<답장ID>`가 같은 본문 목록을 오래된 순으로 돌려준다
3. 없는 ID는 404
4. 수신자가 CLI `read`를 하기 전·후 UI의 `read` 표시가 바뀌고, UI GET만으로는 `receipts` 행이 바뀌지 않는다(행 수·`read_at`·`archived` 불변)
5. `twit ui --as dane`는 종료 코드 2, 서버 없음
6. `TWIT_CONTACTS` 없이 UI 서버가 열린다
7. 페이지 응답이 HTML이고 메시지 문자열을 `innerHTML`에 넣지 않는다(페이지 소스에 `textContent` 또는 이스케이프 헬퍼가 있다)
8. `src/`에서 `child_process`를 쓰는 파일은 `src/ui/open.ts`뿐이다

브라우저 E2E는 1차에 두지 않는다.

## 10. 문서

- 03 9장 제외 목록의 「웹 UI」를 「원격 웹 UI·상시 서버」로 좁히고, 로컬 `twit ui`를 포함에 넣는다
- 03 10장에 관찰자 UI 검증 항목을 추가한다: 전체 대화가 보이고, GET이 읽음을 바꾸지 않고, `--as`가 거절된다
- 03 4장·04 4장·05의 「주소록이 없으면 모든 명령을 거절」과 「`--as` 없이 실행할 수 있는 유일한 명령은 contacts」를 고친다. 예외는 `contacts`(주소록 필요, `--as` 없음)와 `ui`(주소록 불필요, `--as` 없음)다
- 04 2장 구조에 `commands/ui.ts`, `ui/`를 넣는다. fs 경계는 유지한다. `child_process`는 `src/ui/open.ts`만 허용한다
- 05에 한 절: 사람은 `twit ui`로 전체를 볼 수 있다. 에이전트는 쓰지 않는다
- README 주요 명령에 `twit ui`를 한 줄 추가한다
- `docs/README.md`에 이 문서를 넣는다
- `test/docs.test.ts`는 05가 바뀌면 그에 맞게 기대를 추가한다

## 11. 제외 (1차)

- 마크다운 렌더, 검색, 참여자 필터
- 보내기·답장·보관 버튼
- 자동 새로고침
- `--as`로 한 사람 인박스 흉내
- Datasette, 별도 프론트 빌드, 새 npm 의존성
- 읽기 전용 `PRAGMA`로 마이그레이션까지 막는 것 (기존 `openDatabase`를 쓴다)

## 12. 권한 모델과의 관계

03은 「제삼자가 다른 참여자 사이의 메시지를 CLI로 읽거나 답장할 수 없다」고 한다. 이 UI는 그 CLI 규칙을 풀지 않는다. `thread`/`read`는 여전히 당사자만 가능하다.

예외는 **사람 앞의 로컬 화면 하나**다. 신뢰된 단일 머신 전제(03 4장) 위에 있다. localhost HTTP는 그 머신 사용자에게 DB 파일과 같은 수준의 접근이다.
