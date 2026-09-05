import type { DeepgramWord, TranscriptSegment } from '../types.js'

export function wordsToSegments(
  words: DeepgramWord[],
  speakerId: string,
  pauseThresholdSec = 1.5
): TranscriptSegment[] {
  if (words.length === 0) return []

  const segments: TranscriptSegment[] = []
  let currentWords: DeepgramWord[] = [words[0]]

  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1]
    const curr = words[i]
    const gap = curr.start - prev.end

    if (gap > pauseThresholdSec) {
      segments.push(buildSegment(currentWords, speakerId))
      currentWords = [curr]
    } else {
      currentWords.push(curr)
    }
  }

  segments.push(buildSegment(currentWords, speakerId))
  return segments
}

function buildSegment(words: DeepgramWord[], speakerId: string): TranscriptSegment {
  return {
    speakerId,
    start: words[0].start,
    end: words[words.length - 1].end,
    text: words.map((w) => w.word).join(' ')
  }
}

export function mergeTracks(tracks: TranscriptSegment[][]): TranscriptSegment[] {
  return tracks.flat().sort((a, b) => a.start - b.start)
}
