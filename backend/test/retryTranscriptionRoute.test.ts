// backend/test/retryTranscriptionRoute.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findFirstMocks: Record<string, ReturnType<typeof vi.fn>> = {
  meetings: vi.fn()
}
const findManyMocks: Record<string, ReturnType<typeof vi.fn>> = {
  participants: vi.fn()
}

vi.mock('../src/db/client.js', () => ({
  db: {
    query: {
      meetings: { findFirst: (...args: unknown[]) => findFirstMocks.meetings(...args) },
      participants: { findMany: (...args: unknown[]) => findManyMocks.participants(...args) }
    }
  }
}))

const retryMock = vi.fn()
vi.mock('../src/services/retryTranscription.js', () => ({
  retryMeetingTranscription: (...args: unknown[]) => retryMock(...args)
}))

const { buildServer } = await import('../src/server.js')

describe('POST /meetings/:id/retry-transcription', () => {
  beforeEach(() => {
    findFirstMocks.meetings.mockReset()
    findManyMocks.participants.mockReset()
    retryMock.mockReset()
  })

  it('retries transcription for all participants of the meeting', async () => {
    findFirstMocks.meetings.mockResolvedValue({ id: 'meeting-1', title: 'Weekly sync' })
    findManyMocks.participants.mockResolvedValue([{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Bea' }])
    retryMock.mockResolvedValue({ retried: ['p1'], failed: [] })

    const app = buildServer()
    const response = await app.inject({ method: 'POST', url: '/meetings/meeting-1/retry-transcription' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ retried: ['p1'], failed: [] })
    expect(retryMock).toHaveBeenCalledWith('meeting-1', ['p1', 'p2'], { force: false })
  })

  it('passes force=true through to the service when requested', async () => {
    findFirstMocks.meetings.mockResolvedValue({ id: 'meeting-1', title: 'Weekly sync' })
    findManyMocks.participants.mockResolvedValue([{ id: 'p1', name: 'Ada' }])
    retryMock.mockResolvedValue({ retried: ['p1'], failed: [] })

    const app = buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/meetings/meeting-1/retry-transcription',
      payload: { force: true }
    })

    expect(response.statusCode).toBe(200)
    expect(retryMock).toHaveBeenCalledWith('meeting-1', ['p1'], { force: true })
  })

  it('returns 404 when the meeting does not exist', async () => {
    findFirstMocks.meetings.mockResolvedValue(undefined)

    const app = buildServer()
    const response = await app.inject({ method: 'POST', url: '/meetings/missing/retry-transcription' })

    expect(response.statusCode).toBe(404)
    expect(retryMock).not.toHaveBeenCalled()
  })
})
