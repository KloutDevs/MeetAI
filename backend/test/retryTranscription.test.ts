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

  it('redispatches participants with no job and skips ones already completed with a real transcript', async () => {
    findFirstMock
      .mockResolvedValueOnce(undefined) // p1: never dispatched
      .mockResolvedValueOnce({ id: 'job-2', status: 'completed', words: JSON.stringify([{ word: 'hola', start: 0, end: 0.3, confidence: 0.9 }]) }) // p2: already done, real transcript

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

  it('retries a job that completed with an empty transcript (e.g. the language-detection bug)', async () => {
    findFirstMock.mockResolvedValueOnce({ id: 'job-1', status: 'completed', words: '[]' })

    const result = await retryMeetingTranscription('meeting-1', ['p1'])

    expect(deleteMock).toHaveBeenCalled()
    expect(dispatchMock).toHaveBeenCalledTimes(1)
    expect(result.retried).toEqual(['p1'])
  })

  it('deletes a stale failed/timeout job before redispatching', async () => {
    findFirstMock.mockResolvedValueOnce({ id: 'job-1', status: 'failed' })

    const result = await retryMeetingTranscription('meeting-1', ['p1'])

    expect(deleteMock).toHaveBeenCalled()
    expect(dispatchMock).toHaveBeenCalledTimes(1)
    expect(result.retried).toEqual(['p1'])
  })

  it('continues retrying remaining participants when one fails (e.g. missing audio in S3)', async () => {
    findFirstMock.mockResolvedValue(undefined)
    dispatchMock
      .mockRejectedValueOnce(new Error('Deepgram dispatch failed for track meeting-1/p1.ogg: 400'))
      .mockResolvedValueOnce(undefined)

    const result = await retryMeetingTranscription('meeting-1', ['p1', 'p2'])

    expect(dispatchMock).toHaveBeenCalledTimes(2)
    expect(result.retried).toEqual(['p2'])
    expect(result.failed).toEqual([
      { participantId: 'p1', error: 'Deepgram dispatch failed for track meeting-1/p1.ogg: 400' }
    ])
  })
})
