import { describe, it, expect, vi, beforeEach } from 'vitest'

const findJobMock = vi.fn()
const updateSetMock = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }))
const checkCompletionMock = vi.fn().mockResolvedValue(undefined)

vi.mock('../src/db/client.js', () => ({
  db: {
    query: { transcriptionJobs: { findFirst: findJobMock } },
    update: () => ({ set: updateSetMock })
  }
}))

vi.mock('../src/services/meetingCompletion.js', () => ({
  checkMeetingCompletion: checkCompletionMock
}))

const { buildServer } = await import('../src/server.js')

describe('POST /webhooks/deepgram', () => {
  beforeEach(() => {
    findJobMock.mockClear()
    updateSetMock.mockClear()
    checkCompletionMock.mockClear()
  })

  it('marks the job completed and stores words on first callback', async () => {
    findJobMock.mockResolvedValue({ id: 'job-1', status: 'pending', meetingId: 'meeting-1' })

    const app = buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/deepgram?meetingId=meeting-1&trackId=track-1',
      payload: {
        results: {
          channels: [{ alternatives: [{ words: [{ word: 'hola', start: 0, end: 0.3, confidence: 0.9 }] }] }]
        }
      }
    })

    expect(response.statusCode).toBe(200)
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
    expect(checkCompletionMock).toHaveBeenCalledWith('meeting-1')
  })

  it('is idempotent: does nothing if the job is already completed', async () => {
    findJobMock.mockResolvedValue({ id: 'job-1', status: 'completed', meetingId: 'meeting-1' })

    const app = buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/deepgram?meetingId=meeting-1&trackId=track-1',
      payload: { results: { channels: [{ alternatives: [{ words: [] }] }] } }
    })

    expect(response.statusCode).toBe(200)
    expect(updateSetMock).not.toHaveBeenCalled()
    expect(checkCompletionMock).not.toHaveBeenCalled()
  })

  it('is idempotent: does nothing if the job already timed out', async () => {
    findJobMock.mockResolvedValue({ id: 'job-1', status: 'timeout', meetingId: 'meeting-1' })

    const app = buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/deepgram?meetingId=meeting-1&trackId=track-1',
      payload: { results: { channels: [{ alternatives: [{ words: [] }] }] } }
    })

    expect(response.statusCode).toBe(200)
    expect(updateSetMock).not.toHaveBeenCalled()
    expect(checkCompletionMock).not.toHaveBeenCalled()
  })

  it('marks the job failed when the callback body has no usable results', async () => {
    findJobMock.mockResolvedValue({ id: 'job-1', status: 'pending', meetingId: 'meeting-1' })

    const app = buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/deepgram?meetingId=meeting-1&trackId=track-1',
      payload: {}
    })

    expect(response.statusCode).toBe(200)
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
    expect(checkCompletionMock).toHaveBeenCalledWith('meeting-1')
  })
})
