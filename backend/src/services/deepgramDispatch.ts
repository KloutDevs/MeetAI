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

  const callbackUrl = `${callbackBaseUrl}/webhooks/deepgram?meetingId=${encodeURIComponent(meetingId)}&trackId=${encodeURIComponent(trackId)}`

  // Deepgram's async callback mode requires `callback` as a query parameter
  // on the request URL, not as a field in the JSON body — passing it in the
  // body causes Deepgram to silently ignore it and process synchronously
  // instead, returning full transcription results immediately (with
  // request_id nested under `metadata`) rather than the async ack shape
  // (`{ request_id }` at the top level) that the rest of this pipeline
  // depends on to correlate the later webhook callback.
  // language=es pins Spanish recognition explicitly — without a language
  // param, nova-3 defaults to English-only and silently returns an empty
  // transcript for non-English speech. Tested against real audio against
  // language=multi (auto-detect) too; explicit `es` produced a more accurate
  // transcript for this project's target audience (meetings in Spanish).
  const deepgramUrl = `https://api.deepgram.com/v1/listen?model=nova-3&language=es&callback=${encodeURIComponent(callbackUrl)}`

  const response = await fetch(deepgramUrl, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ url: trackUrl })
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
    trackUrl,
    participantId,
    deepgramRequestId,
    status: 'pending'
  })
}
