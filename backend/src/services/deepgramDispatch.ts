// backend/src/services/deepgramDispatch.ts
import { db } from '../db/client.js'
import { transcriptionJobs } from '../db/schema.js'

interface DispatchParams {
  meetingId: string
  trackId: string
  participantId: string
  trackUrl: string
  callbackBaseUrl: string
}

export async function dispatchTrackForTranscription(params: DispatchParams): Promise<void> {
  const { meetingId, trackId, participantId, trackUrl, callbackBaseUrl } = params

  const apiKey = process.env.DEEPGRAM_API_KEY
  if (!apiKey) {
    throw new Error('DEEPGRAM_API_KEY environment variable is not set')
  }

  const callbackUrl = `${callbackBaseUrl}/webhooks/deepgram?meetingId=${meetingId}&trackId=${trackId}`

  const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-3', {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url: trackUrl,
      callback: callbackUrl
    })
  })

  if (!response.ok) {
    throw new Error(`Deepgram dispatch failed for track ${trackId}: ${response.status}`)
  }

  const responseBody = await response.json() as { request_id?: unknown }
  const deepgramRequestId = responseBody.request_id

  if (typeof deepgramRequestId !== 'string') {
    throw new Error(`Deepgram response missing request_id for track ${trackId}`)
  }

  await db.insert(transcriptionJobs).values({
    meetingId,
    trackId,
    participantId,
    deepgramRequestId,
    status: 'pending'
  })
}
