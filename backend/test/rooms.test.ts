import { describe, it, expect, vi, beforeEach } from 'vitest'

const createMeetingRoomMock = vi.fn()
const issueParticipantTokenMock = vi.fn()
vi.mock('../src/services/livekitRoom.js', () => ({
  createMeetingRoom: (...args: unknown[]) => createMeetingRoomMock(...args),
  issueParticipantToken: (...args: unknown[]) => issueParticipantTokenMock(...args)
}))

const { buildServer } = await import('../src/server.js')

describe('POST /rooms', () => {
  beforeEach(() => {
    createMeetingRoomMock.mockClear()
    issueParticipantTokenMock.mockClear()
  })

  it('creates a meeting room and returns its id', async () => {
    createMeetingRoomMock.mockResolvedValue({ meetingId: 'meeting-1', roomName: 'meeting-1' })

    const app = buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/rooms',
      payload: { title: 'Weekly sync' }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ meetingId: 'meeting-1', roomName: 'meeting-1' })
    expect(createMeetingRoomMock).toHaveBeenCalledWith('Weekly sync')
  })
})

describe('POST /rooms/:meetingId/token', () => {
  beforeEach(() => {
    createMeetingRoomMock.mockClear()
    issueParticipantTokenMock.mockClear()
  })

  it('issues a participant token for the given meeting', async () => {
    issueParticipantTokenMock.mockResolvedValue({ participantId: 'p1', token: 'jwt-token' })

    const app = buildServer()
    const response = await app.inject({
      method: 'POST',
      url: '/rooms/meeting-1/token',
      payload: { participantName: 'Ada' }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ participantId: 'p1', token: 'jwt-token' })
    expect(issueParticipantTokenMock).toHaveBeenCalledWith('meeting-1', 'Ada')
  })
})
