import { describe, it, expect, vi, beforeEach } from 'vitest'

const dispatchMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../src/services/deepgramDispatch.js', () => ({
  dispatchTrackForTranscription: dispatchMock
}))

const receiveMock = vi.fn()
const startTrackEgressMock = vi.fn().mockResolvedValue({ egressId: 'egress-1' })
vi.mock('livekit-server-sdk', async () => {
  const actual = await vi.importActual<typeof import('livekit-server-sdk')>('livekit-server-sdk')
  return {
    ...actual,
    WebhookReceiver: vi.fn().mockImplementation(() => ({ receive: receiveMock })),
    EgressClient: vi.fn().mockImplementation(() => ({ startTrackEgress: startTrackEgressMock }))
  }
})

// The real `WebhookReceiver.receive()` runs the payload through protobuf-es's
// `WebhookEvent.fromJson`, which decodes proto enum JSON names (e.g. "AUDIO")
// into their numeric enum values (TrackType.AUDIO === 0) — NOT the string
// name. Verified by constructing a real WebhookEvent.fromJson() against the
// installed livekit-server-sdk@2.9.0 / @livekit/protocol. So the mocked
// `receive()` return value below must mirror numeric enum values, not
// strings, to faithfully stand in for the real SDK.
const { TrackType, EgressStatus } = await vi.importActual<typeof import('livekit-server-sdk')>('livekit-server-sdk')

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
        status: EgressStatus.EGRESS_COMPLETE,
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

  it('does not dispatch when egress status is a different numeric enum value (regression: guards against string-vs-number confusion)', async () => {
    receiveMock.mockReturnValue({
      event: 'egress_ended',
      egressInfo: {
        // EgressStatus.EGRESS_FAILED is a real, different numeric member.
        // If the comparison were ever downgraded to a truthy/string check,
        // this would incorrectly dispatch.
        status: EgressStatus.EGRESS_FAILED,
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
    expect(dispatchMock).not.toHaveBeenCalled()
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

describe('POST /webhooks/livekit-egress — track_published', () => {
  beforeEach(() => {
    startTrackEgressMock.mockClear()
    receiveMock.mockClear()
  })

  it('starts track egress for a published audio track, named after the participant id', async () => {
    receiveMock.mockReturnValue({
      event: 'track_published',
      room: { name: 'meeting-1' },
      participant: { identity: 'participant-1' },
      track: { sid: 'TR_abc', type: TrackType.AUDIO }
    })

    const app = buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/livekit-egress',
      headers: { authorization: 'test-signature' },
      payload: '{}'
    })

    expect(response.statusCode).toBe(200)
    expect(startTrackEgressMock).toHaveBeenCalledWith(
      'meeting-1',
      expect.objectContaining({ filepath: 'meeting-1/participant-1.ogg' }),
      'TR_abc'
    )
  })

  it('does not start egress for a published video track', async () => {
    receiveMock.mockReturnValue({
      event: 'track_published',
      room: { name: 'meeting-1' },
      participant: { identity: 'participant-1' },
      track: { sid: 'TR_video', type: TrackType.VIDEO }
    })

    const app = buildServer()
    await app.inject({
      method: 'POST',
      url: '/webhooks/livekit-egress',
      headers: { authorization: 'test-signature' },
      payload: '{}'
    })

    expect(startTrackEgressMock).not.toHaveBeenCalled()
  })
})
