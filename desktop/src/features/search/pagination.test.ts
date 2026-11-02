import { describe, expect, it } from 'vitest'
import { pageWindow } from './pagination'

describe('pageWindow', () => {
  it('reports an empty window without inventing rows', () => {
    expect(pageWindow(0, 1, 12)).toEqual({ page: 1, pageCount: 1, start: 0, end: 0, pages: [1] })
  })

  it('spans the first page of a partially filled list', () => {
    expect(pageWindow(6, 1, 12)).toMatchObject({ page: 1, pageCount: 1, start: 1, end: 6, pages: [1] })
  })

  it('slices the middle and the last page of a 30 row list', () => {
    expect(pageWindow(30, 2, 12)).toMatchObject({ page: 2, pageCount: 3, start: 13, end: 24 })
    expect(pageWindow(30, 3, 12)).toMatchObject({ page: 3, pageCount: 3, start: 25, end: 30 })
  })

  it('clamps a page that no longer exists after rows were removed', () => {
    expect(pageWindow(5, 9, 12)).toMatchObject({ page: 1, pageCount: 1, start: 1, end: 5 })
  })

  it('keeps the current page inside a sliding window', () => {
    expect(pageWindow(500, 1, 12).pages).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(pageWindow(500, 20, 12).pages).toEqual([17, 18, 19, 20, 21, 22, 23])
    expect(pageWindow(500, 42, 12).pages).toEqual([36, 37, 38, 39, 40, 41, 42])
  })

  it('never slices on a zero or fractional page size', () => {
    expect(pageWindow(10, 1, 0)).toMatchObject({ page: 1, pageCount: 10, start: 1, end: 1 })
    expect(pageWindow(10, 1, 2.7)).toMatchObject({ page: 1, pageCount: 5, start: 1, end: 2 })
  })
})
