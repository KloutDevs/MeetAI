import { describe, it, expect } from 'vitest'
import { wordsToSegments, mergeTracks } from '../src/services/merger.js'
import type { DeepgramWord, TranscriptSegment } from '../src/types.js'

describe('wordsToSegments', () => {
  it('groups consecutive words into one segment when gaps are small', () => {
    const words: DeepgramWord[] = [
      { word: 'hola', start: 0.0, end: 0.3, confidence: 0.99 },
      { word: 'como', start: 0.4, end: 0.7, confidence: 0.98 },
      { word: 'estas', start: 0.8, end: 1.2, confidence: 0.97 }
    ]

    const segments = wordsToSegments(words, 'speaker-1')

    expect(segments).toEqual([
      { speakerId: 'speaker-1', start: 0.0, end: 1.2, text: 'hola como estas' }
    ])
  })

  it('splits into a new segment when the gap exceeds the pause threshold', () => {
    const words: DeepgramWord[] = [
      { word: 'hola', start: 0.0, end: 0.3, confidence: 0.99 },
      { word: 'bueno', start: 3.0, end: 3.4, confidence: 0.95 }
    ]

    const segments = wordsToSegments(words, 'speaker-1')

    expect(segments).toEqual([
      { speakerId: 'speaker-1', start: 0.0, end: 0.3, text: 'hola' },
      { speakerId: 'speaker-1', start: 3.0, end: 3.4, text: 'bueno' }
    ])
  })

  it('returns an empty array for no words', () => {
    expect(wordsToSegments([], 'speaker-1')).toEqual([])
  })
})

describe('mergeTracks', () => {
  it('merges segments from multiple tracks ordered by start time', () => {
    const trackA: TranscriptSegment[] = [
      { speakerId: 'A', start: 0.0, end: 1.0, text: 'hola' },
      { speakerId: 'A', start: 5.0, end: 6.0, text: 'chau' }
    ]
    const trackB: TranscriptSegment[] = [
      { speakerId: 'B', start: 1.5, end: 2.5, text: 'que tal' }
    ]

    const merged = mergeTracks([trackA, trackB])

    expect(merged).toEqual([
      { speakerId: 'A', start: 0.0, end: 1.0, text: 'hola' },
      { speakerId: 'B', start: 1.5, end: 2.5, text: 'que tal' },
      { speakerId: 'A', start: 5.0, end: 6.0, text: 'chau' }
    ])
  })

  it('returns an empty array when there are no tracks', () => {
    expect(mergeTracks([])).toEqual([])
  })
})
