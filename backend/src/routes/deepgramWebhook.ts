// backend/src/routes/deepgramWebhook.ts
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { transcriptionJobs } from '../db/schema.js'
import { checkMeetingCompletion } from '../services/meetingCompletion.js'

interface DeepgramCallbackBody {
  results: {
    channels: Array<{
      alternatives: Array<{
        words: Array<{ word: string; start: number; end: number; confidence: number }>
      }>
    }>
  }
}

interface DeepgramCallbackQuery {
  meetingId: string
  trackId: string
}

export function registerDeepgramWebhookRoute(app: FastifyInstance): void {
  app.post<{ Body: DeepgramCallbackBody; Querystring: DeepgramCallbackQuery }>(
    '/webhooks/deepgram',
    async (request, reply) => {
      const { meetingId, trackId } = request.query

      const job = await db.query.transcriptionJobs.findFirst({
        where: (jobs, { eq: eqFn, and }) => and(eqFn(jobs.meetingId, meetingId), eqFn(jobs.trackId, trackId))
      })

      if (!job || job.status === 'completed') {
        return reply.code(200).send({ received: true })
      }

      const words = request.body.results.channels[0]?.alternatives[0]?.words ?? []

      await db.update(transcriptionJobs)
        .set({ status: 'completed', words: JSON.stringify(words) })
        .where(eq(transcriptionJobs.id, job.id))

      await checkMeetingCompletion(meetingId)

      return reply.code(200).send({ received: true })
    }
  )
}
