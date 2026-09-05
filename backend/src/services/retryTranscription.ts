// backend/src/services/retryTranscription.ts
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { transcriptionJobs } from '../db/schema.js'
import { dispatchTrackForTranscription } from './deepgramDispatch.js'

function trackUrlFor(meetingId: string, participantId: string): string {
  const publicUrl = process.env.S3_PUBLIC_URL!
  return `${publicUrl}/${meetingId}/${participantId}.ogg`
}

// Redispatches transcription to Deepgram for every participant of a meeting
// whose track never reached a 'completed' job — covers the case where
// LiveKit's egress already uploaded the audio to S3, but the Deepgram
// dispatch call itself failed (e.g. before this bug was fixed) and no
// callback was ever going to arrive to move things forward on its own.
export async function retryMeetingTranscription(meetingId: string, participantIds: string[]): Promise<{ retried: string[] }> {
  const retried: string[] = []

  for (const participantId of participantIds) {
    const trackId = `${meetingId}/${participantId}.ogg`

    const existingJob = await db.query.transcriptionJobs.findFirst({
      where: (j, { eq: eqFn, and: andFn }) => andFn(eqFn(j.meetingId, meetingId), eqFn(j.trackId, trackId))
    })

    if (existingJob?.status === 'completed') {
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
  }

  return { retried }
}
