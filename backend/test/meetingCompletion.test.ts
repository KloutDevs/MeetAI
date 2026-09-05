// backend/test/meetingCompletion.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findManyMock = vi.fn()
const insertValuesMock = vi.fn().mockResolvedValue(undefined)

vi.mock('../src/db/client.js', () => ({
  db: {
    query: { transcriptionJobs: { findMany: findManyMock } },
    insert: () => ({ values: insertValuesMock })
  }
}))

const { checkMeetingCompletion } = await import('../src/services/meetingCompletion.js')

describe('checkMeetingCompletion', () => {
  beforeEach(() => {
    findManyMock.mockClear()
    insertValuesMock.mockClear()
  })

  it('does nothing if some jobs are still pending', async () => {
    findManyMock.mockResolvedValue([
      { status: 'completed', participantId: 'p1', words: '[]' },
      { status: 'pending', participantId: 'p2', words: null }
    ])

    await checkMeetingCompletion('meeting-1')

    expect(insertValuesMock).not.toHaveBeenCalled()
  })

  it('merges and persists segments once all jobs reach a terminal state', async () => {
    findManyMock.mockResolvedValue([
      {
        status: 'completed',
        participantId: 'p1',
        words: JSON.stringify([{ word: 'hola', start: 0, end: 0.3, confidence: 0.9 }])
      },
      { status: 'timeout', participantId: 'p2', words: null }
    ])

    await checkMeetingCompletion('meeting-1')

    expect(insertValuesMock).toHaveBeenCalledWith([
      { meetingId: 'meeting-1', speakerId: 'p1', start: 0, end: 0.3, text: 'hola' }
    ])
  })
})
