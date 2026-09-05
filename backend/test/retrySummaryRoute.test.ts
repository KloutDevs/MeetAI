// backend/test/retrySummaryRoute.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findFirstMocks: Record<string, ReturnType<typeof vi.fn>> = {
  meetings: vi.fn(),
  summaries: vi.fn()
}
const findManyMocks: Record<string, ReturnType<typeof vi.fn>> = {
  transcriptionJobs: vi.fn()
}

vi.mock('../src/db/client.js', () => ({
  db: {
    query: {
      meetings: { findFirst: (...args: unknown[]) => findFirstMocks.meetings(...args) },
      summaries: { findFirst: (...args: unknown[]) => findFirstMocks.summaries(...args) },
      transcriptionJobs: { findMany: (...args: unknown[]) => findManyMocks.transcriptionJobs(...args) }
    }
  }
}))

const generateMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../src/services/llmSummary.js', () => ({
  generateMeetingSummary: (...args: unknown[]) => generateMock(...args)
}))

const { buildServer } = await import('../src/server.js')

describe('POST /meetings/:id/retry-summary', () => {
  beforeEach(() => {
    findFirstMocks.meetings.mockReset()
    findFirstMocks.summaries.mockReset()
    findManyMocks.transcriptionJobs.mockReset()
    generateMock.mockClear()
  })

  it('regenerates the summary from completed jobs and returns the resulting status', async () => {
    findFirstMocks.meetings.mockResolvedValue({ id: 'meeting-1', title: 'Weekly sync' })
    findManyMocks.transcriptionJobs.mockResolvedValue([
      { status: 'completed', participantId: 'p1', words: JSON.stringify([{ word: 'hola', start: 0, end: 0.3, confidence: 0.9 }]) }
    ])
    findFirstMocks.summaries.mockResolvedValue({ status: 'completed' })

    const app = buildServer()
    const response = await app.inject({ method: 'POST', url: '/meetings/meeting-1/retry-summary' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'completed' })
    expect(generateMock).toHaveBeenCalledWith('meeting-1', [
      { speakerId: 'p1', start: 0, end: 0.3, text: 'hola' }
    ])
  })

  it('returns 400 without calling the LLM when there is no usable transcript yet', async () => {
    findFirstMocks.meetings.mockResolvedValue({ id: 'meeting-1', title: 'Weekly sync' })
    findManyMocks.transcriptionJobs.mockResolvedValue([{ status: 'pending', participantId: 'p1', words: null }])

    const app = buildServer()
    const response = await app.inject({ method: 'POST', url: '/meetings/meeting-1/retry-summary' })

    expect(response.statusCode).toBe(400)
    expect(generateMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the meeting does not exist', async () => {
    findFirstMocks.meetings.mockResolvedValue(undefined)

    const app = buildServer()
    const response = await app.inject({ method: 'POST', url: '/meetings/missing/retry-summary' })

    expect(response.statusCode).toBe(404)
    expect(generateMock).not.toHaveBeenCalled()
  })
})
