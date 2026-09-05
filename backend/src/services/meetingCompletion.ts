// backend/src/services/meetingCompletion.ts
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { transcriptSegments } from '../db/schema.js'
import { wordsToSegments, mergeTracks } from './merger.js'
import { generateMeetingSummary } from './llmSummary.js'
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

  // Idempotency: a late/retried callback (e.g. a track that already timed out)
  // can trigger this function again for the same meeting. Delete any
  // previously persisted segments before re-inserting so repeated calls
  // converge to the same final state instead of accumulating duplicates.
  await db.transaction(async (tx) => {
    await tx.delete(transcriptSegments).where(eq(transcriptSegments.meetingId, meetingId))

    if (merged.length === 0) return

    await tx.insert(transcriptSegments).values(
      merged.map((segment) => ({
        meetingId,
        speakerId: segment.speakerId,
        start: segment.start,
        end: segment.end,
        text: segment.text
      }))
    )
  })

  if (merged.length === 0) return

  generateMeetingSummary(meetingId, merged).catch((err) => {
    console.error(`Failed to generate summary for meeting ${meetingId}: ${err instanceof Error ? err.message : String(err)}`)
  })
}
