export type DiffStatus = 'same' | 'added' | 'removed'
export interface DiffLine { text: string; status: DiffStatus }

export interface AnswerVersionDiff {
  previous: DiffLine[]
  current: DiffLine[]
  addedLines: number
  removedLines: number
  addedSources: string[]
  removedSources: string[]
}

export function compareAnswerVersions(input: {
  previousAnswer: string
  currentAnswer: string
  previousSourceUrls: readonly string[]
  currentSourceUrls: readonly string[]
  maxLines?: number
}): AnswerVersionDiff {
  const maxLines = Math.max(20, Math.min(input.maxLines ?? 180, 300))
  const previousLines = normalizedLines(input.previousAnswer).slice(0, maxLines)
  const currentLines = normalizedLines(input.currentAnswer).slice(0, maxLines)
  const matrix = lcsMatrix(previousLines, currentLines)
  const previous: DiffLine[] = []
  const current: DiffLine[] = []
  let left = previousLines.length
  let right = currentLines.length

  while (left > 0 || right > 0) {
    if (left > 0 && right > 0 && previousLines[left - 1] === currentLines[right - 1]) {
      previous.push({ text:previousLines[left - 1], status:'same' })
      current.push({ text:currentLines[right - 1], status:'same' })
      left -= 1
      right -= 1
    } else if (right > 0 && (left === 0 || matrix[left][right - 1] >= matrix[left - 1][right])) {
      current.push({ text:currentLines[right - 1], status:'added' })
      right -= 1
    } else {
      previous.push({ text:previousLines[left - 1], status:'removed' })
      left -= 1
    }
  }

  previous.reverse()
  current.reverse()
  const previousSources = new Set(input.previousSourceUrls)
  const currentSources = new Set(input.currentSourceUrls)
  return {
    previous,
    current,
    addedLines:current.filter(line => line.status === 'added').length,
    removedLines:previous.filter(line => line.status === 'removed').length,
    addedSources:Array.from(currentSources).filter(url => !previousSources.has(url)),
    removedSources:Array.from(previousSources).filter(url => !currentSources.has(url)),
  }
}

function normalizedLines(markdown: string): string[] {
  return markdown.replace(/\r\n?/g, '\n').split('\n').map(line => line.trimEnd()).filter((line, index, all) => line.trim() || (index > 0 && all[index - 1].trim()))
}

function lcsMatrix(left: readonly string[], right: readonly string[]): number[][] {
  const matrix = Array.from({ length:left.length + 1 }, () => Array<number>(right.length + 1).fill(0))
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      matrix[i][j] = left[i - 1] === right[j - 1] ? matrix[i - 1][j - 1] + 1 : Math.max(matrix[i - 1][j], matrix[i][j - 1])
    }
  }
  return matrix
}
