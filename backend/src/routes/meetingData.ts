// backend/src/routes/meetingData.ts
import type { FastifyInstance } from 'fastify'
import { db } from '../db/client.js'

interface MeetingParams { id: string }

export function registerMeetingDataRoute(app: FastifyInstance): void {
  app.get<{ Params: MeetingParams }>('/meetings/:id/full', async (request, reply) => {
    const meetingId = request.params.id

    const meeting = await db.query.meetings.findFirst({ where: (m, { eq }) => eq(m.id, meetingId) })
    if (!meeting) {
      return reply.code(404).send({ error: 'not_found' })
    }

    const [participants, transcriptSegments, chapters, highlights, proposedTasks, transcriptionJobs, summary] = await Promise.all([
      db.query.participants.findMany({ where: (p, { eq }) => eq(p.meetingId, meetingId) }),
      db.query.transcriptSegments.findMany({ where: (s, { eq }) => eq(s.meetingId, meetingId) }),
      db.query.chapters.findMany({ where: (c, { eq }) => eq(c.meetingId, meetingId) }),
      db.query.highlights.findMany({ where: (h, { eq }) => eq(h.meetingId, meetingId) }),
      db.query.proposedTasks.findMany({ where: (t, { eq }) => eq(t.meetingId, meetingId) }),
      db.query.transcriptionJobs.findMany({ where: (j, { eq }) => eq(j.meetingId, meetingId) }),
      db.query.summaries.findFirst({ where: (s, { eq }) => eq(s.meetingId, meetingId) })
    ])

    return reply.code(200).send({
      meeting: { id: meeting.id, title: meeting.title },
      participants: participants.map((p) => ({ id: p.id, name: p.name })),
      tracks: transcriptionJobs.map((j) => ({ participantId: j.participantId, url: j.trackUrl })),
      transcriptSegments: transcriptSegments.map((s) => ({ speakerId: s.speakerId, start: s.start, end: s.end, text: s.text })),
      chapters: chapters.map((c) => ({ title: c.title, start: c.start, end: c.end })),
      highlights: highlights.map((h) => ({ type: h.type, timestamp: h.timestamp, quote: h.quote })),
      summary: summary ? { context: summary.context, keyPoints: summary.keyPoints, status: summary.status } : null,
      proposedTasks: proposedTasks.map((t) => ({
        id: t.id,
        description: t.description,
        status: t.status,
        assignee: t.assignee,
        sourceSpeakerId: t.sourceSpeakerId,
        sourceTimestamp: t.sourceTimestamp,
        sourceQuote: t.sourceQuote
      }))
    })
  })
}
