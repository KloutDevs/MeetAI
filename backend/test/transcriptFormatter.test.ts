import { describe, it, expect } from 'vitest'
import { formatTranscriptForPrompt } from '../src/services/transcriptFormatter.js'
import type { TranscriptSegment } from '../src/types.js'

describe('formatTranscriptForPrompt', () => {
  it('formats segments as [mm:ss] speakerId: text, one per line', () => {
    const segments: TranscriptSegment[] = [
      { speakerId: 'p1', start: 0, end: 2, text: 'hola equipo' },
      { speakerId: 'p2', start: 65, end: 68, text: 'buenas' }
    ]

    const result = formatTranscriptForPrompt(segments)

    expect(result).toBe('[00:00] p1: hola equipo\n[01:05] p2: buenas')
  })

  it('returns an empty string for no segments', () => {
    expect(formatTranscriptForPrompt([])).toBe('')
  })
})
