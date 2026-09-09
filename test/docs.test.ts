import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const GUIDE = readFileSync(
  fileURLToPath(new URL('../docs/05-agent-usage-guide.md', import.meta.url)),
  'utf8',
)

describe('에이전트용 사용 가이드', () => {
  it('설정 안내를 담는다', () => {
    expect(GUIDE).toContain('TWIT_ACTOR')
    expect(GUIDE).toContain('twit whoami')
    expect(GUIDE).toContain('twit contacts')
    expect(GUIDE).toContain('ACTOR_NOT_CONFIGURED')
  })

  it('세션 규칙을 담는다', () => {
    expect(GUIDE).toContain('twit inbox --json')
    expect(GUIDE).toContain('twit inbox --unread')
    expect(GUIDE).toContain('twit read')
    expect(GUIDE).toContain('twit reply')
    expect(GUIDE).toContain('twit archive')
    // 읽은 메시지도 기본 인박스에 포함된다는 안내
    expect(GUIDE).toMatch(/읽었지만 보관하지 않은 메시지도 포함/)
    // 보관은 완료가 아니다
    expect(GUIDE).toMatch(/보관.*(완료|수락).*해석하지 않/)
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

  it('긴 대화 확인 안내를 담는다', () => {
    expect(GUIDE).toContain('twit thread M-001 --no-body')
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
})
