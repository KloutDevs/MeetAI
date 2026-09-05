// backend/src/routes/retrySummary.ts
import type { FastifyInstance } from 'fastify'
import { db } from '../db/client.js'
import { generateMeetingSummary } from '../services/llmSummary.js'
import { wordsToSegments, mergeTracks } from '../services/merger.js'
import type { DeepgramWord } from '../types.js'

interface MeetingParams { id: string }

export function registerRetrySummaryRoute(app: FastifyInstance): void {
  app.post<{ Params: MeetingParams }>('/meetings/:id/retry-summary', async (request, reply) => {
    const meetingId = request.params.id

    const meeting = await db.query.meetings.findFirst({ where: (m, { eq }) => eq(m.id, meetingId) })
    if (!meeting) {
      return reply.code(404).send({ error: 'not_found' })
    }

    const jobs = await db.query.transcriptionJobs.findMany({
      where: (j, { eq }) => eq(j.meetingId, meetingId)
    })

    const tracks = jobs
      .filter((job) => job.status === 'completed' && job.words)
      .map((job) => wordsToSegments(JSON.parse(job.words as string) as DeepgramWord[], job.participantId))

    const merged = mergeTracks(tracks)

    if (merged.length === 0) {
      return reply.code(400).send({ error: 'no_transcript', message: 'No hay transcripción disponible todavía para generar un resumen.' })
    }

    // Awaited (unlike the automatic fire-and-forget trigger) because this is
    // a manual, user-initiated action expecting an immediate result.
    await generateMeetingSummary(meetingId, merged)

    const summary = await db.query.summaries.findFirst({ where: (s, { eq }) => eq(s.meetingId, meetingId) })

    return reply.code(200).send({ status: summary?.status ?? 'failed' })
  })
}
