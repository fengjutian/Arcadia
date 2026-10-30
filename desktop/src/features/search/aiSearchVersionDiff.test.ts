import { describe, expect, it } from 'vitest'
import { compareAnswerVersions } from './aiSearchVersionDiff'

describe('AI search version diff', () => {
  it('marks added and removed lines while retaining common context', () => {
    const diff = compareAnswerVersions({
      previousAnswer:'# 结论\n旧内容\n共同内容',
      currentAnswer:'# 结论\n新内容\n共同内容',
      previousSourceUrls:['https://a.test'],
      currentSourceUrls:['https://b.test'],
    })
    expect(diff.previous).toContainEqual({ text:'旧内容', status:'removed' })
    expect(diff.current).toContainEqual({ text:'新内容', status:'added' })
    expect(diff.current).toContainEqual({ text:'共同内容', status:'same' })
    expect(diff.addedSources).toEqual(['https://b.test'])
    expect(diff.removedSources).toEqual(['https://a.test'])
  })

  it('bounds comparison size for model-generated long answers', () => {
    const long = Array.from({ length:500 }, (_, index) => `line ${index}`).join('\n')
    const diff = compareAnswerVersions({ previousAnswer:long, currentAnswer:long, previousSourceUrls:[], currentSourceUrls:[], maxLines:40 })
    expect(diff.previous).toHaveLength(40)
    expect(diff.current).toHaveLength(40)
    expect(diff.addedLines).toBe(0)
  })
})
