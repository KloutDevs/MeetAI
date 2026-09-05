// backend/test/meetingData.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findFirstMocks: Record<string, ReturnType<typeof vi.fn>> = {
  meetings: vi.fn(),
  summaries: vi.fn()
}
const findManyMocks: Record<string, ReturnType<typeof vi.fn>> = {
  participants: vi.fn(),
  transcriptSegments: vi.fn(),
  chapters: vi.fn(),
  highlights: vi.fn(),
  proposedTasks: vi.fn(),
  transcriptionJobs: vi.fn()
}

vi.mock('../src/db/client.js', () => ({
  db: {
    query: {
      meetings: { findFirst: (...args: unknown[]) => findFirstMocks.meetings(...args) },
      summaries: { findFirst: (...args: unknown[]) => findFirstMocks.summaries(...args) },
      participants: { findMany: (...args: unknown[]) => findManyMocks.participants(...args) },
      transcriptSegments: { findMany: (...args: unknown[]) => findManyMocks.transcriptSegments(...args) },
      chapters: { findMany: (...args: unknown[]) => findManyMocks.chapters(...args) },
      highlights: { findMany: (...args: unknown[]) => findManyMocks.highlights(...args) },
      proposedTasks: { findMany: (...args: unknown[]) => findManyMocks.proposedTasks(...args) },
      transcriptionJobs: { findMany: (...args: unknown[]) => findManyMocks.transcriptionJobs(...args) }
    }
  }
}))

const { buildServer } = await import('../src/server.js')

describe('GET /meetings/:id/full', () => {
  beforeEach(() => {
    Object.values(findFirstMocks).forEach((m) => m.mockReset())
    Object.values(findManyMocks).forEach((m) => m.mockReset())
  })

  it('aggregates all meeting data into one payload', async () => {
    const startedAt = new Date('2026-01-01T09:00:00Z')
    const endedAt = new Date('2026-01-01T10:00:00Z')
    findFirstMocks.meetings.mockResolvedValue({
      id: 'meeting-1',
      title: 'Weekly sync',
      startedAt,
      endedAt,
      recordingUrl: 'https://cdn.example.com/meeting-1/recording.mp4'
    })
    findFirstMocks.summaries.mockResolvedValue({ context: 'ctx', keyPoints: 'points', status: 'completed' })
    findManyMocks.participants.mockResolvedValue([{ id: 'p1', name: 'Ada' }])
    findManyMocks.transcriptSegments.mockResolvedValue([{ speakerId: 'p1', start: 0, end: 2, text: 'hola' }])
    findManyMocks.chapters.mockResolvedValue([{ title: 'Intro', start: 0, end: 30 }])
    findManyMocks.highlights.mockResolvedValue([{ type: 'question', timestamp: 12, quote: '¿cuándo?' }])
    findManyMocks.proposedTasks.mockResolvedValue([{ id: 'pt1', description: 'enviar informe', status: 'pendiente', assignee: null, sourceSpeakerId: 'p1', sourceTimestamp: 5, sourceQuote: 'hay que enviarlo' }])
    const dispatchedAt = new Date('2026-01-01T10:00:00Z')
    findManyMocks.transcriptionJobs.mockResolvedValue([{ participantId: 'p1', trackId: 'p1.ogg', trackUrl: 'https://bucket.s3.amazonaws.com/p1.ogg', status: 'completed', createdAt: dispatchedAt }])

    const app = buildServer()
    const response = await app.inject({ method: 'GET', url: '/meetings/meeting-1/full' })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.meeting).toEqual({
      id: 'meeting-1',
      title: 'Weekly sync',
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      recordingUrl: 'https://cdn.example.com/meeting-1/recording.mp4'
    })
    expect(body.participants).toEqual([{ id: 'p1', name: 'Ada' }])
    expect(body.tracks).toEqual([{ participantId: 'p1', url: 'https://bucket.s3.amazonaws.com/p1.ogg' }])
    expect(body.transcriptionJobs).toEqual([{
      trackId: 'p1.ogg',
      participantId: 'p1',
      status: 'completed',
      dispatchedAt: dispatchedAt.toISOString()
    }])
    expect(body.transcriptSegments).toHaveLength(1)
    expect(body.chapters).toHaveLength(1)
    expect(body.highlights).toHaveLength(1)
    expect(body.summary).toEqual({ context: 'ctx', keyPoints: 'points', status: 'completed' })
    expect(body.proposedTasks).toHaveLength(1)
  })

  it('returns 404 when the meeting does not exist', async () => {
    findFirstMocks.meetings.mockResolvedValue(undefined)

    const app = buildServer()
    const response = await app.inject({ method: 'GET', url: '/meetings/missing/full' })

    expect(response.statusCode).toBe(404)
  })

  it('returns summary: null when no summary exists yet', async () => {
    findFirstMocks.meetings.mockResolvedValue({ id: 'meeting-1', title: 'Weekly sync' })
    findFirstMocks.summaries.mockResolvedValue(undefined)
    findManyMocks.participants.mockResolvedValue([])
    findManyMocks.transcriptSegments.mockResolvedValue([])
    findManyMocks.chapters.mockResolvedValue([])
    findManyMocks.highlights.mockResolvedValue([])
    findManyMocks.proposedTasks.mockResolvedValue([])
    findManyMocks.transcriptionJobs.mockResolvedValue([])

    const app = buildServer()
    const response = await app.inject({ method: 'GET', url: '/meetings/meeting-1/full' })

    expect(response.json().summary).toBeNull()
  })
})
