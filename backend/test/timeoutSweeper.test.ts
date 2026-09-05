// backend/test/timeoutSweeper.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findManyMock = vi.fn()
const updateSetMock = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }))
const checkCompletionMock = vi.fn().mockResolvedValue(undefined)

vi.mock('../src/db/client.js', () => ({
  db: {
    query: { transcriptionJobs: { findMany: findManyMock } },
    update: () => ({ set: updateSetMock })
  }
}))

vi.mock('../src/services/meetingCompletion.js', () => ({
  checkMeetingCompletion: checkCompletionMock
}))

const { sweepTimedOutJobs } = await import('../src/services/timeoutSweeper.js')

describe('sweepTimedOutJobs', () => {
  beforeEach(() => {
    findManyMock.mockClear()
    updateSetMock.mockClear()
    checkCompletionMock.mockClear()
  })

  it('marks pending jobs older than 15 minutes as timeout and checks completion', async () => {
    findManyMock.mockResolvedValue([
      { id: 'job-1', meetingId: 'meeting-1', status: 'pending', createdAt: new Date('2026-01-01T10:00:00Z') }
    ])

    const now = new Date('2026-01-01T10:16:00Z')
    await sweepTimedOutJobs(now)

    expect(updateSetMock).toHaveBeenCalledWith({ status: 'timeout' })
    expect(checkCompletionMock).toHaveBeenCalledWith('meeting-1')
  })
})
