import { describe, it, expect, vi, beforeEach } from 'vitest'

const dispatchMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../src/services/deepgramDispatch.js', () => ({
  dispatchTrackForTranscription: dispatchMock
}))

const receiveMock = vi.fn()
vi.mock('livekit-server-sdk', () => ({
  WebhookReceiver: vi.fn().mockImplementation(() => ({
    receive: receiveMock
  }))
}))

const { buildServer } = await import('../src/server.js')

describe('POST /webhooks/livekit-egress', () => {
  beforeEach(() => {
    dispatchMock.mockClear()
    receiveMock.mockClear()
  })

  it('dispatches a transcription job per completed track', async () => {
    receiveMock.mockReturnValue({
      event: 'egress_ended',
      egressInfo: {
        status: 'EGRESS_COMPLETE',
        roomName: 'meeting-1',
        fileResults: [
          { filename: 'track-1.ogg', location: 'https://bucket.s3.amazonaws.com/track-1.ogg' }
        ]
      }
    })

    const app = buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/livekit-egress',
      headers: { authorization: 'test-signature' },
      payload: '{}'
    })

    expect(response.statusCode).toBe(200)
    expect(dispatchMock).toHaveBeenCalledTimes(1)
  })

  it('ignores events that are not egress_ended', async () => {
    receiveMock.mockReturnValue({ event: 'room_started' })

    const app = buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/livekit-egress',
      headers: { authorization: 'test-signature' },
      payload: '{}'
    })

    expect(response.statusCode).toBe(200)
    expect(dispatchMock).not.toHaveBeenCalled()
  })
})
