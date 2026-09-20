import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const GUIDE = readFileSync(
  fileURLToPath(new URL('../docs/05-agent-usage-guide.md', import.meta.url)),
  'utf8',
)
const ROOT_README = readFileSync(
  fileURLToPath(new URL('../README.md', import.meta.url)),
  'utf8',
)

describe('에이전트용 사용 가이드', () => {
  it('설정과 주소록 안내를 담는다', () => {
    expect(GUIDE).toContain('TWIT_CONTACTS')
    expect(GUIDE).toContain('twit contacts --json')
    // 환경변수는 프로세스별로 상속되므로 각 실행 환경에서 확인하는 절차
    expect(GUIDE).toMatch(/프로세스별로 상속/)
    expect(GUIDE).toMatch(/자기 실행 환경에서 `twit contacts --json`/)
    expect(GUIDE).toContain('ACTOR_NOT_CONFIGURED')
  })

  it('자기 이름 고르기 규칙을 담는다', () => {
    expect(GUIDE).toMatch(/제품명과 맞는 항목을 고른다/)
    expect(GUIDE).toMatch(/둘 이상이면 사람에게 묻는다/)
    expect(GUIDE).toMatch(/사람이 .* 이름을 지정하면 그것을 우선/)
    expect(GUIDE).toMatch(/임의의 새 이름을 만들지 않는다/)
  })

  it('이름 지정 문법을 담는다', () => {
    expect(GUIDE).toContain('--as <이름>')
    expect(GUIDE).toContain('--from')
    expect(GUIDE).toContain('--to')
    expect(GUIDE).toContain('twit send --from')
  })

  it('세션 규칙을 담는다', () => {
    expect(GUIDE).toContain('twit inbox --as <이름> --json')
    expect(GUIDE).toContain('--unread')
    expect(GUIDE).toContain('twit read')
    expect(GUIDE).toContain('twit reply')
    expect(GUIDE).toContain('twit archive')
    expect(GUIDE).toContain('twit read --unread --as <이름>')
    // 읽은 메시지도 기본 인박스에 포함된다는 안내
    expect(GUIDE).toMatch(/읽었지만 보관하지 않은 메시지도 포함/)
    // 보관은 완료가 아니다
    expect(GUIDE).toMatch(/보관.*(완료|수락).*해석하지 않/)
    // 회신 필요 여부 명시
    expect(GUIDE).toContain('회신 불필요')
    expect(GUIDE).toContain('확인 답장 요청')
  })

  it('요청 작성 예시를 담는다', () => {
    expect(GUIDE).toContain('작업 위치: /')
    expect(GUIDE).toMatch(/답장 형식/)
  })

  it('긴 문서·폴더 전달 안내를 담는다', () => {
    expect(GUIDE).toContain('--body-file')
    expect(GUIDE).toContain('문서 폴더:')
    expect(GUIDE).toContain('시작 문서:')
    expect(GUIDE).toContain('읽을 범위:')
    // 본문 저장과 경로 참조의 시점 차이
    expect(GUIDE).toMatch(/전송 시점/)
    expect(GUIDE).toMatch(/읽는 시점/)
  })

  it('긴 대화 확인과 일괄 읽기 주의를 담는다', () => {
    expect(GUIDE).toContain('twit thread M-001 --no-body')
    expect(GUIDE).toMatch(/여러 건을 한 번에 읽으면 본문이 그만큼 출력/)
  })

  it('결과 답장 예시를 담는다', () => {
    expect(GUIDE).toContain('변경 요약')
    expect(GUIDE).toContain('커밋')
    expect(GUIDE).toContain('검증')
    expect(GUIDE).toContain('남은 사항')
  })

  it('중복 방지 안내를 담는다', () => {
    expect(GUIDE).toContain('--request-id')
    expect(GUIDE).toContain('replayed: true')
    expect(GUIDE).toContain('REQUEST_ID_CONFLICT')
  })

  it('한계를 담는다', () => {
    expect(GUIDE).toMatch(/깨우지 않/)
    expect(GUIDE).toMatch(/중복 수행/)
  })

  it('에이전트 지침 파일 적용 위치를 안내한다', () => {
    expect(GUIDE).toContain('CLAUDE.md')
    expect(GUIDE).toContain('AGENTS.md')
    expect(GUIDE).toContain('OpenCode')
    // 붙여 넣기용 절과 사람이 읽는 설명이 나뉜다
    expect(GUIDE).toContain('붙여 넣기용')
  })

  it('README에 Node 24 요구와 설치 절차를 담는다', () => {
    expect(ROOT_README).toMatch(/Node\.js 24/)
    expect(ROOT_README).toContain('npm install && npm run build && npm link')
    expect(ROOT_README).toContain('TWIT_CONTACTS')
  })

  it('사람은 twit ui로 전체를 보고 에이전트는 쓰지 않는다고 안내한다', () => {
    expect(GUIDE).toContain('twit ui')
    expect(GUIDE).toMatch(/에이전트는.*쓰지/)
    expect(ROOT_README).toContain('twit ui')
  })
})
