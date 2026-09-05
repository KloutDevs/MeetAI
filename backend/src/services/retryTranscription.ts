// backend/src/services/retryTranscription.ts
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { transcriptionJobs } from '../db/schema.js'
import { dispatchTrackForTranscription } from './deepgramDispatch.js'

function trackUrlFor(meetingId: string, participantId: string): string {
  const publicUrl = process.env.S3_PUBLIC_URL!
  return `${publicUrl}/${meetingId}/${participantId}.ogg`
}

// A job can be 'completed' with an empty transcript (e.g. the language-
// detection bug that made Deepgram silently return `words: []` for
// non-English speech) — that is NOT a real success and must still be
// retried, unlike a job that's 'completed' with actual words.
function hasUsableTranscript(words: string | null): boolean {
  if (!words) return false
  try {
    const parsed = JSON.parse(words)
    return Array.isArray(parsed) && parsed.length > 0
  } catch {
    return false
  }
}

// Redispatches transcription to Deepgram for every participant of a meeting
// whose track never reached a 'completed' job — covers the case where
// LiveKit's egress already uploaded the audio to S3, but the Deepgram
// dispatch call itself failed (e.g. before this bug was fixed) and no
// callback was ever going to arrive to move things forward on its own.
//
// A participant can legitimately have no audio at all (e.g. they opened the
// join link twice and only one of the two sessions ever published a track).
// Retrying one participant must never abort the others — each attempt is
// isolated so one missing/broken track doesn't silently block the rest of
// the meeting from being retried.
export async function retryMeetingTranscription(
  meetingId: string,
  participantIds: string[]
): Promise<{ retried: string[]; failed: Array<{ participantId: string; error: string }> }> {
  const retried: string[] = []
  const failed: Array<{ participantId: string; error: string }> = []

  for (const participantId of participantIds) {
    const trackId = `${meetingId}/${participantId}.ogg`

    try {
      const existingJob = await db.query.transcriptionJobs.findFirst({
        where: (j, { eq: eqFn, and: andFn }) => andFn(eqFn(j.meetingId, meetingId), eqFn(j.trackId, trackId))
      })

      if (existingJob?.status === 'completed' && hasUsableTranscript(existingJob.words)) {
        continue
      }

      if (existingJob) {
        await db.delete(transcriptionJobs).where(eq(transcriptionJobs.id, existingJob.id))
      }

      await dispatchTrackForTranscription({
        meetingId,
        trackId,
        participantId,
        trackUrl: trackUrlFor(meetingId, participantId),
        callbackBaseUrl: process.env.BACKEND_PUBLIC_URL!
      })

      retried.push(participantId)
    } catch (err) {
      failed.push({ participantId, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return { retried, failed }
}
