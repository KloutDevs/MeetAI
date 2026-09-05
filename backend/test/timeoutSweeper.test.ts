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

  it('dedupes meetingIds so checkMeetingCompletion is called once per meeting, not once per job', async () => {
    findManyMock.mockResolvedValue([
      { id: 'job-1', meetingId: 'meeting-1', status: 'pending', createdAt: new Date('2026-01-01T10:00:00Z') },
      { id: 'job-2', meetingId: 'meeting-1', status: 'pending', createdAt: new Date('2026-01-01T10:01:00Z') }
    ])

    const now = new Date('2026-01-01T10:20:00Z')
    await sweepTimedOutJobs(now)

    expect(updateSetMock).toHaveBeenCalledTimes(2)
    expect(checkCompletionMock).toHaveBeenCalledTimes(1)
    expect(checkCompletionMock).toHaveBeenCalledWith('meeting-1')
  })

  it('does not mark a job as timeout when it is under the 15-minute threshold', async () => {
    findManyMock.mockResolvedValue([
      { id: 'job-3', meetingId: 'meeting-2', status: 'pending', createdAt: new Date('2026-01-01T10:00:00Z') }
    ])

    const now = new Date('2026-01-01T10:10:00Z')
    await sweepTimedOutJobs(now)

    expect(updateSetMock).not.toHaveBeenCalled()
    expect(checkCompletionMock).not.toHaveBeenCalled()
  })
})
