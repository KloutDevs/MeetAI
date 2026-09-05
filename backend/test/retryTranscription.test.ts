// backend/test/retryTranscription.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findFirstMock = vi.fn()
const deleteWhereMock = vi.fn().mockResolvedValue(undefined)
const deleteMock = vi.fn(() => ({ where: deleteWhereMock }))

vi.mock('../src/db/client.js', () => ({
  db: {
    query: { transcriptionJobs: { findFirst: findFirstMock } },
    delete: deleteMock
  }
}))

const dispatchMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../src/services/deepgramDispatch.js', () => ({
  dispatchTrackForTranscription: (...args: unknown[]) => dispatchMock(...args)
}))

const { retryMeetingTranscription } = await import('../src/services/retryTranscription.js')

describe('retryMeetingTranscription', () => {
  beforeEach(() => {
    findFirstMock.mockReset()
    deleteMock.mockClear()
    deleteWhereMock.mockClear()
    dispatchMock.mockClear()
    process.env.S3_PUBLIC_URL = 'https://pub-test.r2.dev'
    process.env.BACKEND_PUBLIC_URL = 'https://backend.example.com'
  })

  it('redispatches participants with no job and skips already-completed ones', async () => {
    findFirstMock
      .mockResolvedValueOnce(undefined) // p1: never dispatched
      .mockResolvedValueOnce({ id: 'job-2', status: 'completed' }) // p2: already done

    const result = await retryMeetingTranscription('meeting-1', ['p1', 'p2'])

    expect(dispatchMock).toHaveBeenCalledTimes(1)
    expect(dispatchMock).toHaveBeenCalledWith({
      meetingId: 'meeting-1',
      trackId: 'meeting-1/p1.ogg',
      participantId: 'p1',
      trackUrl: 'https://pub-test.r2.dev/meeting-1/p1.ogg',
      callbackBaseUrl: 'https://backend.example.com'
    })
    expect(deleteMock).not.toHaveBeenCalled()
    expect(result.retried).toEqual(['p1'])
  })

  it('deletes a stale failed/timeout job before redispatching', async () => {
    findFirstMock.mockResolvedValueOnce({ id: 'job-1', status: 'failed' })

    const result = await retryMeetingTranscription('meeting-1', ['p1'])

    expect(deleteMock).toHaveBeenCalled()
    expect(dispatchMock).toHaveBeenCalledTimes(1)
    expect(result.retried).toEqual(['p1'])
  })
})
