// backend/test/livekitRoom.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const insertValuesMock = vi.fn()
vi.mock('../src/db/client.js', () => ({
  db: {
    insert: () => ({ values: (v: unknown) => { insertValuesMock(v); return { returning: () => Promise.resolve([{ id: 'row-1', ...(v as object) }]) } } })
  }
}))

const createRoomMock = vi.fn().mockResolvedValue({ name: 'room-row-1' })
vi.mock('livekit-server-sdk', async () => {
  const actual = await vi.importActual<typeof import('livekit-server-sdk')>('livekit-server-sdk')
  return {
    ...actual,
    RoomServiceClient: vi.fn().mockImplementation(() => ({ createRoom: createRoomMock }))
  }
})

const { createMeetingRoom, issueParticipantToken } = await import('../src/services/livekitRoom.js')

describe('createMeetingRoom', () => {
  beforeEach(() => {
    insertValuesMock.mockClear()
    createRoomMock.mockClear()
    process.env.LIVEKIT_API_KEY = 'test-key'
    process.env.LIVEKIT_API_SECRET = 'test-secret'
    process.env.LIVEKIT_URL = 'https://test.livekit.cloud'
  })

  it('creates a Meeting row and a LiveKit room named after the meeting id', async () => {
    const result = await createMeetingRoom('Weekly sync')

    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Weekly sync' }))
    expect(createRoomMock).toHaveBeenCalledWith(expect.objectContaining({ name: result.meetingId }))
    expect(result.roomName).toBe(result.meetingId)
  })
})

describe('issueParticipantToken', () => {
  beforeEach(() => {
    insertValuesMock.mockClear()
    process.env.LIVEKIT_API_KEY = 'test-key'
    process.env.LIVEKIT_API_SECRET = 'test-secret'
  })

  it('creates a Participant row and returns a token whose identity is the participant id', async () => {
    const { participantId, token } = await issueParticipantToken('meeting-1', 'Ada')

    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({ meetingId: 'meeting-1', name: 'Ada' }))
    expect(typeof token).toBe('string')
    expect(token.split('.')).toHaveLength(3) // JWT shape

    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    expect(payload.sub).toBe(participantId)
  })
})
