import { describe, it, expect } from 'vitest'
import { wordsToSegments } from '../src/services/merger.js'
import type { DeepgramWord } from '../src/types.js'

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
