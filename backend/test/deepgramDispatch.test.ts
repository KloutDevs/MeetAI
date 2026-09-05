// backend/test/deepgramDispatch.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dispatchTrackForTranscription } from '../src/services/deepgramDispatch.js'

const insertMock = vi.fn()
const valuesMock = vi.fn(() => ({ returning: () => Promise.resolve([{ id: 'job-1' }]) }))

vi.mock('../src/db/client.js', () => ({
  db: {
    insert: (...args: unknown[]) => {
      insertMock(...args)
      return { values: valuesMock }
    }
  }
}))

describe('dispatchTrackForTranscription', () => {
  beforeEach(() => {
    insertMock.mockClear()
    valuesMock.mockClear()
    process.env.DEEPGRAM_API_KEY = 'test-key'
  })

  it('calls Deepgram listen endpoint with url and callback, then stores the job', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ request_id: 'dg-req-1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await dispatchTrackForTranscription({
      meetingId: 'meeting-1',
      trackId: 'track-1',
      participantId: 'participant-1',
      trackUrl: 'https://bucket.s3.amazonaws.com/track-1.ogg',
      callbackBaseUrl: 'https://backend.example.com'
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://api.deepgram.com/v1/listen'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Token test-key' })
      })
    )

    const [calledUrl, options] = fetchMock.mock.calls[0]

    // callback must be a query parameter on the Deepgram request URL, not a
    // JSON body field — Deepgram silently ignores a body-level `callback`
    // and processes synchronously instead of using the async ack shape.
    const requestUrl = new URL(calledUrl)

    // Without language=multi, Deepgram's nova-3 defaults to English-only
    // detection and silently returns an empty transcript for non-English
    // speech (verified against real Spanish audio in production).
    expect(requestUrl.searchParams.get('language')).toBe('multi')

    const callbackParam = requestUrl.searchParams.get('callback')
    expect(callbackParam).toContain('https://backend.example.com/webhooks/deepgram')
    expect(callbackParam).toContain('meetingId=meeting-1')
    expect(callbackParam).toContain('trackId=track-1')

    const body = JSON.parse(options.body)
    expect(body.url).toBe('https://bucket.s3.amazonaws.com/track-1.ogg')
    expect(body.callback).toBeUndefined()

    expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({
      meetingId: 'meeting-1',
      trackId: 'track-1',
      trackUrl: 'https://bucket.s3.amazonaws.com/track-1.ogg',
      participantId: 'participant-1',
      status: 'pending'
    }))
  })

  it('throws and does not insert when Deepgram responds with a non-ok status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(dispatchTrackForTranscription({
      meetingId: 'meeting-1',
      trackId: 'track-1',
      participantId: 'participant-1',
      trackUrl: 'https://bucket.s3.amazonaws.com/track-1.ogg',
      callbackBaseUrl: 'https://backend.example.com'
    })).rejects.toThrow()

    expect(insertMock).not.toHaveBeenCalled()
  })

  it('throws when Deepgram response is missing request_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(dispatchTrackForTranscription({
      meetingId: 'meeting-1',
      trackId: 'track-1',
      participantId: 'participant-1',
      trackUrl: 'https://bucket.s3.amazonaws.com/track-1.ogg',
      callbackBaseUrl: 'https://backend.example.com'
    })).rejects.toThrow('Deepgram response missing request_id for track track-1')

    expect(insertMock).not.toHaveBeenCalled()
  })

  it('throws when DEEPGRAM_API_KEY is not set', async () => {
    delete process.env.DEEPGRAM_API_KEY
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(dispatchTrackForTranscription({
      meetingId: 'meeting-1',
      trackId: 'track-1',
      participantId: 'participant-1',
      trackUrl: 'https://bucket.s3.amazonaws.com/track-1.ogg',
      callbackBaseUrl: 'https://backend.example.com'
    })).rejects.toThrow('DEEPGRAM_API_KEY')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
  })
})
