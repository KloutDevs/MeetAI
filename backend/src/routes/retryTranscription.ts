// backend/src/routes/retryTranscription.ts
import type { FastifyInstance } from 'fastify'
import { db } from '../db/client.js'
import { retryMeetingTranscription } from '../services/retryTranscription.js'

interface MeetingParams { id: string }
interface RetryBody { force?: boolean }

export function registerRetryTranscriptionRoute(app: FastifyInstance): void {
  app.post<{ Params: MeetingParams; Body: RetryBody }>('/meetings/:id/retry-transcription', async (request, reply) => {
    const meetingId = request.params.id

    const meeting = await db.query.meetings.findFirst({ where: (m, { eq }) => eq(m.id, meetingId) })
    if (!meeting) {
      return reply.code(404).send({ error: 'not_found' })
    }

    const participants = await db.query.participants.findMany({ where: (p, { eq }) => eq(p.meetingId, meetingId) })
    const result = await retryMeetingTranscription(meetingId, participants.map((p) => p.id), { force: request.body?.force === true })

    return reply.code(200).send(result)
  })
}
