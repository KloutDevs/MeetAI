// backend/src/services/meetingCompletion.ts
import { db } from '../db/client.js'
import { transcriptSegments } from '../db/schema.js'
import { wordsToSegments, mergeTracks } from './merger.js'
import type { DeepgramWord } from '../types.js'

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'timeout'])

export async function checkMeetingCompletion(meetingId: string): Promise<void> {
  const jobs = await db.query.transcriptionJobs.findMany({
    where: (t, { eq }) => eq(t.meetingId, meetingId)
  })

  const allTerminal = jobs.every((job) => TERMINAL_STATUSES.has(job.status))
  if (!allTerminal) return

  const tracks = jobs
    .filter((job) => job.status === 'completed' && job.words)
    .map((job) => {
      try {
        const words = JSON.parse(job.words as string) as DeepgramWord[]
        return wordsToSegments(words, job.participantId)
      } catch (err) {
        console.error(
          `Failed to parse words for transcription job (meetingId=${meetingId}, participantId=${job.participantId}): ${err instanceof Error ? err.message : String(err)}`
        )
        return []
      }
    })

  const merged = mergeTracks(tracks)
  if (merged.length === 0) return

  await db.insert(transcriptSegments).values(
    merged.map((segment) => ({
      meetingId,
      speakerId: segment.speakerId,
      start: segment.start,
      end: segment.end,
      text: segment.text
    }))
  )
}
