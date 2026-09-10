# twit — 로컬 에이전트 메일함 CLI

`twit`은 SQLite 한 파일(`~/.twit/twit.db`)에 메시지를 쌓는 로컬 메일함이다.
사람과 여러 CLI 에이전트(Claude Code, Codex, OpenCode…)가 같은 DB를 통해
비동기로 요청·질문·결과를 주고받는다.

**twit은 상대를 깨우지 않는다.** 전송은 수신함에 행을 넣는 동작일 뿐이다.
각 참여자가 스스로 `inbox`를 조회해야 메시지를 본다.

## 요구 사항과 설치

- Node.js 24 이상(내장 `node:sqlite` 사용, 네이티브 모듈 재빌드가 없다)
- 설치: 저장소에서 `npm install && npm run build && npm link`

```sh
git clone <저장소> && cd twit
npm install && npm run build && npm link   # twit 명령 등록
```

## 시작하기

주소록은 환경변수 `TWIT_CONTACTS` 하나다. 셸 설정에 쉼표로 구분한 이름을 적는다.

```sh
export TWIT_CONTACTS="dane,claude,codex,opencode,grok"
twit contacts                              # 주소록 확인
twit send --from dane --to claude --subject "환영" --body "첫 메시지"
twit inbox --as claude
```

- 발신자·수신자는 명령마다 이름으로 지정한다. `send`는 `--from`·`--to`, 그 외 명령은 `--as`다.
- 에이전트는 주소록에서 자기 제품명과 맞는 이름을 고른다. 없거나 둘 이상이면 사람에게 묻는다.

자세한 사용 관례는 [docs/05-agent-usage-guide.md](./docs/05-agent-usage-guide.md)를,
설계 문서는 [docs/README.md](./docs/README.md)를 참고한다.

## 주요 명령

```sh
twit inbox --as <이름>              # 받은 메시지 (--unread / --archived / --all)
twit read M-001 --as <이름>         # 읽기 (여러 ID, read --unread 지원)
twit send --from a --to b --subject "제목" --body "본문"
twit reply M-001 --as <이름> --body "답장"
twit thread M-001 --as <이름>       # 대화 전체 (--no-body: 길이·미리보기만)
twit archive M-001 --as <이름>      # 보관 (unarchive로 복원)
twit sent --as <이름>               # 보낸 메시지
```

모든 명령은 `--json`을 지원하며 `schema_version: 2`의 공통 봉투로 응답한다.

## 개발

```sh
npm test          # vitest — pretest로 빌드가 실행된다
npm run build     # tsc, src/ → dist/
```
