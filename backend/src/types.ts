export interface DeepgramWord {
  word: string
  start: number
  end: number
  confidence: number
}

export interface TranscriptSegment {
  speakerId: string
  start: number
  end: number
  text: string
}

export type JobStatus = 'pending' | 'completed' | 'failed' | 'timeout'
