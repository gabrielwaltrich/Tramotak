import { describe, expect, it } from 'vitest'
import { contentTypeFor, parseRange } from '../../src/main/protocol/range'

describe('parseRange', () => {
  it.each([
    [null, null],
    ['bytes=0-', { start: 0, end: 999 }],
    ['bytes=0-99', { start: 0, end: 99 }],
    ['bytes=500-5000', { start: 500, end: 999 }],
    ['bytes=-100', { start: 900, end: 999 }],
    ['bytes=-5000', { start: 0, end: 999 }],
    ['bytes=0-10, 20-30', { start: 0, end: 10 }],
    ['bytes=1000-', 'invalid'],
    ['bytes=50-10', 'invalid'],
    ['bytes=-0', 'invalid'],
    ['bytes=-', 'invalid'],
    ['items=0-1', 'invalid']
  ] as const)('%s', (header, expected) => {
    expect(parseRange(header, 1000)).toEqual(expected)
  })
})

describe('contentTypeFor', () => {
  it('mapeia vídeos, legendas e desconhecidos', () => {
    expect(contentTypeFor('a/Aula.MP4')).toBe('video/mp4')
    expect(contentTypeFor('a.srt')).toBe('text/vtt; charset=utf-8')
    expect(contentTypeFor('a.xyz')).toBe('application/octet-stream')
  })
})
