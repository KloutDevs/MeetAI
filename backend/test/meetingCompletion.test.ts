// backend/test/meetingCompletion.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findManyMock = vi.fn()
const insertValuesMock = vi.fn().mockResolvedValue(undefined)
const deleteWhereMock = vi.fn().mockResolvedValue(undefined)
const callOrder: string[] = []

vi.mock('../src/db/client.js', () => ({
  db: {
    query: { transcriptionJobs: { findMany: findManyMock } },
    transaction: async (callback: (tx: unknown) => Promise<void>) => {
      const tx = {
        delete: () => ({
          where: (...args: unknown[]) => {
            callOrder.push('delete')
            return deleteWhereMock(...args)
          }
        }),
        insert: () => ({
          values: (...args: unknown[]) => {
            callOrder.push('insert')
            return insertValuesMock(...args)
          }
        })
      }
      return callback(tx)
    }
  }
}))

const { checkMeetingCompletion } = await import('../src/services/meetingCompletion.js')

describe('checkMeetingCompletion', () => {
  beforeEach(() => {
    findManyMock.mockClear()
    insertValuesMock.mockClear()
    deleteWhereMock.mockClear()
    callOrder.length = 0
  })

  it('does nothing if some jobs are still pending', async () => {
    findManyMock.mockResolvedValue([
      { status: 'completed', participantId: 'p1', words: '[]' },
      { status: 'pending', participantId: 'p2', words: null }
    ])

    await checkMeetingCompletion('meeting-1')

    expect(insertValuesMock).not.toHaveBeenCalled()
  })

  it('does not insert when all jobs are terminal but none completed with words', async () => {
    findManyMock.mockResolvedValue([
      { status: 'failed', participantId: 'p1', words: null },
      { status: 'timeout', participantId: 'p2', words: null }
    ])

    await checkMeetingCompletion('meeting-1')

    expect(insertValuesMock).not.toHaveBeenCalled()
  })

  it('skips a job whose words fail to parse and still persists valid tracks', async () => {
    findManyMock.mockResolvedValue([
      {
        status: 'completed',
        participantId: 'p1',
        words: JSON.stringify([{ word: 'hola', start: 0, end: 0.3, confidence: 0.9 }])
      },
      { status: 'completed', participantId: 'p2', words: '{not valid json' }
    ])

    await checkMeetingCompletion('meeting-1')

    expect(insertValuesMock).toHaveBeenCalledWith([
      { meetingId: 'meeting-1', speakerId: 'p1', start: 0, end: 0.3, text: 'hola' }
    ])
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

  it('is idempotent: calling twice for the same meeting does not duplicate segments', async () => {
    findManyMock.mockResolvedValue([
      {
        status: 'completed',
        participantId: 'p1',
        words: JSON.stringify([{ word: 'hola', start: 0, end: 0.3, confidence: 0.9 }])
      },
      { status: 'timeout', participantId: 'p2', words: null }
    ])

    await checkMeetingCompletion('meeting-1')
    await checkMeetingCompletion('meeting-1')

    // Each call must delete existing segments for the meeting before re-inserting,
    // so a late/retried callback re-running this function converges to the same
    // final state instead of accumulating duplicate rows.
    expect(deleteWhereMock).toHaveBeenCalledTimes(2)
    expect(insertValuesMock).toHaveBeenCalledTimes(2)
    expect(callOrder).toEqual(['delete', 'insert', 'delete', 'insert'])
  })
})

const generateSummaryMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../src/services/llmSummary.js', () => ({
  generateMeetingSummary: (...args: unknown[]) => generateSummaryMock(...args)
}))

describe('checkMeetingCompletion — AI summary trigger', () => {
  beforeEach(() => {
    generateSummaryMock.mockClear()
    generateSummaryMock.mockResolvedValue(undefined)
  })

  it('invokes generateMeetingSummary with the merged segments after persisting them', async () => {
    findManyMock.mockResolvedValue([
      {
        status: 'completed',
        participantId: 'p1',
        words: JSON.stringify([{ word: 'hola', start: 0, end: 0.3, confidence: 0.9 }])
      }
    ])

    await checkMeetingCompletion('meeting-1')

    expect(generateSummaryMock).toHaveBeenCalledWith('meeting-1', [
      { speakerId: 'p1', start: 0, end: 0.3, text: 'hola' }
    ])
  })

  it('does not call generateMeetingSummary when there are no segments to persist', async () => {
    findManyMock.mockResolvedValue([{ status: 'timeout', participantId: 'p2', words: null }])
    generateSummaryMock.mockClear()

    await checkMeetingCompletion('meeting-1')

    expect(generateSummaryMock).not.toHaveBeenCalled()
  })

  it('does not let a rejected generateMeetingSummary reject or throw from checkMeetingCompletion, and logs the error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = new Error('LLM exploded')
    generateSummaryMock.mockRejectedValueOnce(failure)

    findManyMock.mockResolvedValue([
      {
        status: 'completed',
        participantId: 'p1',
        words: JSON.stringify([{ word: 'hola', start: 0, end: 0.3, confidence: 0.9 }])
      }
    ])

    await expect(checkMeetingCompletion('meeting-1')).resolves.toBeUndefined()

    // The .catch handler runs on a microtask after checkMeetingCompletion resolves
    // (fire-and-forget), so flush the microtask queue before asserting.
    await new Promise((resolve) => setImmediate(resolve))

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('meeting-1'))
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('LLM exploded'))

    consoleErrorSpy.mockRestore()
  })
})
