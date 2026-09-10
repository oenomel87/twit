import { describe, expect, it } from 'vitest'
import { preview } from '../src/core/preview.js'

describe('preview', () => {
  it('공백이 아닌 첫 줄을 고르고 앞뒤 공백을 제거한다', () => {
    expect(preview('\n\n  \n   작업 위치: /workspace/example\n둘째 줄\n')).toBe('작업 위치: /workspace/example')
    expect(preview('\r\n\r\n   들여쓴 첫 줄  \r\n둘째\r\n')).toBe('들여쓴 첫 줄')
  })

  it('한 줄뿐인 본문은 그대로 나온다', () => {
    expect(preview('짧은 본문')).toBe('짧은 본문')
    expect(preview('   ')).toBe('')
    expect(preview('')).toBe('')
  })

  it('79·80·81자 경계를 지킨다', () => {
    const c79 = '가'.repeat(79)
    const c80 = '가'.repeat(80)
    const c81 = '가'.repeat(81)
    expect(preview(c79)).toBe(c79)
    expect(preview(c80)).toBe(c80) // 정확히 80개면 생략 부호 없이
    expect(preview(c81)).toBe(c80 + '…')
  })

  it('한글과 이모지를 코드 포인트로 센다', () => {
    const body = `${'나'.repeat(78)}👍👍끝`
    // 78 + 2 + 1 = 81 코드 포인트. 앞 80개는 '나' 78개 + 이모지 2개
    expect(preview(body)).toBe('나'.repeat(78) + '👍👍' + '…')
    expect([...preview(body)].length).toBe(81)
  })

  it('Markdown 기호를 해석하지 않는다', () => {
    expect(preview('# 제목\n본문')).toBe('# 제목')
  })
})
