import type { TranscriptSegment } from '../types.js'

export function formatTranscriptForPrompt(segments: TranscriptSegment[]): string {
  return segments.map((segment) => `[${formatTimestamp(segment.start)}] ${segment.speakerId}: ${segment.text}`).join('\n')
}

function formatTimestamp(seconds: number): string {
  const totalSeconds = Math.floor(seconds)
  const minutes = Math.floor(totalSeconds / 60)
  const secs = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}
